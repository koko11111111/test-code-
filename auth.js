// ─── Relay auth ─────────────────────────────────────────────────────────
// Accounts live in localStorage (namespaced under "relay*" so this app
// never collides with any other project's storage on the same browser).
// Passwords are never stored in plain text — see crypto-utils.js.
// A small public profile (name/email/photo) is mirrored to Firestore so
// other Relay users can find you to start a chat.

const RELAY_USERS_KEY = "relayUsers";
const RELAY_CURRENT_USER_KEY = "relayCurrentUser";
const RELAY_REMEMBERED_EMAIL_KEY = "relayRememberedEmail";

function isStorageAvailable() {
  try {
    const testKey = "__relay_storage_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function isOnPage(filename) {
  const path = (window.location.pathname || "").toLowerCase();
  const href = (window.location.href || "").toLowerCase();
  const file = filename.toLowerCase();
  return path.endsWith("/" + file) || path.endsWith(file) || href.includes(file);
}

function readUsers() {
  if (!isStorageAvailable()) return [];
  try {
    return JSON.parse(localStorage.getItem(RELAY_USERS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  if (!isStorageAvailable()) throw new Error("Storage blocked");
  localStorage.setItem(RELAY_USERS_KEY, JSON.stringify(users));
}

function findUserByEmail(email) {
  return readUsers().find((user) => user.email === email) || null;
}

function updateUserByEmail(email, updater) {
  const users = readUsers();
  const next = users.map((user) => (user.email === email ? updater(user) : user));
  saveUsers(next);
}

function setCurrentUser(user) {
  if (!isStorageAvailable()) throw new Error("Storage blocked");
  localStorage.setItem(RELAY_CURRENT_USER_KEY, JSON.stringify({
    name: user.name,
    email: user.email,
    profilePhoto: user.profilePhoto || "",
    createdAt: user.createdAt || "",
  }));
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(RELAY_CURRENT_USER_KEY));
  } catch {
    return null;
  }
}

function logoutCurrentUser() {
  localStorage.removeItem(RELAY_CURRENT_USER_KEY);
}

// ── Firebase ───────────────────────────────────────────────────────────

function firebaseIsConfigured() {
  return typeof FIREBASE_CONFIG === "object" && !!FIREBASE_CONFIG && !!FIREBASE_CONFIG.apiKey;
}

// Lazily initializes the Firebase app (safe to call many times) and
// returns a Firestore instance, or null if config.js hasn't been filled in.
function getFirebaseDb() {
  if (typeof firebase === "undefined" || !firebaseIsConfigured()) return null;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    return firebase.firestore();
  } catch (e) {
    console.warn("Relay: Firebase init failed —", e.message);
    return null;
  }
}

function emailKey(email) {
  return String(email || "").replace(/[.#$[\]]/g, "_");
}

function syncUserToFirebase(user) {
  const db = getFirebaseDb();
  if (!db) return;
  db.collection("users").doc(emailKey(user.email)).set({
    name: user.name,
    email: user.email,
    profilePhoto: user.profilePhoto || "",
    createdAt: user.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActive: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => { /* auth still works without sync */ });
}

function saveProfilePhotoForCurrentUser(photoDataUrl) {
  const current = getCurrentUser();
  if (!current) return;
  updateUserByEmail(current.email, (user) => ({ ...user, profilePhoto: photoDataUrl }));
  const refreshed = findUserByEmail(current.email);
  if (refreshed) {
    setCurrentUser(refreshed);
    syncUserToFirebase(refreshed);
  }
}

function saveDisplayNameForCurrentUser(name) {
  const current = getCurrentUser();
  if (!current) return;
  updateUserByEmail(current.email, (user) => ({ ...user, name }));
  const refreshed = findUserByEmail(current.email);
  if (refreshed) {
    setCurrentUser(refreshed);
    syncUserToFirebase(refreshed);
  }
}

function deleteCurrentAccount() {
  const current = getCurrentUser();
  if (!current) return;
  const users = readUsers().filter((user) => user.email !== current.email);
  saveUsers(users);
  logoutCurrentUser();
  const db = getFirebaseDb();
  if (db) db.collection("users").doc(emailKey(current.email)).delete().catch(() => {});
}

// ── Page guards ────────────────────────────────────────────────────────

function requireLoginForPage() {
  const isProtected = isOnPage("chat.html") || isOnPage("settings.html");
  if (!isProtected) return;
  if (!getCurrentUser()) window.location.href = "login.html";
}

function showStorageWarning() {
  if (isStorageAvailable()) return;
  const text = "This browser blocked saved accounts. Open Relay via http://localhost (a local server) or your live URL, not as a local file, and make sure storage isn't disabled.";
  ["login-message", "signup-message"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = "form-message error"; }
  });
}

function showLoggedInNotice() {
  if (!isOnPage("login.html") && !isOnPage("signup.html")) return;
  if (getCurrentUser()) window.location.href = "chat.html";
}

function escapeAuthHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// ── Password strength ─────────────────────────────────────────────────

function getPasswordChecks(password) {
  return {
    minLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
  };
}

function getStrengthResult(password) {
  const checks = getPasswordChecks(password);
  const passed = Object.values(checks).filter(Boolean).length;
  if (passed <= 2) return { label: "Low security password", type: "error", checks };
  if (passed <= 4) return { label: "Medium security password", type: "warning", checks };
  return { label: "Strong password", type: "success", checks };
}

function setupPasswordToggles() {
  document.querySelectorAll(".password-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.getAttribute("data-target"));
      if (!input) return;
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      button.textContent = isHidden ? "🐵" : "🙈";
      button.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
  });
}

// ── Signup ─────────────────────────────────────────────────────────────

function runSignup() {
  const form = document.getElementById("signup-form");
  if (!form || form.dataset.authBound === "true") return;
  form.dataset.authBound = "true";

  const nameInput = document.getElementById("signup-name");
  const emailInput = document.getElementById("signup-email");
  const passwordInput = document.getElementById("signup-password");
  const confirmInput = document.getElementById("signup-confirm-password");
  const strengthMessage = document.getElementById("password-strength");
  const formMessage = document.getElementById("signup-message");

  function setMessage(el, text, type) {
    el.textContent = text;
    el.className = `form-message ${type}`;
  }

  passwordInput.addEventListener("input", () => {
    const password = passwordInput.value.trim();
    if (!password) { setMessage(strengthMessage, "", ""); return; }
    const strength = getStrengthResult(password);
    setMessage(strengthMessage, strength.label, strength.type);
    strengthMessage.className = `rl-strength ${strength.type}`;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;

    if (!name || !email || !password || !confirmPassword) {
      setMessage(formMessage, "Please fill all fields.", "error");
      return;
    }
    const strength = getStrengthResult(password);
    if (strength.type === "error") {
      setMessage(formMessage, "Password security is low. Use a stronger password.", "error");
      return;
    }
    if (password !== confirmPassword) {
      setMessage(formMessage, "Passwords do not match.", "error");
      return;
    }
    if (findUserByEmail(email)) {
      setMessage(formMessage, "This email is already registered.", "error");
      return;
    }

    try {
      setMessage(formMessage, "Creating account…", "warning");
      const passwordHash = await securePasswordStore(password);

      const newUser = {
        name,
        email,
        passwordHash,
        profilePhoto: "",
        createdAt: new Date().toISOString(),
      };

      const users = readUsers();
      users.push(newUser);
      saveUsers(users);
      setCurrentUser(newUser);
      syncUserToFirebase(newUser);

      setMessage(formMessage, "Account created! Opening Relay…", "success");
      form.reset();
      setMessage(strengthMessage, "", "");
      window.setTimeout(() => { window.location.href = "chat.html"; }, 500);
    } catch (error) {
      setMessage(formMessage, "Could not create account: " + error.message, "error");
    }
  });
}

// ── Login ──────────────────────────────────────────────────────────────

function runLogin() {
  const form = document.getElementById("login-form");
  if (!form || form.dataset.authBound === "true") return;
  form.dataset.authBound = "true";

  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const rememberInput = document.getElementById("remember-me");
  const formMessage = document.getElementById("login-message");

  let rememberedEmail = "";
  try { rememberedEmail = localStorage.getItem(RELAY_REMEMBERED_EMAIL_KEY) || ""; } catch { rememberedEmail = ""; }
  if (rememberedEmail) {
    emailInput.value = rememberedEmail;
    rememberInput.checked = true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const user = findUserByEmail(email);

    if (!user) {
      formMessage.textContent = "No account found with this email.";
      formMessage.className = "form-message error";
      return;
    }

    try {
      formMessage.textContent = "Verifying password…";
      formMessage.className = "form-message warning";

      const passwordMatch = await verifyStoredPassword(password, user.passwordHash);
      if (!passwordMatch) {
        formMessage.textContent = "Wrong password.";
        formMessage.className = "form-message error";
        return;
      }

      if (rememberInput.checked) localStorage.setItem(RELAY_REMEMBERED_EMAIL_KEY, email);
      else localStorage.removeItem(RELAY_REMEMBERED_EMAIL_KEY);

      setCurrentUser(user);
      syncUserToFirebase(user);

      formMessage.textContent = "Login successful.";
      formMessage.className = "form-message success";
      window.setTimeout(() => { window.location.href = "chat.html"; }, 400);
    } catch (error) {
      formMessage.textContent = "Login error: " + error.message;
      formMessage.className = "form-message error";
    }
  });
}

function initAuth() {
  requireLoginForPage();
  showStorageWarning();
  showLoggedInNotice();
  runSignup();
  runLogin();
  setupPasswordToggles();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}
