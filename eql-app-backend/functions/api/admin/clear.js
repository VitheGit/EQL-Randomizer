import { verifyPassword, getUsernameFromRequest } from '../../_lib/auth-crypto.js';
import { getUser } from '../../_lib/auth-users.js';
import { logKeyFor, resetKeyFor } from '../../_lib/groups.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Clears only the CALLING USER'S OWN GROUP's data — not the entire
// backend. This matters now that groups exist: one group's admin
// passcode use should never be able to wipe another group's history.
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);

  const username = await getUsernameFromRequest(request, env);
  if (!username) return json({ error: 'Not logged in' }, 401);

  const user = await getUser(env, username);
  if (!user) return json({ error: 'Account no longer exists' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request.' }, 400);
  }

  const passcode = body.passcode || '';
  const target = body.target;
  if (target !== 'log' && target !== 'leaderboard') {
    return json({ error: 'Invalid target.' }, 400);
  }

  const adminRaw = await env.EQL_KV.get('admin-passcode');
  if (!adminRaw) {
    return json({ error: 'Admin passcode is not configured on the server yet.' }, 500);
  }

  let admin;
  try {
    admin = JSON.parse(adminRaw);
  } catch (e) {
    return json({ error: 'Admin passcode is misconfigured on the server.' }, 500);
  }

  const ok = await verifyPassword(passcode, admin.salt, admin.hash);
  if (!ok) {
    return json({ error: 'Wrong passcode.' }, 401);
  }

  if (target === 'log') {
    await env.EQL_KV.put(logKeyFor(user), JSON.stringify([]));
  } else {
    await env.EQL_KV.put(resetKeyFor(user), new Date().toISOString());
  }

  return json({ ok: true });
}
