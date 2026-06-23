// ─── ADDED: Relay admin / moderation view ───────────────────────────────
// Drives admin.html: report queue + rate-limit strikes.
//
// IMPORTANT: the ADMIN_EMAILS list below is for showing/hiding UI only.
// It is NOT what makes this page secure — firestore.rules' isAdmin()
// function is what actually decides whether reads of /reports succeed.
// If you add someone here but forget to add them to firestore.rules (and
// republish) and functions/index.js (and redeploy), their reads will be
// rejected and they'll see an empty list, not real data — which is the
// correct, safe failure mode, but worth knowing about.

(function () {
  const me = getCurrentUser();
  if (!me) return;

  // EDIT THIS to match ADMIN_EMAILS in firestore.rules and functions/index.js.
  const ADMIN_EMAILS = ["you@example.com"];

  const deniedEl = document.getElementById("admin-denied");
  const contentEl = document.getElementById("admin-content");
  if (!deniedEl || !contentEl) return; // not on admin.html

  const reportsListEl = document.getElementById("admin-reports-list");
  const reportsEmptyEl = document.getElementById("admin-reports-empty");
  const strikesListEl = document.getElementById("admin-strikes-list");
  const strikesEmptyEl = document.getElementById("admin-strikes-empty");
  const tabOpenBtn = document.getElementById("admin-tab-open");
  const tabResolvedBtn = document.getElementById("admin-tab-resolved");
  const tabDismissedBtn = document.getElementById("admin-tab-dismissed");

  const modalBackdrop = document.getElementById("admin-report-modal-backdrop");
  const detailEl = document.getElementById("admin-report-detail");
  const disableCheckbox = document.getElementById("admin-disable-account");
  const messageEl = document.getElementById("admin-report-message");
  const dismissBtn = document.getElementById("admin-dismiss-btn");
  const resolveBtn = document.getElementById("admin-resolve-btn");

  let db = null;
  let functionsClient = null;
  let currentTab = "open";
  let currentReports = [];
  let activeReportId = null;

  function setMessage(text, type) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.className = `form-message ${type || ""}`;
  }

  function formatTimestamp(ts) {
    if (!ts || typeof ts.toDate !== "function") return "just now";
    return ts.toDate().toLocaleString();
  }

  function switchTab(tab) {
    currentTab = tab;
    [tabOpenBtn, tabResolvedBtn, tabDismissedBtn].forEach((btn) => btn && btn.classList.remove("active"));
    if (tab === "open" && tabOpenBtn) tabOpenBtn.classList.add("active");
    if (tab === "resolved" && tabResolvedBtn) tabResolvedBtn.classList.add("active");
    if (tab === "dismissed" && tabDismissedBtn) tabDismissedBtn.classList.add("active");
    loadReports();
  }

  function renderReports() {
    if (currentReports.length === 0) {
      reportsEmptyEl.classList.remove("hidden");
      Array.from(reportsListEl.querySelectorAll(".rl-friend-row")).forEach((el) => el.remove());
      return;
    }
    reportsEmptyEl.classList.add("hidden");

    reportsListEl.innerHTML = currentReports.map((r) => `
      <div class="rl-friend-row rl-report-row" data-report-id="${r.id}">
        <div class="rl-conv-info">
          <p class="rl-conv-name">${escapeAuthHtml(r.reason || "other")} — ${escapeAuthHtml(r.reportedUser || "unknown")}</p>
          <p class="rl-conv-last">Reported by ${escapeAuthHtml(r.reportedBy || "unknown")} · ${escapeAuthHtml(formatTimestamp(r.createdAt))}</p>
        </div>
        <div class="rl-friend-actions">
          <button class="btn btn-small btn-secondary rl-view-report-btn" type="button">${currentTab === "open" ? "Review" : "View"}</button>
        </div>
      </div>
    `).join("");
    reportsListEl.appendChild(reportsEmptyEl);

    Array.from(reportsListEl.querySelectorAll(".rl-view-report-btn")).forEach((btn) => {
      btn.addEventListener("click", (event) => {
        const row = event.target.closest(".rl-report-row");
        openReportDetail(row.getAttribute("data-report-id"));
      });
    });
  }

  function loadReports() {
    if (!db) return;
    db.collection("reports").where("status", "==", currentTab).orderBy("createdAt", "desc").limit(100)
      .get().then((snap) => {
        currentReports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderReports();
      }).catch((e) => {
        console.warn("Relay admin: could not load reports —", e.message);
        currentReports = [];
        renderReports();
      });
  }

  function openReportDetail(reportId) {
    const report = currentReports.find((r) => r.id === reportId);
    if (!report) return;
    activeReportId = reportId;
    setMessage("", "");
    if (disableCheckbox) disableCheckbox.checked = false;
    detailEl.innerHTML = `
      <p class="rl-legal-p"><strong>Reported user:</strong> ${escapeAuthHtml(report.reportedUser || "unknown")}</p>
      <p class="rl-legal-p"><strong>Reported by:</strong> ${escapeAuthHtml(report.reportedBy || "unknown")}</p>
      <p class="rl-legal-p"><strong>Reason:</strong> ${escapeAuthHtml(report.reason || "other")}</p>
      <p class="rl-legal-p"><strong>Details:</strong> ${escapeAuthHtml(report.details || "(none provided)")}</p>
      <p class="rl-legal-p"><strong>Conversation:</strong> ${escapeAuthHtml(report.conversationId || "(none)")}</p>
      <p class="rl-legal-p"><strong>Submitted:</strong> ${escapeAuthHtml(formatTimestamp(report.createdAt))}</p>
    `;
    const isOpen = report.status === "open";
    if (dismissBtn) dismissBtn.classList.toggle("hidden", !isOpen);
    if (resolveBtn) resolveBtn.classList.toggle("hidden", !isOpen);
    if (disableCheckbox) disableCheckbox.closest("label").classList.toggle("hidden", !isOpen);
    modalBackdrop.classList.remove("hidden");
  }

  function closeReportDetail() {
    modalBackdrop.classList.add("hidden");
    activeReportId = null;
  }

  async function resolveActiveReport(action) {
    if (!activeReportId) return;
    setMessage("Saving…", "warning");
    try {
      if (functionsClient) {
        // Preferred path: the Cloud Function also (optionally) disables
        // the reported Firebase Auth account, which a plain client write
        // can never do (that needs admin SDK privileges).
        const callResolve = functionsClient.httpsCallable("resolveReport");
        await callResolve({
          reportId: activeReportId,
          action,
          disableReportedAccount: !!(disableCheckbox && disableCheckbox.checked),
        });
      } else {
        // Fallback: functions/ hasn't been deployed. A direct Firestore
        // update still works for status changes (allowed by firestore.rules
        // for admins) but can't disable the account.
        await db.collection("reports").doc(activeReportId).update({
          status: action,
          reviewedBy: me.email,
          reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      setMessage("Saved.", "success");
      window.setTimeout(() => {
        closeReportDetail();
        loadReports();
      }, 500);
    } catch (e) {
      setMessage("Could not save: " + e.message, "error");
    }
  }

  function renderStrikes(strikes) {
    if (!strikesListEl) return;
    if (strikes.length === 0) {
      strikesEmptyEl.classList.remove("hidden");
      Array.from(strikesListEl.querySelectorAll(".rl-friend-row")).forEach((el) => el.remove());
      return;
    }
    strikesEmptyEl.classList.add("hidden");
    strikesListEl.innerHTML = strikes.map((s) => `
      <div class="rl-friend-row">
        <div class="rl-conv-info">
          <p class="rl-conv-name">${escapeAuthHtml(s.email || "unknown")} — ${escapeAuthHtml(s.type || "")}</p>
          <p class="rl-conv-last">${escapeAuthHtml(s.detail || "")} · ${escapeAuthHtml(formatTimestamp(s.at))}</p>
        </div>
      </div>
    `).join("");
    strikesListEl.appendChild(strikesEmptyEl);
  }

  function loadStrikes() {
    if (!db) return;
    db.collection("rateLimitStrikes").orderBy("at", "desc").limit(50).get()
      .then((snap) => renderStrikes(snap.docs.map((d) => d.data())))
      .catch(() => renderStrikes([])); // collection won't exist until functions/ is deployed and triggers once
  }

  function wireUi() {
    if (tabOpenBtn) tabOpenBtn.addEventListener("click", () => switchTab("open"));
    if (tabResolvedBtn) tabResolvedBtn.addEventListener("click", () => switchTab("resolved"));
    if (tabDismissedBtn) tabDismissedBtn.addEventListener("click", () => switchTab("dismissed"));
    if (dismissBtn) dismissBtn.addEventListener("click", () => resolveActiveReport("dismissed"));
    if (resolveBtn) resolveBtn.addEventListener("click", () => resolveActiveReport("resolved"));
    modalBackdrop.addEventListener("click", (event) => {
      if (event.target === modalBackdrop) closeReportDetail();
    });
  }

  function initAdmin() {
    if (!ADMIN_EMAILS.includes(me.email)) {
      deniedEl.classList.remove("hidden");
      return;
    }
    db = getFirebaseDb();
    if (!db) {
      deniedEl.classList.remove("hidden");
      return;
    }
    try {
      const app = firebase.app();
      if (firebase.functions) functionsClient = app.functions();
    } catch (e) {
      functionsClient = null; // Cloud Functions SDK not loaded/deployed — fall back gracefully
    }
    contentEl.classList.remove("hidden");
    wireUi();
    loadReports();
    loadStrikes();
  }

  initAdmin();
})();
