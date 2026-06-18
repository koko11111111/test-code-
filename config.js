// ─── Firebase config ────────────────────────────────────────────────────
// Relay uses Firebase (Firestore) so messages sync in real time between
// accounts. You need your OWN Firebase project — don't reuse another
// project's config here.
//
// How to get this (free, ~3 minutes):
//   1. Go to https://console.firebase.google.com/ and create a project.
//   2. In the project, click the "</>" (web) icon to register a web app.
//   3. Firebase shows you a config object — copy the values into FIREBASE_CONFIG below.
//   4. In the left sidebar go to Build → Firestore Database → Create database.
//      Start in test mode (or use the rules in README.md).
//
// Until you fill this in, Relay will show a setup message instead of crashing.
const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
