// ─── Relay auth ─────────────────────────────────────────────────────────
// Relay prefers Firebase Authentication when FIREBASE_CONFIG is filled in.
// The original localStorage auth remains as an offline/dev fallback so the
// static demo still works before Firebase is connected. Passwords are never
// stored in plain text in fallback mode — see crypto-utils.js. A small public
// profile (name/email/photo) is mirrored to Firestore so other Relay users can
// find you to start a chat.

const RELAY_USERS_KEY = "relayUsers";
const RELAY_CURRENT_USER_KEY = "relayCurrentUser";
const RELAY_REMEMBERED_EMAIL_KEY = "relayRememberedEmail";
const RELAY_PRIVACY_LOCK_KEY = "relayPrivacyLock";
const RELAY_LAST_ACTIVITY_KEY = "relayLastActivity";
const RELAY_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

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
  localStorage.removeItem(RELAY_LAST_ACTIVITY_KEY);
  const auth = getFirebaseAuth();
  if (auth && auth.currentUser) auth.signOut().catch(() => {});
}

// ── Firebase ───────────────────────────────────────────────────────────

function firebaseIsConfigured() {
  return typeof FIREBASE_CONFIG === "object" && !!FIREBASE_CONFIG && !!FIREBASE_CONFIG.apiKey;
}

// Lazily initializes the Firebase app (safe to call many times) and
// returns a Firestore instance, or null if config.js hasn't been filled in.
function ensureFirebaseApp() {
  if (typeof firebase === "undefined" || !firebaseIsConfigured()) return null;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    return firebase.app();
  } catch (e) {
    console.warn("Relay: Firebase init failed —", e.message);
    return null;
  }
}

function getFirebaseDb() {
  if (!ensureFirebaseApp() || !firebase.firestore) return null;
  return firebase.firestore();
}

function getFirebaseAuth() {
  if (!ensureFirebaseApp() || !firebase.auth) return null;
  return firebase.auth();
}

function firebaseAuthAvailable() {
  return !!getFirebaseAuth();
}

function userFromFirebaseUser(firebaseUser) {
  if (!firebaseUser || !firebaseUser.email) return null;
  return {
    name: firebaseUser.displayName || firebaseUser.email.split("@")[0],
    email: firebaseUser.email.toLowerCase(),
    profilePhoto: firebaseUser.photoURL || "",
    createdAt: firebaseUser.metadata && firebaseUser.metadata.creationTime ? new Date(firebaseUser.metadata.creationTime).toISOString() : new Date().toISOString(),
    authProvider: "firebase",
    uid: firebaseUser.uid,
  };
}

function persistFirebaseSession(firebaseUser) {
  const relayUser = userFromFirebaseUser(firebaseUser);
  if (!relayUser) return null;
  setCurrentUser(relayUser);
  syncUserToFirebase(relayUser);
  return relayUser;
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
  const auth = getFirebaseAuth();
  if (auth && auth.currentUser) auth.currentUser.updateProfile({ photoURL: photoDataUrl }).catch(() => {});
  const refreshed = findUserByEmail(current.email) || { ...current, profilePhoto: photoDataUrl };
  if (refreshed) {
    setCurrentUser(refreshed);
    syncUserToFirebase(refreshed);
  }
}

function saveDisplayNameForCurrentUser(name) {
  const current = getCurrentUser();
  if (!current) return;
  updateUserByEmail(current.email, (user) => ({ ...user, name }));
  const auth = getFirebaseAuth();
  if (auth && auth.currentUser) auth.currentUser.updateProfile({ displayName: name }).catch(() => {});
  const refreshed = findUserByEmail(current.email) || { ...current, name };
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
  const db = getFirebaseDb();
  if (db) db.collection("users").doc(emailKey(current.email)).delete().catch(() => {});
  const auth = getFirebaseAuth();
  const firebaseUser = auth && auth.currentUser;
  if (firebaseUser) firebaseUser.delete().catch(() => auth.signOut().catch(() => {}));
  logoutCurrentUser();
}

// ── Page guards ────────────────────────────────────────────────────────

function privacyLockEnabled() {
  try { return localStorage.getItem(RELAY_PRIVACY_LOCK_KEY) === "true"; } catch { return false; }
}

function updateLastActivity() {
  if (!privacyLockEnabled() || !getCurrentUser()) return;
  try { localStorage.setItem(RELAY_LAST_ACTIVITY_KEY, String(Date.now())); } catch { /* storage blocked */ }
}

function enforceIdleLock() {
  if (!privacyLockEnabled() || !getCurrentUser()) return false;
  const last = Number(localStorage.getItem(RELAY_LAST_ACTIVITY_KEY) || Date.now());
  if (Date.now() - last > RELAY_IDLE_TIMEOUT_MS) {
    logoutCurrentUser();
    window.location.href = "login.html?locked=1";
    return true;
  }
  return false;
}

