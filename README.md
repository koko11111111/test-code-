# Relay

Relay is a small real-time chat website. It supports one-to-one conversations, image attachments, voice messages, emoji reactions, typing indicators, read receipts, message search, profile settings, Google sign-in, email/password sign-in, a friends system, a block system, and an optional privacy lock.

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
- A friends system (friend requests/accept/decline) and a block system (block/unblock, blocked users hidden from search and unable to message you) are layered on top of messaging, which otherwise remains open between any two accounts on the same instance.

**Block system caveat:** blocking is enforced client-side — `chat.js` checks `users/{emailKey}.blocked` before allowing a send and before showing someone in search. The demo Firestore rules let any signed-in user read any `users` document (needed for search), so a modified or custom client could in principle ignore the block and write directly to a conversation. For a production deployment where blocking must be unbypassable, move the send-time block check into a Cloud Function or Firestore security rule that reads both users' `blocked` arrays before allowing a write to `conversations/{id}/messages`.

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

## Firestore rules

Use rules at least as strict as the example below before sharing the app.

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedInRelayUser() {
      return request.auth != null && request.auth.token.email != null;
    }

    match /users/{userId} {
      allow read: if signedInRelayUser();
      allow create, update, delete: if signedInRelayUser()
        && userId == request.auth.token.email.replace('.', '_');
    }

    // ADDED: friend requests — only the sender or recipient may read/write
    // a given request, and only the recipient may change its status.
    match /friendRequests/{requestId} {
      allow read: if signedInRelayUser()
        && (request.auth.token.email == resource.data.from || request.auth.token.email == resource.data.to);
      allow create: if signedInRelayUser()
        && request.auth.token.email == request.resource.data.from;
      allow update: if signedInRelayUser()
        && (request.auth.token.email == resource.data.from || request.auth.token.email == resource.data.to);
    }

    match /conversations/{conversationId} {
      allow read, create, update: if signedInRelayUser()
        && request.auth.token.email in resource.data.participants;

      match /messages/{messageId} {
        allow read, create, update, delete: if signedInRelayUser()
          && request.auth.token.email in get(/databases/$(database)/documents/conversations/$(conversationId)).data.participants;
      }
    }
  }
}
```

> Important: the current demo auth is local-browser auth. If you enable these production rules, connect Firebase Authentication so `request.auth` exists.
