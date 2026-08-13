import { getUsernameFromRequest } from '../../_lib/auth-crypto.js';
import { getUser } from '../../_lib/auth-users.js';
import { logKeyFor, resetKeyFor, normalizeGroup } from '../../_lib/groups.js';
import { broadcastEntry } from '../../_lib/broadcast.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// No passcode anymore — anyone in a group already has full standing to
// manage that group's own data (they can't touch any other group's data
// no matter what). The only real risk here is an accidental click, which
// is what the "type your group name to confirm" step guards against —
// it's a confirmation, not an authorization boundary, so it's checked
// server-side mainly to keep a buggy client from skipping it entirely.
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

  const target = body.target;
  if (target !== 'log' && target !== 'leaderboard') {
    return json({ error: 'Invalid target.' }, 400);
  }

  const expectedConfirm = normalizeGroup(user.group) || '(local only)';
  const submittedConfirm = (body.confirmText || '').toString().trim();
  if (submittedConfirm.toLowerCase() !== expectedConfirm.toLowerCase()) {
    return json({ error: 'That doesn\'t match — type it exactly to confirm.' }, 400);
  }

  const now = new Date().toISOString();
  const clearedEntry = { type: 'cleared', target: target, time: now, name: username };

  if (target === 'log') {
    // The log is fully replaced — just the one audit entry remains.
    await env.EQL_KV.put(logKeyFor(user), JSON.stringify([clearedEntry]));
  } else {
    // The leaderboard has no storage of its own — it's computed from the
    // log, filtered to entries after this reset timestamp. Clearing it
    // doesn't touch the Adventure Log's history, so the audit entry is
    // appended rather than replacing anything.
    await env.EQL_KV.put(resetKeyFor(user), now);
    const logRaw = await env.EQL_KV.get(logKeyFor(user));
    const log = logRaw ? JSON.parse(logRaw) : [];
    log.push(clearedEntry);
    await env.EQL_KV.put(logKeyFor(user), JSON.stringify(log));
  }
  context.waitUntil(broadcastEntry(env, username, user.group, clearedEntry));

  return json({ ok: true });
}
