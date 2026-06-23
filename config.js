// ─── Firebase config ────────────────────────────────────────────────────
// Relay uses Firebase (Firestore + Auth) so messages sync in real time.
//
// SECURITY CHECKLIST before going live:
//   1. Deploy firestore.rules via Firebase Console or `firebase deploy --only firestore:rules`
//   2. Deploy firestore.indexes.json via `firebase deploy --only firestore:indexes`
//   3. Deploy functions/ via `cd functions && npm install && firebase deploy --only functions`
//   4. In Firebase Console → Authentication → Settings → Authorized domains,
//      add your production domain and REMOVE any domains you don't use.
//   5. In Google Cloud Console → APIs & Services → Credentials, restrict
//      the Browser API key to your production domain only.
//   6. Fill in ADMIN_EMAILS in firestore.rules, functions/index.js, and admin.js.
//   7. Fill in the operator contact email in privacy.html Section 1.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDklnZRCFnxxHLP_MV6j4_ZR5vykY1LQ0E",
  authDomain: "relay-8a807.firebaseapp.com",
  projectId: "relay-8a807",
  storageBucket: "relay-8a807.firebasestorage.app",
  messagingSenderId: "219719482946",
  appId: "1:219719482946:web:967caac406eb31131df7db",
  measurementId: "G-B5WEX4SY8S", // Google Analytics ID — unused by Relay (no analytics code)
};

