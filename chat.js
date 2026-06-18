// ─── Relay chat ─────────────────────────────────────────────────────────
// Drives chat.html: conversation list, realtime 1:1 messaging, presence,
// typing indicator, image attachments, emoji reactions, read receipts,
// and in-conversation search.

(function () {
  const me = getCurrentUser();
  if (!me) return; // auth.js already redirects; this just avoids a crash mid-redirect

  const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
  const AVATAR_COLORS = ["#FF9F40", "#6FCF8E", "#5AC8E2", "#E2675A", "#C792EA", "#F4D35E"];
  const HEARTBEAT_MS = 20000;
  const ONLINE_WINDOW_MS = 60000;
  const MAX_IMAGE_DIMENSION = 1024;
  const MAX_IMAGE_BYTES_OUT = 700000;
  const MAX_VOICE_MS = 60000;
  const MAX_VOICE_BYTES_OUT = 900000;

  // ---- dom refs ----
  const appEl = document.getElementById("rl-app");
  const myAvatarSlot = document.getElementById("my-avatar-slot");
  const myNameEl = document.getElementById("my-name");
  const myEmailEl = document.getElementById("my-email");
  const sideProfileToggle = document.getElementById("side-profile-toggle");
  const sideDropdown = document.getElementById("side-dropdown");
  const logoutBtn = document.getElementById("logout-btn");

  const userSearchInput = document.getElementById("user-search-input");
  const userSearchResults = document.getElementById("user-search-results");

  const convsListEl = document.getElementById("conversations-list");
  const convsEmptyHint = document.getElementById("conversations-empty-hint");

  const emptyStateEl = document.getElementById("empty-state");
  const chatViewEl = document.getElementById("chat-view");
  const backBtn = document.getElementById("back-btn");
  const peerAvatarSlot = document.getElementById("peer-avatar-slot");
  const peerNameEl = document.getElementById("peer-name");
  const peerSubEl = document.getElementById("peer-sub");
  const notificationsToggle = document.getElementById("notifications-toggle");
  const chatSearchToggle = document.getElementById("chat-search-toggle");
  const chatSearchBar = document.getElementById("chat-search-bar");
  const chatSearchInput = document.getElementById("chat-search-input");
  const chatSearchCount = document.getElementById("chat-search-count");
  const chatSearchClose = document.getElementById("chat-search-close");

  const messagesListEl = document.getElementById("messages-list");
  const imagePreviewWrap = document.getElementById("image-preview-wrap");
  const imagePreviewImg = document.getElementById("image-preview");
  const removeImageBtn = document.getElementById("remove-image-btn");
  const voicePreviewWrap = document.getElementById("voice-preview-wrap");
  const voicePreviewAudio = document.getElementById("voice-preview");
  const voicePreviewLabel = document.getElementById("voice-preview-label");
  const removeVoiceBtn = document.getElementById("remove-voice-btn");
  const voiceRecordBtn = document.getElementById("voice-record-btn");
  const composeForm = document.getElementById("compose-form");
  const messageInput = document.getElementById("message-input");
  const imageInput = document.getElementById("image-input");
  const composeError = document.getElementById("compose-error");

  // ---- state ----
  let db = null;
  let allUsersCache = [];
  let peerExtraCache = {};
  let conversationsCache = [];
  let currentConvId = null;
  let currentPeer = null;
  let currentMessages = [];
  let pendingImageDataUrl = null;
  let pendingVoiceDataUrl = null;
  let pendingVoiceType = "";
  let pendingVoiceDurationMs = 0;
  let mediaRecorder = null;
  let mediaStream = null;
  let voiceChunks = [];
  let voiceStartedAt = 0;
  let voiceStopTimer = null;
  let chatSearchQuery = "";
  let isTypingFlag = false;
  let typingClearTimer = null;
  let currentPeerTyping = false;
  let newestMessageSeenAt = 0;

  let unsubConvDoc = null;
  let unsubPeerDoc = null;
  let unsubMessages = null;

  // ---- small helpers ----
  function colorForEmail(input) {
    const str = String(input || "x");
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  function initialFor(user) {
    const source = (user && (user.name || user.email)) || "?";
    return source.trim().charAt(0).toUpperCase() || "?";
  }

  function avatarHtml(user, size) {
    const photo = user && user.profilePhoto;
    if (photo) {
      return `<img class="rl-avatar" style="width:${size}px;height:${size}px" src="${photo}" alt="">`;
    }
    const bg = colorForEmail((user && user.email) || (user && user.name));
    const letter = escapeAuthHtml(initialFor(user));
    const fontSize = Math.round(size * 0.42);
    return `<div class="rl-avatar" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg};color:#1A1206;font-weight:700;font-family:var(--font-display);font-size:${fontSize}px">${letter}</div>`;
  }

  function isOnline(lastActive) {
    if (!lastActive || typeof lastActive.toMillis !== "function") return false;
    return Date.now() - lastActive.toMillis() < ONLINE_WINDOW_MS;
  }

  function timeAgo(lastActive) {
    if (!lastActive || typeof lastActive.toMillis !== "function") return "a while ago";
    const diffMs = Date.now() - lastActive.toMillis();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function formatClock(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== "function") return "";
    return timestamp.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function dayLabel(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== "function") return "";
    const date = timestamp.toDate();
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(date, today)) return "Today";
    if (sameDay(date, yesterday)) return "Yesterday";
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function makeConvId(emailA, emailB) {
    return [emailKey(emailA), emailKey(emailB)].sort().join("__");
  }

  function profileFor(email) {
    const found = allUsersCache.find((u) => u.email === email) || peerExtraCache[email];
    if (found) return found;
    if (db) {
      db.collection("users").doc(emailKey(email)).get().then((doc) => {
        if (doc.exists) {
          peerExtraCache[email] = doc.data();
          renderConversationsList();
        }
      }).catch(() => {});
    }
    return { name: email.split("@")[0], email, profilePhoto: "" };
  }

  function showComposeError(text) {
    composeError.textContent = text;
    composeError.classList.remove("hidden");
    window.setTimeout(() => composeError.classList.add("hidden"), 4000);
  }

  // ---- my profile + heartbeat ----
  function renderMyProfile() {
    myAvatarSlot.innerHTML = avatarHtml(me, 36);
    myNameEl.textContent = me.name || me.email;
    myEmailEl.textContent = me.email;
  }

  function heartbeatTick() {
    if (!db) return;
    db.collection("users").doc(emailKey(me.email)).set({
      lastActive: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }

  function startHeartbeat() {
    syncUserToFirebase(me);
    heartbeatTick();
    window.setInterval(() => {
      heartbeatTick();
      loadAllUsers();
    }, HEARTBEAT_MS);
  }

  // ---- user search / starting conversations ----
  function loadAllUsers() {
    if (!db) return Promise.resolve();
    return db.collection("users").get().then((snap) => {
      allUsersCache = snap.docs.map((d) => d.data()).filter((u) => u.email && u.email !== me.email);
    }).catch(() => {});
  }

  function renderUserSearchResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      userSearchResults.classList.add("hidden");
      userSearchResults.innerHTML = "";
      return;
    }
    const matches = allUsersCache.filter((u) =>
      (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)
    ).slice(0, 8);

    if (matches.length === 0) {
      userSearchResults.innerHTML = `<p class="rl-search-empty">No one found for "${escapeAuthHtml(query.trim())}"</p>`;
    } else {
      userSearchResults.innerHTML = matches.map((u, i) => `
        <div class="rl-search-hit" data-index="${i}">
          ${avatarHtml(u, 32)}
          <div>
            <p class="rl-conv-name">${escapeAuthHtml(u.name || u.email)}</p>
            <p class="rl-conv-last">${escapeAuthHtml(u.email)}</p>
          </div>
        </div>
      `).join("");
      Array.from(userSearchResults.querySelectorAll(".rl-search-hit")).forEach((el, i) => {
        el.addEventListener("click", () => {
          openConversationWith(matches[i]);
          userSearchInput.value = "";
          userSearchResults.classList.add("hidden");
        });
      });
    }
    userSearchResults.classList.remove("hidden");
  }

  async function openConversationWith(user) {
    if (!db) return;
    const convId = makeConvId(me.email, user.email);
    const ref = db.collection("conversations").doc(convId);
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          participants: [me.email, user.email].sort(),
          lastMessage: "",
          lastAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastSender: "",
          [`unread_${emailKey(me.email)}`]: 0,
          [`unread_${emailKey(user.email)}`]: 0,
          [`typing_${emailKey(me.email)}`]: false,
          [`typing_${emailKey(user.email)}`]: false,
        });
      }
    } catch (e) {
      console.warn("Relay: could not open conversation —", e.message);
    }
    selectConversation(convId, user);
  }

  // ---- conversations list ----
  function listenConversations() {
    if (!db) return;
    db.collection("conversations")
      .where("participants", "array-contains", me.email)
      .onSnapshot((snap) => {
        conversationsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        conversationsCache.sort((a, b) => (b.lastAt ? b.lastAt.toMillis() : 0) - (a.lastAt ? a.lastAt.toMillis() : 0));
        renderConversationsList();
      }, (err) => {
        console.warn("Relay: conversations listener error —", err.message);
        convsEmptyHint.textContent = "Couldn't load conversations. Open the browser console — Firestore may need its rules updated (see README.md).";
        convsEmptyHint.classList.remove("hidden");
      });
  }

  function renderConversationsList() {
    if (conversationsCache.length === 0) {
      convsEmptyHint.classList.remove("hidden");
      Array.from(convsListEl.querySelectorAll(".rl-conv-item")).forEach((el) => el.remove());
      return;
    }
    convsEmptyHint.classList.add("hidden");

    const itemsHtml = conversationsCache.map((conv) => {
      const peerEmail = (conv.participants || []).find((e) => e !== me.email) || (conv.participants || [])[0] || "";
      const peer = profileFor(peerEmail);
      const unread = conv[`unread_${emailKey(me.email)}`] || 0;
      const online = isOnline(peer.lastActive);
      const isActive = conv.id === currentConvId;
      return `
        <div class="rl-conv-item ${isActive ? "active" : ""} ${unread > 0 ? "has-unread" : ""}" data-conv-id="${conv.id}" data-peer-email="${escapeAuthHtml(peerEmail)}">
          <div class="rl-conv-avatar-wrap">
            ${avatarHtml(peer, 42)}
            ${online ? '<span class="rl-online-dot"></span>' : ""}
          </div>
          <div class="rl-conv-info">
            <p class="rl-conv-name">${escapeAuthHtml(peer.name || peer.email)}</p>
            <p class="rl-conv-last">${escapeAuthHtml(conv.lastMessage || "Say hello 👋")}</p>
          </div>
          <div class="rl-conv-meta">
            <p class="rl-conv-time">${conv.lastAt ? formatClock(conv.lastAt) : ""}</p>
            ${unread > 0 ? `<span class="rl-unread-dot">${unread > 9 ? "9+" : unread}</span>` : ""}
          </div>
        </div>
      `;
    }).join("");

    convsListEl.innerHTML = itemsHtml;
    convsListEl.appendChild(convsEmptyHint);

    Array.from(convsListEl.querySelectorAll(".rl-conv-item")).forEach((el) => {
      el.addEventListener("click", () => {
        const peerEmail = el.getAttribute("data-peer-email");
        selectConversation(el.getAttribute("data-conv-id"), profileFor(peerEmail));
      });
    });
  }

  // ---- active conversation ----
  function selectConversation(convId, peer) {
    if (unsubConvDoc) unsubConvDoc();
    if (unsubPeerDoc) unsubPeerDoc();
    if (unsubMessages) unsubMessages();

    currentConvId = convId;
    currentPeer = peer;
    currentMessages = [];
    chatSearchQuery = "";
    chatSearchInput.value = "";
    chatSearchBar.classList.add("hidden");
    currentPeerTyping = false;

    emptyStateEl.classList.add("hidden");
    chatViewEl.classList.remove("hidden");
    appEl.classList.add("rl-chat-open");

    peerAvatarSlot.innerHTML = avatarHtml(peer, 38);
    peerNameEl.textContent = peer.name || peer.email;
    renderPeerSub();
    renderConversationsList();

    const convRef = db.collection("conversations").doc(convId);
    convRef.update({ [`unread_${emailKey(me.email)}`]: 0 }).catch(() => {});

    unsubConvDoc = convRef.onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();
      currentPeerTyping = !!data[`typing_${emailKey(peer.email)}`];
      renderPeerSub();
    });

    unsubPeerDoc = db.collection("users").doc(emailKey(peer.email)).onSnapshot((doc) => {
      if (!doc.exists) return;
      currentPeer = { ...currentPeer, ...doc.data() };
      peerExtraCache[peer.email] = currentPeer;
      renderPeerSub();
    });

    unsubMessages = convRef.collection("messages").orderBy("createdAt", "asc").limitToLast(200)
      .onSnapshot((snap) => {
        currentMessages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        notifyForIncomingMessages(currentMessages);
        markVisibleMessagesRead();
        renderMessages();
      }, (err) => {
        console.warn("Relay: messages listener error —", err.message);
      });
  }

  function renderPeerSub() {
    if (currentPeerTyping) {
      peerSubEl.textContent = "typing…";
      peerSubEl.classList.add("typing");
      return;
    }
    peerSubEl.classList.remove("typing");
    if (isOnline(currentPeer && currentPeer.lastActive)) {
      peerSubEl.textContent = "online";
    } else {
      peerSubEl.textContent = currentPeer && currentPeer.lastActive ? `last seen ${timeAgo(currentPeer.lastActive)}` : "";
    }
  }

  function markVisibleMessagesRead() {
    if (!currentConvId) return;
    const batch = db.batch();
    let needsCommit = false;
    currentMessages.forEach((msg) => {
      if (msg.sender !== me.email && !(msg.readBy || []).includes(me.email)) {
        const ref = db.collection("conversations").doc(currentConvId).collection("messages").doc(msg.id);
        batch.update(ref, { readBy: firebase.firestore.FieldValue.arrayUnion(me.email) });
        needsCommit = true;
      }
    });
    if (needsCommit) batch.commit().catch(() => {});
  }

  // ---- rendering messages ----
  function renderMessages() {
    const wasNearBottom = messagesListEl.scrollHeight - messagesListEl.scrollTop - messagesListEl.clientHeight < 140;
    const query = chatSearchQuery.trim().toLowerCase();
    let matchCount = 0;

    let html = "";
    let lastDay = "";
    currentMessages.forEach((msg, index) => {
      const day = dayLabel(msg.createdAt);
      if (day && day !== lastDay) {
        html += `<div class="rl-day-divider">${day}</div>`;
        lastDay = day;
      }
      const isMine = msg.sender === me.email;
      const nextMsg = currentMessages[index + 1];
      const lastInGroup = !nextMsg || nextMsg.sender !== msg.sender;
      const isMatch = !!(query && msg.text && msg.text.toLowerCase().includes(query));
      if (isMatch) matchCount++;

      let bubbleInner = "";
      if (msg.text) bubbleInner += `<div>${escapeAuthHtml(msg.text).replaceAll("\n", "<br>")}</div>`;
      if (msg.imageUrl) bubbleInner += `<img class="rl-msg-img" src="${msg.imageUrl}" alt="Shared photo">`;
      if (msg.audioUrl) {
        const duration = msg.audioDurationMs ? ` · ${formatDuration(msg.audioDurationMs)}` : "";
        bubbleInner += `<div class="rl-voice-message"><span>Voice message${duration}</span><audio controls preload="metadata" src="${msg.audioUrl}"></audio></div>`;
      }

      const reactions = msg.reactions || {};
      const reactionEntries = Object.entries(reactions).filter(([, emails]) => emails && emails.length > 0);
      const reactionsHtml = reactionEntries.length
        ? `<div class="rl-msg-reactions">${reactionEntries.map(([emoji, emails]) =>
            `<span class="rl-reaction" data-emoji="${emoji}" data-msg-id="${msg.id}">${emoji} ${emails.length > 1 ? emails.length : ""}</span>`
          ).join("")}</div>`
        : "";

      const isLastOverall = index === currentMessages.length - 1;
      const seenHtml = (isMine && isLastOverall && (msg.readBy || []).includes(currentPeer.email))
        ? `<span class="rl-msg-seen">Seen</span>` : "";

      const avatarMarkup = isMine
        ? ""
        : (lastInGroup ? avatarHtml(currentPeer, 26) : `<span style="display:inline-block;width:26px;flex-shrink:0"></span>`);

      html += `
        <div class="rl-msg-row ${isMine ? "mine" : ""}" data-msg-id="${msg.id}">
          ${avatarMarkup}
          <div class="rl-msg-bubble-col">
            <div class="rl-bubble ${isMatch ? "rl-match" : ""}">${bubbleInner}</div>
            ${reactionsHtml}
            <div class="rl-msg-actions">
              <span class="rl-msg-time">${formatClock(msg.createdAt)}</span>
              <button class="rl-msg-react-btn" data-msg-id="${msg.id}" type="button" aria-label="React">🙂</button>
              ${isMine ? `<button class="rl-msg-delete" data-msg-id="${msg.id}" type="button" aria-label="Delete message">🗑</button>` : ""}
              ${seenHtml}
            </div>
          </div>
        </div>
      `;
    });

    messagesListEl.innerHTML = html || `<p class="rl-hint">No messages yet. Say hello 👋</p>`;

    chatSearchCount.textContent = query ? (matchCount === 0 ? "No matches" : `${matchCount} match${matchCount === 1 ? "" : "es"}`) : "";

    wireMessageActions();

    if (wasNearBottom || currentMessages.length <= 1) {
      messagesListEl.scrollTop = messagesListEl.scrollHeight;
    }
  }

  function wireMessageActions() {
    Array.from(messagesListEl.querySelectorAll(".rl-msg-react-btn")).forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openEmojiPicker(btn);
      });
    });
    Array.from(messagesListEl.querySelectorAll(".rl-msg-delete")).forEach((btn) => {
      btn.addEventListener("click", () => deleteMessage(btn.getAttribute("data-msg-id")));
    });
    Array.from(messagesListEl.querySelectorAll(".rl-reaction")).forEach((el) => {
      el.addEventListener("click", () => toggleReaction(el.getAttribute("data-msg-id"), el.getAttribute("data-emoji")));
    });
  }

  function openEmojiPicker(anchorBtn) {
    closeEmojiPicker();
    const msgId = anchorBtn.getAttribute("data-msg-id");
    const picker = document.createElement("div");
    picker.className = "rl-emoji-picker";
    picker.id = "active-emoji-picker";
    picker.innerHTML = REACTION_EMOJIS.map((e) => `<button class="rl-emoji-opt" type="button" data-emoji="${e}">${e}</button>`).join("");
    anchorBtn.parentElement.appendChild(picker);
    Array.from(picker.querySelectorAll(".rl-emoji-opt")).forEach((opt) => {
      opt.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleReaction(msgId, opt.getAttribute("data-emoji"));
        closeEmojiPicker();
      });
    });
  }

  function closeEmojiPicker() {
    const existing = document.getElementById("active-emoji-picker");
    if (existing) existing.remove();
  }

  function toggleReaction(msgId, emoji) {
    if (!currentConvId) return;
    const msg = currentMessages.find((m) => m.id === msgId);
    const already = !!(msg && msg.reactions && msg.reactions[emoji] && msg.reactions[emoji].includes(me.email));
    const ref = db.collection("conversations").doc(currentConvId).collection("messages").doc(msgId);
    const op = already ? firebase.firestore.FieldValue.arrayRemove(me.email) : firebase.firestore.FieldValue.arrayUnion(me.email);
    ref.update({ [`reactions.${emoji}`]: op }).catch(() => {});
  }

  function deleteMessage(msgId) {
    if (!currentConvId) return;
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    db.collection("conversations").doc(currentConvId).collection("messages").doc(msgId).delete().catch(() => {});
  }

  // ---- browser notifications ----
  function notifyForIncomingMessages(messages) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!document.hidden || messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (!latest || latest.sender === me.email || !latest.createdAt || typeof latest.createdAt.toMillis !== "function") return;
    const latestMs = latest.createdAt.toMillis();
    if (latestMs <= newestMessageSeenAt) return;
    newestMessageSeenAt = latestMs;
    const body = latest.text || (latest.imageUrl ? "Sent a photo" : "New message");
    new Notification(currentPeer && (currentPeer.name || currentPeer.email) || "Relay", {
      body: body.length > 120 ? body.slice(0, 117) + "…" : body,
      tag: currentConvId || "relay-message",
    });
  }

  function updateNotificationButton() {
    if (!notificationsToggle) return;
    if (typeof Notification === "undefined") { notificationsToggle.classList.add("hidden"); return; }
    notificationsToggle.textContent = Notification.permission === "granted" ? "🔕" : "🔔";
    notificationsToggle.title = Notification.permission === "granted" ? "Notifications enabled" : "Enable notifications";
  }

  // ---- typing indicator (mine) ----
  function notifyTyping(active) {
    if (!currentConvId || isTypingFlag === active) return;
    isTypingFlag = active;
    db.collection("conversations").doc(currentConvId).update({
      [`typing_${emailKey(me.email)}`]: active,
    }).catch(() => {});
  }

  // ---- image attach ----
  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.onload = () => {
        img.onerror = () => reject(new Error("Could not decode image"));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
            else { width = Math.round(width * (maxDim / height)); height = maxDim; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleImageInput(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { showComposeError("Please choose an image file."); imageInput.value = ""; return; }
    if (file.size > 8 * 1024 * 1024) { showComposeError("That image is too large. Try one under 8MB."); imageInput.value = ""; return; }

    try {
      let dataUrl = await compressImage(file, MAX_IMAGE_DIMENSION, 0.72);
      if (dataUrl.length > MAX_IMAGE_BYTES_OUT) dataUrl = await compressImage(file, 720, 0.6);
      if (dataUrl.length > MAX_IMAGE_BYTES_OUT) {
        showComposeError("This image is still too large after compressing. Try a smaller photo.");
      } else {
        pendingImageDataUrl = dataUrl;
        imagePreviewImg.src = dataUrl;
        imagePreviewWrap.classList.remove("hidden");
      }
    } catch (e) {
      showComposeError("Couldn't process that image.");
    }
    imageInput.value = "";
  }

  function clearPendingImage() {
    pendingImageDataUrl = null;
    imagePreviewWrap.classList.add("hidden");
    imagePreviewImg.src = "";
  }

  // ---- voice recording ----
  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round((ms || 0) / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = String(totalSeconds % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function voiceMimeType() {
    if (typeof MediaRecorder === "undefined") return "";
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read recording"));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function renderVoicePreview() {
    if (!pendingVoiceDataUrl) {
      voicePreviewWrap.classList.add("hidden");
      voicePreviewAudio.removeAttribute("src");
      voicePreviewLabel.textContent = "Voice message ready";
      return;
    }
    voicePreviewAudio.src = pendingVoiceDataUrl;
    voicePreviewLabel.textContent = `Voice message ready · ${formatDuration(pendingVoiceDurationMs)}`;
    voicePreviewWrap.classList.remove("hidden");
  }

  function clearPendingVoice() {
    pendingVoiceDataUrl = null;
    pendingVoiceType = "";
    pendingVoiceDurationMs = 0;
    renderVoicePreview();
  }

  function stopVoiceTracks() {
    if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  function updateVoiceButton(recording) {
    if (!voiceRecordBtn) return;
    voiceRecordBtn.classList.toggle("recording", recording);
    voiceRecordBtn.textContent = recording ? "■" : "🎙";
    voiceRecordBtn.setAttribute("aria-label", recording ? "Stop recording" : "Record voice message");
    voiceRecordBtn.title = recording ? "Stop recording" : "Record voice message";
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      showComposeError("Voice recording isn't supported in this browser.");
      return;
    }
    if (pendingVoiceDataUrl) clearPendingVoice();
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      const mimeType = voiceMimeType();
      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      voiceStartedAt = Date.now();
      mediaRecorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) voiceChunks.push(event.data); };
      mediaRecorder.onstop = handleVoiceStop;
      mediaRecorder.start();
      updateVoiceButton(true);
      voiceStopTimer = window.setTimeout(() => stopVoiceRecording(), MAX_VOICE_MS);
    } catch (error) {
      stopVoiceTracks();
      showComposeError("Microphone access was blocked or unavailable.");
    }
  }

  async function handleVoiceStop() {
    window.clearTimeout(voiceStopTimer);
    updateVoiceButton(false);
    stopVoiceTracks();
    const type = (mediaRecorder && mediaRecorder.mimeType) || voiceMimeType() || "audio/webm";
    mediaRecorder = null;
    if (voiceChunks.length === 0) { showComposeError("No audio was recorded."); return; }
    const duration = Date.now() - voiceStartedAt;
    const blob = new Blob(voiceChunks, { type });
    voiceChunks = [];
    if (blob.size > MAX_VOICE_BYTES_OUT) { showComposeError("Voice message is too long. Keep it under 60 seconds."); return; }
    try {
      pendingVoiceDataUrl = await blobToDataUrl(blob);
      pendingVoiceType = type;
      pendingVoiceDurationMs = duration;
      renderVoicePreview();
    } catch (error) {
      showComposeError("Couldn't prepare that voice message.");
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  function toggleVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") stopVoiceRecording();
    else startVoiceRecording();
  }

  // ---- sending ----
  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text && !pendingImageDataUrl && !pendingVoiceDataUrl) return;
    if (!currentConvId) return;

    const convRef = db.collection("conversations").doc(currentConvId);
    const message = {
      sender: me.email,
      text: text || null,
      imageUrl: pendingImageDataUrl || null,
      audioUrl: pendingVoiceDataUrl || null,
      audioType: pendingVoiceType || null,
      audioDurationMs: pendingVoiceDurationMs || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      reactions: {},
      readBy: [me.email],
    };

    messageInput.value = "";
    const imageToSend = pendingImageDataUrl;
    const voiceToSend = pendingVoiceDataUrl;
    clearPendingImage();
    clearPendingVoice();
    notifyTyping(false);

    try {
      await convRef.collection("messages").add(message);
      await convRef.update({
        lastMessage: text || (imageToSend ? "📷 Photo" : (voiceToSend ? "🎙 Voice message" : "")),
        lastAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastSender: me.email,
        [`unread_${emailKey(currentPeer.email)}`]: firebase.firestore.FieldValue.increment(1),
        [`typing_${emailKey(me.email)}`]: false,
      });
    } catch (e) {
      showComposeError("Message didn't send: " + e.message);
    }
  }

  // ---- chat search ----
  function setChatSearchQuery(value) {
    chatSearchQuery = value;
    renderMessages();
  }

  // ---- wiring ----
  function wireUi() {
    sideProfileToggle.addEventListener("click", (event) => {
      if (event.target.closest("#side-dropdown")) return;
      sideDropdown.classList.toggle("hidden");
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#side-profile-toggle")) sideDropdown.classList.add("hidden");
      if (!event.target.closest("#user-search-input") && !event.target.closest("#user-search-results")) {
        userSearchResults.classList.add("hidden");
      }
      if (!event.target.closest(".rl-msg-actions")) closeEmojiPicker();
    });
    logoutBtn.addEventListener("click", () => {
      logoutCurrentUser();
      window.location.href = "login.html";
    });

    let searchDebounce = null;
    userSearchInput.addEventListener("input", () => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => renderUserSearchResults(userSearchInput.value), 120);
    });
    userSearchInput.addEventListener("focus", () => {
      if (allUsersCache.length === 0) loadAllUsers();
    });

    updateNotificationButton();
    if (notificationsToggle) notificationsToggle.addEventListener("click", async () => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "default") await Notification.requestPermission();
      updateNotificationButton();
    });

    backBtn.addEventListener("click", () => appEl.classList.remove("rl-chat-open"));

    chatSearchToggle.addEventListener("click", () => {
      chatSearchBar.classList.toggle("hidden");
      if (!chatSearchBar.classList.contains("hidden")) chatSearchInput.focus();
      else setChatSearchQuery("");
    });
    chatSearchClose.addEventListener("click", () => {
      chatSearchBar.classList.add("hidden");
      chatSearchInput.value = "";
      setChatSearchQuery("");
    });
    let chatSearchDebounce = null;
    chatSearchInput.addEventListener("input", () => {
      window.clearTimeout(chatSearchDebounce);
      chatSearchDebounce = window.setTimeout(() => setChatSearchQuery(chatSearchInput.value), 120);
    });

    composeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage();
    });
    messageInput.addEventListener("input", () => {
      notifyTyping(messageInput.value.length > 0);
      window.clearTimeout(typingClearTimer);
      typingClearTimer = window.setTimeout(() => notifyTyping(false), 2500);
    });
    imageInput.addEventListener("change", handleImageInput);
    removeImageBtn.addEventListener("click", clearPendingImage);
    if (voiceRecordBtn) voiceRecordBtn.addEventListener("click", toggleVoiceRecording);
    if (removeVoiceBtn) removeVoiceBtn.addEventListener("click", clearPendingVoice);
  }

  // ---- boot ----
  function init() {
    renderMyProfile();
    wireUi();

    db = getFirebaseDb();
    if (!db) {
      emptyStateEl.innerHTML = `
        <h2>Connect Firebase to start chatting</h2>
        <p>Open <code>config.js</code> and paste in your Firebase project's web config — steps are in README.md. Relay needs this to sync messages between accounts.</p>
      `;
      convsEmptyHint.textContent = "Waiting on Firebase setup — see README.md.";
      return;
    }

    startHeartbeat();
    loadAllUsers();
    listenConversations();
  }

  init();
})();