function startPrivacyLockWatch() {
  if (!privacyLockEnabled() || !getCurrentUser()) return;
  ["click", "keydown", "pointerdown", "touchstart"].forEach((eventName) => {
    document.addEventListener(eventName, updateLastActivity, { passive: true });
  });
  updateLastActivity();
  window.setInterval(enforceIdleLock, 60000);
}

function requireLoginForPage() {
  const isProtected = isOnPage("chat.html") || isOnPage("settings.html") || isOnPage("admin.html");
  if (!isProtected) return;
  if (!getCurrentUser()) window.location.href = "login.html";
  else enforceIdleLock();
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
    if (!firebaseAuthAvailable() && findUserByEmail(email)) {
      setMessage(formMessage, "This email is already registered.", "error");
      return;
    }

    try {
      setMessage(formMessage, "Creating account…", "warning");
      if (firebaseAuthAvailable()) {
        await createFirebaseAccount(email, password, name);
      } else {
        const passwordHash = await securePasswordStore(password);

        const newUser = {
          name,
          email,
          passwordHash,
          profilePhoto: "",
          createdAt: new Date().toISOString(),
          authProvider: "local",
        };

        const users = readUsers();
        users.push(newUser);
        saveUsers(users);
        setCurrentUser(newUser);
        syncUserToFirebase(newUser);
      }

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

    try {
      formMessage.textContent = "Verifying password…";
      formMessage.className = "form-message warning";

      if (firebaseAuthAvailable()) {
        await loginFirebaseEmail(email, password);
      } else {
        if (!user) {
          formMessage.textContent = "Email or password is incorrect.";
          formMessage.className = "form-message error";
          return;
        }
        const passwordMatch = await verifyStoredPassword(password, user.passwordHash);
        if (!passwordMatch) {
          formMessage.textContent = "Email or password is incorrect.";
          formMessage.className = "form-message error";
          return;
        }
        setCurrentUser(user);
        syncUserToFirebase(user);
      }

      if (rememberInput.checked) localStorage.setItem(RELAY_REMEMBERED_EMAIL_KEY, email);
      else localStorage.removeItem(RELAY_REMEMBERED_EMAIL_KEY);

      formMessage.textContent = "Login successful.";
      formMessage.className = "form-message success";
      window.setTimeout(() => { window.location.href = "chat.html"; }, 400);
    } catch (error) {
      formMessage.textContent = "Login error: " + error.message;
      formMessage.className = "form-message error";
    }
  });
}

// ── Firebase Authentication helpers ───────────────────────────────────

async function createFirebaseAccount(email, password, name) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Authentication is not configured.");
  const credential = await auth.createUserWithEmailAndPassword(email, password);
  if (credential.user && name) await credential.user.updateProfile({ displayName: name });
  return persistFirebaseSession(credential.user);
}

async function loginFirebaseEmail(email, password) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Authentication is not configured.");
  const credential = await auth.signInWithEmailAndPassword(email, password);
  return persistFirebaseSession(credential.user);
}

async function loginWithGoogle() {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Add Firebase config and enable Google sign-in in Firebase Authentication first.");
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await auth.signInWithPopup(provider);
  return persistFirebaseSession(credential.user);
}

function setupFirebaseAuthObserver() {
  const auth = getFirebaseAuth();
  if (!auth || setupFirebaseAuthObserver.bound) return;
  setupFirebaseAuthObserver.bound = true;
  auth.onAuthStateChanged((firebaseUser) => {
    if (firebaseUser) {
      persistFirebaseSession(firebaseUser);
      if (isOnPage("login.html") || isOnPage("signup.html")) window.location.href = "chat.html";
    }
  });
}

function setupGoogleButtons() {
  ["google-login-btn", "google-signup-btn"].forEach((id) => {
    const button = document.getElementById(id);
    if (!button || button.dataset.googleBound === "true") return;
    button.dataset.googleBound = "true";
    if (!firebaseAuthAvailable()) {
      button.disabled = true;
      button.title = "Add Firebase config and enable Google sign-in to use this.";
    }
    button.addEventListener("click", async () => {
      const messageEl = document.getElementById("login-message") || document.getElementById("signup-message");
      try {
        if (messageEl) { messageEl.textContent = "Opening Google sign-in…"; messageEl.className = "form-message warning"; }
        await loginWithGoogle();
        if (messageEl) { messageEl.textContent = "Signed in with Google."; messageEl.className = "form-message success"; }
        window.setTimeout(() => { window.location.href = "chat.html"; }, 250);
      } catch (error) {
        if (messageEl) { messageEl.textContent = "Google sign-in failed: " + error.message; messageEl.className = "form-message error"; }
      }
    });
  });
}

function initAuth() {
  setupFirebaseAuthObserver();
  requireLoginForPage();
  showStorageWarning();
  showLoggedInNotice();
  runSignup();
  runLogin();
  setupPasswordToggles();
  setupGoogleButtons();
  startPrivacyLockWatch();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}
