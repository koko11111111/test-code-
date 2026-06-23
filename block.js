// ─── ADDED: Relay block system ──────────────────────────────────────────
// Lets a user block another user. A block is one-directional and private:
// - The blocker's `users/{emailKey}.blocked` array gets the blocked email added.
// - The blocked person is never told they've been blocked.
// - Blocking is enforced two ways (checked from either side, so it works
//   whether you blocked them or they blocked you):
//     1. They can no longer message you (chat.js calls isBlockedEitherWay()
//        before sending — see the small ADDED hook in chat.js/sendMessage).
//     2. Neither of you shows up in the other's people search (chat.js and
//        friends.js both filter their cached user lists through this).
// - Blocking someone who was a friend also removes the friendship, since a
//   block is a stronger signal than "no longer friends."
//
// This file exposes window.RelayBlock = { isBlockedEitherWay, blockUser,
// unblockUser } so chat.js and friends.js can use it without this file
// needing to know anything about their internals.
//
// Runs on any page where the markup it looks for is present (chat.html's
// peer menu, settings.html's blocked-users list) — quietly does nothing
// on pages without that markup.

(function () {
  const me = getCurrentUser();
  if (!me) return;

  function emailKeyBlock(email) {
    return String(email || "").replace(/[.#$[\]]/g, "_");
  }

  let db = null;
  let myBlocked = [];          // emails I have blocked
  let blockedByOthers = [];    // emails who have blocked me
  let myFriendsAtBlockTime = []; // mirrors friends list so block can also unfriend
  let allUsersForLabels = {};  // email -> {name, email, profilePhoto} cache for rendering names

  function isBlockedEitherWay(email) {
    return myBlocked.includes(email) || blockedByOthers.includes(email);
  }

  function iHaveBlocked(email) {
    return myBlocked.includes(email);
  }

  async function blockUser(targetEmail) {
    if (!db || !targetEmail || targetEmail === me.email) return;
    try {
      const myRef = db.collection("users").doc(emailKeyBlock(me.email));
      await myRef.set({ blocked: firebase.firestore.FieldValue.arrayUnion(targetEmail) }, { merge: true });
      // Blocking also ends any friendship, in both directions.
      if (myFriendsAtBlockTime.includes(targetEmail)) {
        const theirRef = db.collection("users").doc(emailKeyBlock(targetEmail));
        await myRef.set({ friends: firebase.firestore.FieldValue.arrayRemove(targetEmail) }, { merge: true });
        await theirRef.set({ friends: firebase.firestore.FieldValue.arrayRemove(me.email) }, { merge: true }).catch(() => {});
      }
    } catch (e) {
      console.warn("Relay: could not block user —", e.message);
    }
  }

  async function unblockUser(targetEmail) {
    if (!db || !targetEmail) return;
    try {
      const myRef = db.collection("users").doc(emailKeyBlock(me.email));
      await myRef.set({ blocked: firebase.firestore.FieldValue.arrayRemove(targetEmail) }, { merge: true });
    } catch (e) {
      console.warn("Relay: could not unblock user —", e.message);
    }
  }

  // Expose immediately (even before Firestore loads) so chat.js's calls
  // never throw — they just see "not blocked" until the real list syncs in.
  window.RelayBlock = { isBlockedEitherWay, iHaveBlocked, blockUser, unblockUser };

  // ── Chat header: peer menu (Block / Unblock) ─────────────────────────
  const peerMenuToggle = document.getElementById("peer-menu-toggle");
  const peerMenu = document.getElementById("peer-menu");
  const blockPeerBtn = document.getElementById("block-peer-btn");

  function currentChatPeerEmail() {
    // chat.js doesn't expose currentPeer directly, but it does keep the
    // peer's email in the header via the existing #peer-sub/#peer-name
    // flow. The reliable source is the active conversation list item's
    // data-peer-email, or — simpler — read it off whichever conversation
    // is marked active in the sidebar.
    const activeConv = document.querySelector(".rl-conv-item.active");
    return activeConv ? activeConv.getAttribute("data-peer-email") : null;
  }

  function refreshPeerMenuLabel() {
    if (!blockPeerBtn) return;
    const peerEmail = currentChatPeerEmail();
    if (!peerEmail) return;
    blockPeerBtn.textContent = iHaveBlocked(peerEmail) ? "Unblock" : "Block";
    blockPeerBtn.classList.toggle("rl-block-btn-active", iHaveBlocked(peerEmail));
  }

  function wirePeerMenu() {
    if (!peerMenuToggle || !peerMenu || !blockPeerBtn) return;
    peerMenuToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      refreshPeerMenuLabel();
      peerMenu.classList.toggle("hidden");
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#peer-menu-toggle") && !event.target.closest("#peer-menu")) {
        peerMenu.classList.add("hidden");
      }
    });
    blockPeerBtn.addEventListener("click", async () => {
      const peerEmail = currentChatPeerEmail();
      if (!peerEmail) return;
      if (iHaveBlocked(peerEmail)) {
        await unblockUser(peerEmail);
      } else {
        if (!window.confirm("Block this person? They won't be able to message you, and you won't see them in search.")) return;
        await blockUser(peerEmail);
      }
      peerMenu.classList.add("hidden");
    });
    // Re-render the label whenever the conversation list re-renders (the
    // active item changes), by observing the conversations container.
    const convsListEl = document.getElementById("conversations-list");
    if (convsListEl && window.MutationObserver) {
      new MutationObserver(refreshPeerMenuLabel).observe(convsListEl, { childList: true, subtree: true, attributes: true });
    }
  }

  // ── Settings page: blocked users list ────────────────────────────────
  const blockedUsersList = document.getElementById("blocked-users-list");
  const blockedUsersEmpty = document.getElementById("blocked-users-empty");

  function colorForEmailBlock(input) {
    const colors = ["#FF9F40", "#6FCF8E", "#5AC8E2", "#E2675A", "#C792EA", "#F4D35E"];
    let hash = 0;
    String(input || "x").split("").forEach((char) => { hash = (hash * 31 + char.charCodeAt(0)) >>> 0; });
    return colors[hash % colors.length];
  }

  function avatarHtmlBlock(user, size) {
    if (user && user.profilePhoto) return `<img class="rl-avatar" style="width:${size}px;height:${size}px" src="${user.profilePhoto}" alt="">`;
    const bg = colorForEmailBlock((user && user.email) || "x");
    const source = (user && (user.name || user.email)) || "?";
    const letter = escapeAuthHtml(source.trim().charAt(0).toUpperCase() || "?");
    const fontSize = Math.round(size * 0.42);
    return `<div class="rl-avatar" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg};color:#1A1206;font-weight:700;font-family:var(--font-display);font-size:${fontSize}px">${letter}</div>`;
  }

  function renderBlockedUsersList() {
    if (!blockedUsersList) return;
    if (myBlocked.length === 0) {
      if (blockedUsersEmpty) blockedUsersEmpty.classList.remove("hidden");
      Array.from(blockedUsersList.querySelectorAll(".rl-friend-row")).forEach((el) => el.remove());
      return;
    }
    if (blockedUsersEmpty) blockedUsersEmpty.classList.add("hidden");

    blockedUsersList.innerHTML = myBlocked.map((email) => {
      const user = allUsersForLabels[email] || { name: email.split("@")[0], email };
      return `
        <div class="rl-friend-row" data-blocked-email="${escapeAuthHtml(email)}">
          ${avatarHtmlBlock(user, 36)}
          <div class="rl-conv-info">
            <p class="rl-conv-name">${escapeAuthHtml(user.name || user.email)}</p>
            <p class="rl-conv-last">${escapeAuthHtml(user.email)}</p>
          </div>
          <div class="rl-friend-actions">
            <button class="btn btn-small btn-secondary rl-unblock-btn" type="button">Unblock</button>
          </div>
        </div>
      `;
    }).join("");
    if (blockedUsersEmpty) blockedUsersList.appendChild(blockedUsersEmpty);

    Array.from(blockedUsersList.querySelectorAll(".rl-unblock-btn")).forEach((btn) => {
      btn.addEventListener("click", (event) => {
        const row = event.target.closest(".rl-friend-row");
        const email = row && row.getAttribute("data-blocked-email");
        if (email) unblockUser(email);
      });
    });
  }

  function loadUserLabelsForBlocked() {
    if (!db || myBlocked.length === 0) return;
    myBlocked.forEach((email) => {
      if (allUsersForLabels[email]) return;
      db.collection("users").doc(emailKeyBlock(email)).get().then((doc) => {
        if (doc.exists) {
          allUsersForLabels[email] = doc.data();
          renderBlockedUsersList();
        }
      }).catch(() => {});
    });
  }

  // ── Firestore listeners ───────────────────────────────────────────────
  function listenMyBlockedAndFriends() {
    if (!db) return;
    db.collection("users").doc(emailKeyBlock(me.email)).onSnapshot((doc) => {
      const data = (doc.exists && doc.data()) || {};
      myBlocked = data.blocked || [];
      myFriendsAtBlockTime = data.friends || [];
      loadUserLabelsForBlocked();
      renderBlockedUsersList();
      refreshPeerMenuLabel();
    }, (err) => console.warn("Relay: blocked-list listener error —", err.message));
  }

  function listenWhoBlockedMe() {
    if (!db) return;
    // Anyone whose `blocked` array contains my email. Requires an
    // array-contains query across the users collection.
    db.collection("users").where("blocked", "array-contains", me.email).onSnapshot((snap) => {
      blockedByOthers = snap.docs.map((d) => d.id); // doc id is the blocker's emailKey, fine for an internal "blocked" set
      // Re-resolve doc ids back to emails for accuracy, since emailKey is lossy for some characters.
      blockedByOthers = snap.docs.map((d) => (d.data() && d.data().email) || d.id);
    }, (err) => console.warn("Relay: reverse-block listener error —", err.message));
  }

  // ── ADDED: report system ─────────────────────────────────────────────
  const reportPeerBtn = document.getElementById("report-peer-btn");
  const reportModalBackdrop = document.getElementById("report-modal-backdrop");
  const reportReasonSelect = document.getElementById("report-reason");
  const reportDetailsInput = document.getElementById("report-details");
  const reportMessageEl = document.getElementById("report-message");
  const reportCancelBtn = document.getElementById("report-cancel-btn");
  const reportSubmitBtn = document.getElementById("report-submit-btn");

  function setReportMessage(text, type) {
    if (!reportMessageEl) return;
    reportMessageEl.textContent = text;
    reportMessageEl.className = `form-message ${type || ""}`;
  }

  function openReportModal() {
    if (!reportModalBackdrop) return;
    setReportMessage("", "");
    if (reportDetailsInput) reportDetailsInput.value = "";
    if (reportReasonSelect) reportReasonSelect.value = "harassment";
    reportModalBackdrop.classList.remove("hidden");
    if (peerMenu) peerMenu.classList.add("hidden");
  }

  function closeReportModal() {
    if (reportModalBackdrop) reportModalBackdrop.classList.add("hidden");
  }

  async function submitReport() {
    const peerEmail = currentChatPeerEmail();
    if (!peerEmail) { setReportMessage("Open a conversation first.", "error"); return; }
    if (!db) { setReportMessage("Reporting needs Firebase configured.", "error"); return; }
    try {
      setReportMessage("Sending…", "warning");
      const activeConv = document.querySelector(".rl-conv-item.active");
      const conversationId = activeConv ? activeConv.getAttribute("data-conv-id") : null;
      await db.collection("reports").add({
        reportedBy: me.email,
        reportedUser: peerEmail,
        reason: reportReasonSelect ? reportReasonSelect.value : "other",
        details: reportDetailsInput ? reportDetailsInput.value.trim().slice(0, 500) : "",
        conversationId: conversationId,
        status: "open",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      setReportMessage("Report sent. Thank you.", "success");
      window.setTimeout(closeReportModal, 900);
    } catch (e) {
      setReportMessage("Could not send report: " + e.message, "error");
    }
  }

  function wireReportModal() {
    if (!reportPeerBtn || !reportModalBackdrop) return;
    reportPeerBtn.addEventListener("click", openReportModal);
    if (reportCancelBtn) reportCancelBtn.addEventListener("click", closeReportModal);
    if (reportSubmitBtn) reportSubmitBtn.addEventListener("click", submitReport);
    reportModalBackdrop.addEventListener("click", (event) => {
      if (event.target === reportModalBackdrop) closeReportModal();
    });
  }

  function initBlock() {
    wirePeerMenu();
    wireReportModal();
    db = getFirebaseDb();
    if (!db) return; // same as chat.js/friends.js: needs Firebase configured
    listenMyBlockedAndFriends();
    listenWhoBlockedMe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBlock);
  } else {
    initBlock();
  }
})();
