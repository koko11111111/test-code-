// admin.js — Secured & Corrected Event Lifecycle
let db = null;

function initAdmin() {
  const me = getCurrentUser();
  if (!me) return;

  db = getFirebaseDb();
  if (!db) {
    document.getElementById("admin-dashboard").innerHTML = `
      <div class="rl-settings-section">
        <h2>Firebase Disconnected</h2>
        <p class="rl-row-sub">Please connect your project in config.js to run the administration console.</p>
      </div>
    `;
    return;
  }

  initAdminStats();
  wireAdminEvents(); // FIX: Wire events once using delegation
}

function initAdminStats() {
  // Real-time listener for users list
  db.collection("users").onSnapshot(snap => {
    document.getElementById("total-users").textContent = snap.size;
    renderUsers(snap.docs.map(d => d.data()));
  }, err => {
    console.error("Admin listener error:", err);
    document.getElementById("admin-dashboard").innerHTML = `
      <div class="rl-settings-section">
        <h2>Access Denied</h2>
        <p class="rl-row-sub" style="color: var(--danger)">You do not have administrator permissions to view this panel.</p>
      </div>
    `;
  });

  // Global chats count
  db.collection("conversations").onSnapshot(snap => {
    document.getElementById("total-chats").textContent = snap.size;
  });
}

function renderUsers(users) {
  const userListEl = document.getElementById("admin-users-list");
  if (!userListEl) return;

  if (users.length === 0) {
    userListEl.innerHTML = `<p class="rl-hint">No registered accounts found in Firestore.</p>`;
    return;
  }

  userListEl.innerHTML = users.map(u => `
    <div class="rl-friend-row" style="margin-bottom: 12px; justify-content: space-between; display: flex; align-items: center;">
      <div class="rl-conv-info">
        <p class="rl-conv-name" style="margin:0; font-weight:600;">${escapeAuthHtml(u.name || "Anonymous User")}</p>
        <p class="rl-conv-last" style="margin:0; font-size:0.85rem; color:var(--text-muted);">${escapeAuthHtml(u.email)}</p>
      </div>
      <button class="btn btn-danger delete-user-btn" data-email="${escapeAuthHtml(u.email)}" style="padding: 4px 10px; font-size: 0.85rem;">Delete Data</button>
    </div>
  `).join("");
}

function wireAdminEvents() {
  const userListEl = document.getElementById("admin-users-list");
  if (!userListEl) return;

  // FIX: Catch events globally on the parent container (survives re-renders)
  userListEl.addEventListener("click", async (e) => {
    if (e.target.classList.contains("delete-user-btn")) {
      const targetEmail = e.target.getAttribute("data-email");
      if (!window.confirm(`Delete Firestore data for ${targetEmail}? (This wipes their profile layout but leaves their authentication login intact)`)) return;

      try {
        const emailKey = String(targetEmail).replace(/[.#$[\]]/g, "_");
        await db.collection("users").doc(emailKey).delete();
        alert("User data wiped successfully.");
      } catch (error) {
        alert("Action failed. Ensure your email is hardcoded as an admin in firestore.rules.");
      }
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin);
} else {
  initAdmin();
}