// ─── ADDED: Relay friends ───────────────────────────────────────────────
// Friend requests + friends list. This is purely additive: a friends list
// does NOT gate messaging — anyone can still start a chat with anyone, the
// same as before. Friends is a social layer on top (find people again
// easily, see who's actually a friend vs. a stranger you searched once).
//
// Data model (Firestore):
//   friendRequests/{requestId}  { from, to, status: "pending"|"accepted"|"declined", createdAt, updatedAt }
//   requestId = sorted [fromKey, toKey].join("__") so there's only ever one
//   request doc per pair (re-sending after a decline just reopens it).
//
//   users/{emailKey}.friends = string[] of friend emails — mirrored onto
//   both users' docs when a request is accepted, for fast "is this a
//   friend" checks without reading every request doc.
//
// This file only runs on chat.html (the friends panel lives in the
// sidebar there). It depends on globals already defined in auth.js
// (getCurrentUser, getFirebaseDb, escapeAuthHtml, emailKey-equivalent)
// — see the local emailKeyFriends() helper below, which mirrors the
// private emailKey() inside chat.js (not exported, so re-declared here
// under a different name to avoid clashing with anything).

(function () {
  const me = getCurrentUser();
  if (!me) return;

  const AVATAR_COLORS = ["#FF9F40", "#6FCF8E", "#5AC8E2", "#E2675A", "#C792EA", "#F4D35E"];

  function emailKeyFriends(email) {
    return String(email || "").replace(/[.#$[\]]/g, "_");
  }

  function colorForEmailFriends(input) {
    const str = String(input || "x");
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  function avatarHtmlFriends(user, size) {
    const photo = user && user.profilePhoto;
    if (photo) return `<img class="rl-avatar" style="width:${size}px;height:${size}px" src="${photo}" alt="">`;
    const bg = colorForEmailFriends((user && user.email) || (user && user.name));
    const source = (user && (user.name || user.email)) || "?";
    const letter = escapeAuthHtml(source.trim().charAt(0).toUpperCase() || "?");
    const fontSize = Math.round(size * 0.42);
    return `<div class="rl-avatar" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg};color:#1A1206;font-weight:700;font-family:var(--font-display);font-size:${fontSize}px">${letter}</div>`;
  }

  function requestIdFor(emailA, emailB) {
    return [emailKeyFriends(emailA), emailKeyFriends(emailB)].sort().join("__");
  }

  // ---- dom refs (only present on chat.html once the markup is added) ----
  const friendsTabBtn = document.getElementById("friends-tab-btn");
  const convsTabBtn = document.getElementById("conversations-tab-btn");
  const convsListEl = document.getElementById("conversations-list");
  const friendsPanelEl = document.getElementById("friends-panel");
  const friendsBadge = document.getElementById("friends-badge");
  const friendSearchInput = document.getElementById("friend-search-input");
  const friendSearchResults = document.getElementById("friend-search-results");
  const incomingRequestsList = document.getElementById("incoming-requests-list");
  const incomingRequestsEmpty = document.getElementById("incoming-requests-empty");
  const friendsListEl = document.getElementById("friends-list");
  const friendsListEmpty = document.getElementById("friends-list-empty");

  // If the markup isn't present (e.g. this script loaded on a page without
  // the friends panel), bail out quietly rather than throwing.
  if (!friendsPanelEl || !friendsTabBtn) return;

  let db = null;
  let allUsersCache = [];
  let myFriends = [];
  let incomingRequests = [];
  let outgoingPendingTo = new Set();

  function setBadge(count) {
    if (!friendsBadge) return;
    if (count > 0) {
      friendsBadge.textContent = count > 9 ? "9+" : String(count);
      friendsBadge.classList.remove("hidden");
    } else {
      friendsBadge.classList.add("hidden");
    }
  }

  function switchTab(tab) {
    const showFriends = tab === "friends";
    friendsPanelEl.classList.toggle("hidden", !showFriends);
    convsListEl.classList.toggle("hidden", showFriends);
    friendsTabBtn.classList.toggle("active", showFriends);
    convsTabBtn.classList.toggle("active", !showFriends);
  }

  function loadAllUsersForFriends() {
    if (!db) return Promise.resolve();
    return db.collection("users").get().then((snap) => {
      allUsersCache = snap.docs.map((d) => d.data()).filter((u) => u.email && u.email !== me.email);
      // ADDED: block system — hide anyone blocked in either direction from friend search.
      if (window.RelayBlock) {
        allUsersCache = allUsersCache.filter((u) => !window.RelayBlock.isBlockedEitherWay(u.email));
      }
    }).catch(() => {});
  }

  function renderFriendSearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) { friendSearchResults.classList.add("hidden"); friendSearchResults.innerHTML = ""; return; }
    const matches = allUsersCache.filter((u) =>
      (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)
    ).slice(0, 8);

    if (matches.length === 0) {
      friendSearchResults.innerHTML = `<p class="rl-search-empty">No one found for "${escapeAuthHtml(query.trim())}"</p>`;
    } else {
      friendSearchResults.innerHTML = matches.map((u, i) => {
        const isFriend = myFriends.includes(u.email);
        const isPending = outgoingPendingTo.has(u.email);
        let actionHtml;
        if (isFriend) actionHtml = `<span class="rl-friend-status">Friends</span>`;
        else if (isPending) actionHtml = `<span class="rl-friend-status">Requested</span>`;
        else actionHtml = `<button class="btn btn-small btn-secondary rl-add-friend-btn" data-index="${i}" type="button">Add</button>`;
        return `
          <div class="rl-search-hit">
            ${avatarHtmlFriends(u, 32)}
            <div>
              <p class="rl-conv-name">${escapeAuthHtml(u.name || u.email)}</p>
              <p class="rl-conv-last">${escapeAuthHtml(u.email)}</p>
            </div>
            ${actionHtml}
          </div>
        `;
      }).join("");
      Array.from(friendSearchResults.querySelectorAll(".rl-add-friend-btn")).forEach((btn) => {
        btn.addEventListener("click", () => sendFriendRequest(matches[Number(btn.getAttribute("data-index"))]));
      });
    }
    friendSearchResults.classList.remove("hidden");
  }

  async function sendFriendRequest(targetUser) {
    if (!db || !targetUser || targetUser.email === me.email) return;
    const id = requestIdFor(me.email, targetUser.email);
    const ref = db.collection("friendRequests").doc(id);
    try {
      const snap = await ref.get();
      if (snap.exists) {
        const existing = snap.data();
        if (existing.status === "accepted") return; // already friends
        if (existing.from !== me.email) {
          // The other person's earlier request (now declined, or stale)
          // points the other direction. Clear it so this request can be
          // created fresh with me as the sender — matches the security
          // rules, which never let an update flip who 'from'/'to' are.
          await ref.delete();
        }
      }
      await ref.set({
        from: me.email,
        to: targetUser.email,
        status: "pending",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      outgoingPendingTo.add(targetUser.email);
      renderFriendSearch(friendSearchInput.value);
    } catch (e) {
      console.warn("Relay: could not send friend request —", e.message);
    }
  }

  async function respondToRequest(requestDoc, accept) {
    if (!db) return;
    const ref = db.collection("friendRequests").doc(requestDoc.id);
    try {
      await ref.update({
        status: accept ? "accepted" : "declined",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (accept) {
        const myRef = db.collection("users").doc(emailKeyFriends(me.email));
        const theirRef = db.collection("users").doc(emailKeyFriends(requestDoc.from));
        await myRef.set({ friends: firebase.firestore.FieldValue.arrayUnion(requestDoc.from) }, { merge: true });
        await theirRef.set({ friends: firebase.firestore.FieldValue.arrayUnion(me.email) }, { merge: true });
      }
    } catch (e) {
      console.warn("Relay: could not respond to friend request —", e.message);
    }
  }

  async function removeFriend(friendEmail) {
    if (!db) return;
    if (!window.confirm(`Remove ${friendEmail} from your friends?`)) return;
    try {
      const myRef = db.collection("users").doc(emailKeyFriends(me.email));
      const theirRef = db.collection("users").doc(emailKeyFriends(friendEmail));
      await myRef.set({ friends: firebase.firestore.FieldValue.arrayRemove(friendEmail) }, { merge: true });
      await theirRef.set({ friends: firebase.firestore.FieldValue.arrayRemove(me.email) }, { merge: true });
      const id = requestIdFor(me.email, friendEmail);
      await db.collection("friendRequests").doc(id).delete().catch(() => {});
    } catch (e) {
      console.warn("Relay: could not remove friend —", e.message);
    }
  }

  function profileForFriends(email) {
    return allUsersCache.find((u) => u.email === email) || { name: email.split("@")[0], email, profilePhoto: "" };
  }

  function renderIncomingRequests() {
    if (incomingRequests.length === 0) {
      incomingRequestsEmpty.classList.remove("hidden");
      Array.from(incomingRequestsList.querySelectorAll(".rl-friend-row")).forEach((el) => el.remove());
      setBadge(0);
      return;
    }
    incomingRequestsEmpty.classList.add("hidden");
    setBadge(incomingRequests.length);

    incomingRequestsList.innerHTML = incomingRequests.map((req) => {
      const fromUser = profileForFriends(req.from);
      return `
        <div class="rl-friend-row" data-request-id="${req.id}">
          ${avatarHtmlFriends(fromUser, 36)}
          <div class="rl-conv-info">
            <p class="rl-conv-name">${escapeAuthHtml(fromUser.name || fromUser.email)}</p>
            <p class="rl-conv-last">${escapeAuthHtml(fromUser.email)}</p>
          </div>
          <div class="rl-friend-actions">
            <button class="btn btn-small btn-primary rl-accept-btn" type="button">Accept</button>
            <button class="btn btn-small btn-secondary rl-decline-btn" type="button">Decline</button>
          </div>
        </div>
      `;
    }).join("");
    incomingRequestsList.appendChild(incomingRequestsEmpty);

    Array.from(incomingRequestsList.querySelectorAll(".rl-friend-row")).forEach((row) => {
      const reqId = row.getAttribute("data-request-id");
      const req = incomingRequests.find((r) => r.id === reqId);
      const acceptBtn = row.querySelector(".rl-accept-btn");
      const declineBtn = row.querySelector(".rl-decline-btn");
      if (acceptBtn) acceptBtn.addEventListener("click", () => respondToRequest(req, true));
      if (declineBtn) declineBtn.addEventListener("click", () => respondToRequest(req, false));
    });
  }

  function renderFriendsList() {
    if (myFriends.length === 0) {
      friendsListEmpty.classList.remove("hidden");
      Array.from(friendsListEl.querySelectorAll(".rl-friend-row")).forEach((el) => el.remove());
      return;
    }
    friendsListEmpty.classList.add("hidden");

    friendsListEl.innerHTML = myFriends.map((email) => {
      const friendUser = profileForFriends(email);
      return `
        <div class="rl-friend-row" data-friend-email="${escapeAuthHtml(email)}">
          ${avatarHtmlFriends(friendUser, 36)}
          <div class="rl-conv-info">
            <p class="rl-conv-name">${escapeAuthHtml(friendUser.name || friendUser.email)}</p>
            <p class="rl-conv-last">${escapeAuthHtml(friendUser.email)}</p>
          </div>
          <div class="rl-friend-actions">
            <button class="btn btn-small btn-primary rl-message-btn" type="button">Message</button>
            <button class="btn btn-small btn-secondary rl-remove-friend-btn" type="button" aria-label="Remove friend">✕</button>
          </div>
        </div>
      `;
    }).join("");
    friendsListEl.appendChild(friendsListEmpty);

    Array.from(friendsListEl.querySelectorAll(".rl-friend-row")).forEach((row) => {
      const email = row.getAttribute("data-friend-email");
      const messageBtn = row.querySelector(".rl-message-btn");
      const removeBtn = row.querySelector(".rl-remove-friend-btn");
      if (messageBtn) messageBtn.addEventListener("click", () => {
        if (window.RelayChat && window.RelayChat.openConversationWith) {
          window.RelayChat.openConversationWith(profileForFriends(email));
          switchTab("conversations");
        }
      });
      if (removeBtn) removeBtn.addEventListener("click", () => removeFriend(email));
    });
  }

  function listenFriendRequests() {
    if (!db) return;
    db.collection("friendRequests")
      .where("to", "==", me.email)
      .where("status", "==", "pending")
      .onSnapshot((snap) => {
        incomingRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderIncomingRequests();
      }, (err) => console.warn("Relay: incoming requests listener error —", err.message));

    db.collection("friendRequests")
      .where("from", "==", me.email)
      .where("status", "==", "pending")
      .onSnapshot((snap) => {
        outgoingPendingTo = new Set(snap.docs.map((d) => d.data().to));
      }, (err) => console.warn("Relay: outgoing requests listener error —", err.message));
  }

  function listenMyFriendsList() {
    if (!db) return;
    db.collection("users").doc(emailKeyFriends(me.email)).onSnapshot((doc) => {
      myFriends = (doc.exists && doc.data().friends) || [];
      renderFriendsList();
      renderFriendSearch(friendSearchInput.value);
    }, (err) => console.warn("Relay: friends list listener error —", err.message));
  }

  function wireFriendsUi() {
    friendsTabBtn.addEventListener("click", () => switchTab("friends"));
    convsTabBtn.addEventListener("click", () => switchTab("conversations"));

    let debounce = null;
    friendSearchInput.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => renderFriendSearch(friendSearchInput.value), 120);
    });
    friendSearchInput.addEventListener("focus", () => {
      if (allUsersCache.length === 0) loadAllUsersForFriends();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#friend-search-input") && !event.target.closest("#friend-search-results")) {
        friendSearchResults.classList.add("hidden");
      }
    });
  }

  function initFriends() {
    wireFriendsUi();
    db = getFirebaseDb();
    if (!db) return; // same as chat.js: friends needs Firebase configured
    loadAllUsersForFriends();
    listenFriendRequests();
    listenMyFriendsList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFriends);
  } else {
    initFriends();
  }
})();
