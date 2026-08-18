import { getUsernameFromRequest } from '../../_lib/auth-crypto.js';
import { getUser } from '../../_lib/auth-users.js';
import { logKeyFor, resetKeyFor, backupKeyFor, normalizeGroup } from '../../_lib/groups.js';

// How long before the same target can be cleared again.
const CLEAR_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
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

  // Read the current log once — used for the cooldown check below, and
  // (for a log clear) as the backup contents.
  const existingRaw = await env.EQL_KV.get(logKeyFor(user));
  const existingLog = existingRaw ? JSON.parse(existingRaw) : [];

  // Cooldown, so a confused or impatient user can't spam clears and
  // burn through write quota. Derived from the audit entry the previous
  // clear already left behind, so enforcing this costs no extra storage
  // and no extra reads or writes.
  let lastClearAt = null;
  for (let i = existingLog.length - 1; i >= 0; i--) {
    const e = existingLog[i];
    if (e && e.type === 'cleared' && e.target === target) {
      lastClearAt = e.time;
      break;
    }
  }
  if (lastClearAt) {
    const sinceMs = Date.parse(now) - Date.parse(lastClearAt);
    if (Number.isFinite(sinceMs) && sinceMs >= 0 && sinceMs < CLEAR_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((CLEAR_COOLDOWN_MS - sinceMs) / 1000);
      const waitLabel = waitSeconds >= 60
        ? Math.ceil(waitSeconds / 60) + ' minute' + (Math.ceil(waitSeconds / 60) === 1 ? '' : 's')
        : waitSeconds + ' seconds';
      return json({
        error: 'This was cleared very recently. Please wait ' + waitLabel + ' before clearing again.'
      }, 429);
    }
  }

  if (target === 'log') {
    // Keep a copy before wiping, since this is the only genuinely
    // destructive action in the app and there's otherwise no way back.
    // Only the most recent clear is retained — enough to undo a mistake
    // without the backups themselves becoming unbounded storage.
    if (existingLog.length) {
      await env.EQL_KV.put(backupKeyFor(user), JSON.stringify({
        backedUpAt: now,
        clearedBy: username,
        entryCount: existingLog.length,
        log: existingLog
      }));
    }
    // The log is fully replaced — just the one audit entry remains.
    await env.EQL_KV.put(logKeyFor(user), JSON.stringify([clearedEntry]));
  } else {
    // The leaderboard has no storage of its own — it's computed from the
    // log, filtered to entries after this reset timestamp. Clearing it
    // doesn't touch the Adventure Log's history, so the audit entry is
    // appended rather than replacing anything.
    await env.EQL_KV.put(resetKeyFor(user), now);
    existingLog.push(clearedEntry);
    await env.EQL_KV.put(logKeyFor(user), JSON.stringify(existingLog));
  }
  context.waitUntil(broadcastEntry(env, username, user.group, clearedEntry));

  return json({ ok: true });
}
