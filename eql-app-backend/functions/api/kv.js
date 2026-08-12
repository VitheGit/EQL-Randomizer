// Cloudflare Pages Function — automatically served at /api/kv.
//
// Read-only on purpose. All writes to shared data now go through
// dedicated, validated endpoints instead (/api/roll, /api/resolve,
// /api/milestone, /api/admin/clear) so nobody can bypass game rules or
// the admin passcode by hitting a generic write endpoint directly.
//
// Requires login now (unlike before groups existed) — the server needs
// to know which account is asking so it can resolve their group and
// serve that group's data, not anyone else's.

import { getUsernameFromRequest } from '../_lib/auth-crypto.js';
import { getUser } from '../_lib/auth-users.js';
import { logKeyFor, resetKeyFor } from '../_lib/groups.js';

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const ALLOWED_KEYS = ['log', 'leaderboard-reset-at'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!key) return jsonResponse({ error: 'Missing key' }, 400);

  // Lightweight health check used by the frontend to detect whether
  // the API is reachable at all — deliberately doesn't require login,
  // since it's used on the login screen itself.
  if (key === '__ping__') return jsonResponse({ ok: true });

  if (ALLOWED_KEYS.indexOf(key) === -1) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  if (!env.EQL_KV) {
    return jsonResponse({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);
  }

  const username = await getUsernameFromRequest(request, env);
  if (!username) return jsonResponse({ error: 'Not logged in' }, 401);

  const user = await getUser(env, username);
  if (!user) return jsonResponse({ error: 'Account no longer exists' }, 401);

  const actualKey = key === 'log' ? logKeyFor(user) : resetKeyFor(user);
  const value = await env.EQL_KV.get(actualKey);
  return jsonResponse({ key: key, value: value });
}
