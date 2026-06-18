// ─── Password hashing (Web Crypto API) ─────────────────────────────────
// Relay never stores plaintext passwords. Each password is hashed with
// PBKDF2 (100,000 iterations, SHA-256) and a random per-user salt.
//
// NOTE: crypto.subtle only exists in "secure contexts" — https:// or
// http://localhost. It will be missing if you open this file directly
// as file:// in your browser. Use a local server while testing
// (e.g. `npx serve .`) and it works automatically once hosted on
// GitHub Pages (https).

function cryptoAvailable() {
  return typeof window !== "undefined" && !!(window.crypto && window.crypto.subtle);
}

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

async function deriveHash(password, saltB64, iterations) {
  const enc = new TextEncoder();
  const saltBytes = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bufferToBase64(bits);
}

// Returns { hash, salt, iterations } — store this whole object as passwordHash.
async function securePasswordStore(password) {
  if (!cryptoAvailable()) {
    throw new Error("Secure storage isn't available here. Open Relay via http://localhost or your live URL, not as a local file.");
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bufferToBase64(saltBytes);
  const iterations = 100000;
  const hash = await deriveHash(password, salt, iterations);
  return { hash, salt, iterations };
}

// Compares a plaintext attempt against a stored { hash, salt, iterations } object.
async function verifyStoredPassword(password, stored) {
  if (!stored || !stored.hash || !stored.salt) return false;
  if (!cryptoAvailable()) {
    throw new Error("Secure storage isn't available here. Open Relay via http://localhost or your live URL, not as a local file.");
  }
  const attemptHash = await deriveHash(password, stored.salt, stored.iterations || 100000);
  return attemptHash === stored.hash;
}
