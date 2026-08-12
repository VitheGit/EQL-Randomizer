import { verifyPassword } from '../../_lib/auth-crypto.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);

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
    await env.EQL_KV.put('log', JSON.stringify([]));
  } else {
    await env.EQL_KV.put('leaderboard-reset-at', new Date().toISOString());
  }

  return json({ ok: true });
}
