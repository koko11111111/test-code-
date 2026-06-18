# Relay

Relay is a small real-time chat website. It supports one-to-one conversations, image attachments, voice messages, emoji reactions, typing indicators, read receipts, message search, profile settings, Google sign-in, email/password sign-in, and an optional privacy lock.

## Security notes

Relay now prefers Firebase Authentication when `config.js` is filled in. The old local-browser account system remains only as a development fallback so the static demo can still run before Firebase is connected.

Client-side protections included here:

- Firebase Authentication support for email/password and Google sign-in.
- Local fallback passwords are never saved as plain text; they are hashed with PBKDF2 and a per-user salt in `crypto-utils.js`.
- Public Firestore profiles only mirror display name, email, avatar, timestamps, and presence.
- Login errors are generic so the UI does not reveal whether an email exists.
- Pages include a Content Security Policy and `no-referrer` policy.
- Settings include a privacy lock that logs the current device out after 30 idle minutes.
- Images are compressed locally before being stored in Firestore messages.
- Voice messages are capped at 60 seconds before being stored in Firestore messages.

A static front end cannot guarantee perfect secrecy by itself because every browser receives the client code. For production, use Firebase Authentication, publish `firestore.rules`, and consider Cloud Functions for rate limiting, validation, moderation, and audit logging.

## Firebase setup

1. Create a Firebase project at <https://console.firebase.google.com/>.
2. Register a web app and paste its config into `config.js`.
3. Go to Build → Authentication → Sign-in method.
4. Enable **Email/Password** and **Google**.
5. Add your local/deployed domains in Authentication → Settings → Authorized domains.
6. Go to Build → Firestore Database → Create database.
7. Publish the rules from `firestore.rules`.

## Google Cloud / OAuth setup

Firebase creates the Google OAuth client for most web apps. If Google sign-in says the app/domain is not authorized:

1. Open Google Cloud Console for the same Firebase project.
2. Go to APIs & Services → OAuth consent screen and complete the app name/support email fields.
3. Go to APIs & Services → Credentials and confirm the Firebase web OAuth client has your authorized JavaScript origins.
4. Return to Firebase Authentication and confirm Google is enabled.

## Important production follow-up

- Move large files and production voice/image uploads to Firebase Storage before adding broad file sharing.
- Use Cloud Functions if you need stricter server-side validation than Firestore rules can express.
- Consider end-to-end encryption if message contents must be unreadable to your backend provider.
