# Relay

Relay is a small real-time chat website. It supports one-to-one conversations, image attachments, emoji reactions, typing indicators, read receipts, message search, profile settings, and an optional privacy lock.

## Security notes

This project is a static front end. Static front ends cannot provide perfect secrecy by themselves because every browser receives the client code. For a production chat app, use Firebase Authentication, locked-down Firestore rules, and server-side moderation/auditing.

Client-side protections included here:

- Passwords are never saved as plain text. They are hashed with PBKDF2 and a per-user salt in `crypto-utils.js`.
- Public Firestore profiles only mirror display name, email, avatar, timestamps, and presence.
- Login errors are generic so the UI does not reveal whether an email exists.
- Pages include a Content Security Policy and `no-referrer` policy.
- Settings include a privacy lock that logs the current device out after 30 idle minutes.
- Images are compressed locally before being stored in Firestore messages.

## Firebase setup

1. Create a Firebase project at <https://console.firebase.google.com/>.
2. Register a web app and paste its config into `config.js`.
3. Create a Firestore database.
4. Use rules at least as strict as the example below before sharing the app.

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
