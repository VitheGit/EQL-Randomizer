// Password hashing + session token helpers for Cloudflare Pages Functions.
// Uses the Web Crypto API (available globally in the Workers runtime) —
// no external dependencies needed.

const PBKDF2_ITERATIONS = 100000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqualB64(aB64, bB64) {
  const a = base64ToBytes(aB64);
  const b = base64ToBytes(bB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derive(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

// Returns { hash, salt } both base64-encoded, safe to store in KV.
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await derive(password, salt);
  return { hash: bytesToBase64(hashBytes), salt: bytesToBase64(salt) };
}

export async function verifyPassword(password, saltB64, expectedHashB64) {
  const salt = base64ToBytes(saltB64);
  const hashBytes = await derive(password, salt);
  return timingSafeEqualB64(bytesToBase64(hashBytes), expectedHashB64);
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createSession(env, username) {
  const token = generateToken();
  await env.EQL_KV.put('session:' + token, username, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function getUsernameFromRequest(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  const username = await env.EQL_KV.get('session:' + token);
  return username || null;
}

export async function destroySession(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return;
  const token = match[1].trim();
  if (token) await env.EQL_KV.delete('session:' + token);
}
