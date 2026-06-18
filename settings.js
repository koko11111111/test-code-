// ─── Relay settings ────────────────────────────────────────────────────
// Keeps profile/security controls separate from chat.js so existing chat
// behavior remains untouched.
(function () {
  const user = getCurrentUser();
  if (!user) return;

  const PRIVACY_LOCK_KEY = "relayPrivacyLock";
  const avatarSlot = document.getElementById("settings-avatar-slot");
  const emailEl = document.getElementById("settings-email");
  const nameInput = document.getElementById("display-name");
  const photoInput = document.getElementById("profile-photo");
  const profileForm = document.getElementById("profile-form");
  const profileMessage = document.getElementById("profile-message");
  const privacyLock = document.getElementById("privacy-lock");
  const logoutBtn = document.getElementById("logout-all-btn");
  const deleteBtn = document.getElementById("delete-account-btn");

  function colorForEmail(input) {
    const colors = ["#FF9F40", "#6FCF8E", "#5AC8E2", "#E2675A", "#C792EA", "#F4D35E"];
    let hash = 0;
    String(input || "x").split("").forEach((char) => { hash = (hash * 31 + char.charCodeAt(0)) >>> 0; });
    return colors[hash % colors.length];
  }

  function avatarHtml(profile) {
    if (profile.profilePhoto) return `<img class="rl-avatar" style="width:64px;height:64px" src="${profile.profilePhoto}" alt="">`;
    return `<div class="rl-avatar" style="width:64px;height:64px;display:flex;align-items:center;justify-content:center;background:${colorForEmail(profile.email)};color:#1A1206;font-weight:700;font-family:var(--font-display);font-size:27px">${escapeAuthHtml((profile.name || profile.email || "?").charAt(0).toUpperCase())}</div>`;
  }

  function setMessage(text, type) {
    profileMessage.textContent = text;
    profileMessage.className = `form-message ${type}`;
  }

  function compressProfilePhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const img = new Image();
      reader.onerror = () => reject(new Error("Could not read photo."));
      reader.onload = () => {
        img.onerror = () => reject(new Error("Could not decode photo."));
        img.onload = () => {
          const max = 512;
          let { width, height } = img;
          if (width > max || height > max) {
            if (width > height) { height = Math.round(height * (max / width)); width = max; }
            else { width = Math.round(width * (max / height)); height = max; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function render() {
    const fresh = getCurrentUser() || user;
    avatarSlot.innerHTML = avatarHtml(fresh);
    emailEl.textContent = fresh.email;
    nameInput.value = fresh.name || "";
    privacyLock.checked = localStorage.getItem(PRIVACY_LOCK_KEY) === "true";
  }

  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) { setMessage("Display name is required.", "error"); return; }
    if (name.length > 80) { setMessage("Display name is too long.", "error"); return; }
    try {
      setMessage("Saving…", "warning");
      saveDisplayNameForCurrentUser(name);
      const file = photoInput.files[0];
      if (file) {
        if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) throw new Error("Choose an image under 8MB.");
        saveProfilePhotoForCurrentUser(await compressProfilePhoto(file));
      }
      photoInput.value = "";
      render();
      setMessage("Profile saved.", "success");
    } catch (error) {
      setMessage(error.message, "error");
    }
  });

  privacyLock.addEventListener("change", () => localStorage.setItem(PRIVACY_LOCK_KEY, privacyLock.checked ? "true" : "false"));
  logoutBtn.addEventListener("click", () => { logoutCurrentUser(); window.location.href = "login.html"; });
  deleteBtn.addEventListener("click", () => {
    if (window.confirm("Delete this account from this device? This can't be undone.")) {
      deleteCurrentAccount();
      window.location.href = "signup.html";
    }
  });

  render();
})();
