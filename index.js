// ─── Relay Cloud Functions ───────────────────────────────────────────────
// Firestore security rules can restrict WHAT a write looks like, but they
// can't count how many writes a user has made recently — that needs
// server-side state, which is what these functions provide.
//
// Deploy:
//   cd functions
//   npm install
//   firebase deploy --only functions
//
// These functions run with admin privileges (firebase-admin), bypassing
// firestore.rules entirely, so they're the right place to enforce limits
// rules can't express, and the right place for admin actions like
// disabling an account.

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Edit this to match the ADMIN_EMAILS list in firestore.rules.
const ADMIN_EMAILS = ["you@example.com"];

// ── Message rate limit ────────────────────────────────────────────────
// Allows at most MESSAGE_LIMIT messages per sender per MESSAGE_WINDOW_MS.
// If a sender goes over, the new message is deleted (so the recipient
// never even sees it land) and a strike is recorded on the sender's
// rateLimits doc for visibility in the admin view.
const MESSAGE_LIMIT = 30;
const MESSAGE_WINDOW_MS = 60 * 1000; // 1 minute

exports.rateLimitMessages = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const message = snap.data();
    const sender = message.sender;
    if (!sender) return;

    const windowStart = admin.firestore.Timestamp.fromMillis(Date.now() - MESSAGE_WINDOW_MS);

    const recentMessages = await db
      .collectionGroup("messages")
      .where("sender", "==", sender)
      .where("createdAt", ">=", windowStart)
      .get()
      .catch(() => null);

    // If the query fails (e.g. missing index on first deploy), fail open
    // rather than blocking all messaging — log it so you notice and add
    // the index Firestore suggests.
    if (!recentMessages) {
      console.error("rateLimitMessages: collectionGroup query failed — check that a composite index exists for messages(sender, createdAt).");
      return;
    }

    if (recentMessages.size > MESSAGE_LIMIT) {
      await snap.ref.delete().catch(() => {});
      await db.collection("rateLimitStrikes").add({
        type: "message",
        email: sender,
        at: admin.firestore.FieldValue.serverTimestamp(),
        detail: `${recentMessages.size} messages in the last ${MESSAGE_WINDOW_MS / 1000}s`,
      });
      console.warn(`Rate limit: deleted a message from ${sender} (${recentMessages.size} in window).`);
    }
  }
);

// ── Friend request rate limit ───────────────────────────────────────────
// Allows at most REQUEST_LIMIT new friend requests per sender per
// REQUEST_WINDOW_MS, to stop mass-request spam.
const REQUEST_LIMIT = 20;
const REQUEST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

exports.rateLimitFriendRequests = onDocumentCreated(
  "friendRequests/{requestId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const request = snap.data();
    const sender = request.from;
    if (!sender) return;

    const windowStart = admin.firestore.Timestamp.fromMillis(Date.now() - REQUEST_WINDOW_MS);

    const recentRequests = await db
      .collection("friendRequests")
      .where("from", "==", sender)
      .where("createdAt", ">=", windowStart)
      .get()
      .catch(() => null);

    if (!recentRequests) {
      console.error("rateLimitFriendRequests: query failed — check that a composite index exists for friendRequests(from, createdAt).");
      return;
    }

    if (recentRequests.size > REQUEST_LIMIT) {
      await snap.ref.delete().catch(() => {});
      await db.collection("rateLimitStrikes").add({
        type: "friendRequest",
        email: sender,
        at: admin.firestore.FieldValue.serverTimestamp(),
        detail: `${recentRequests.size} requests in the last ${REQUEST_WINDOW_MS / 60000}min`,
      });
      console.warn(`Rate limit: deleted a friend request from ${sender} (${recentRequests.size} in window).`);
    }
  }
);

// ── Admin: resolve a report and optionally disable the reported account ──
// Callable from the admin view in admin.html via firebase.functions().
// Requires the caller's token email to be in ADMIN_EMAILS.
exports.resolveReport = onCall(async (request) => {
  const callerEmail = request.auth && request.auth.token && request.auth.token.email;
  if (!callerEmail || !ADMIN_EMAILS.includes(callerEmail)) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  const { reportId, action, disableReportedAccount } = request.data || {};
  if (!reportId || !["resolved", "dismissed"].includes(action)) {
    throw new HttpsError("invalid-argument", "reportId and a valid action are required.");
  }

  const reportRef = db.collection("reports").doc(reportId);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) throw new HttpsError("not-found", "Report not found.");
  const report = reportSnap.data();

  await reportRef.update({
    status: action,
    reviewedBy: callerEmail,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (action === "resolved" && disableReportedAccount && report.reportedUser) {
    try {
      const userRecord = await admin.auth().getUserByEmail(report.reportedUser);
      await admin.auth().updateUser(userRecord.uid, { disabled: true });
    } catch (e) {
      console.error("resolveReport: could not disable Firebase Auth account —", e.message);
      // Don't throw — the report is still resolved even if disabling the
      // account fails (e.g. the account is local-fallback only, with no
      // Firebase Auth user to disable).
    }
  }

  return { ok: true };
});
