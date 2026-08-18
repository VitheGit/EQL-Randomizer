import { getUsernameFromRequest } from '../../_lib/auth-crypto.js';
import { getUser } from '../../_lib/auth-users.js';
import { logKeyFor, backupKeyFor, normalizeGroup } from '../../_lib/groups.js';
import { broadcastEntry } from '../../_lib/broadcast.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// GET — describes the available backup without transferring it. Used to
// show "Backup from X, N entries" in the Admin tab, so the button isn't
// a leap of faith. Deliberately returns metadata only; the backup itself
// can be large and there's no reason to send it to the client.
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);

  const username = await getUsernameFromRequest(request, env);
  if (!username) return json({ error: 'Not logged in' }, 401);
  const user = await getUser(env, username);
  if (!user) return json({ error: 'Account no longer exists' }, 401);

  const raw = await env.EQL_KV.get(backupKeyFor(user));
  if (!raw) return json({ exists: false });

  let backup;
  try {
    backup = JSON.parse(raw);
  } catch (e) {
    return json({ exists: false });
  }
  return json({
    exists: true,
    backedUpAt: backup.backedUpAt || null,
    entryCount: backup.entryCount || (backup.log ? backup.log.length : 0),
    clearedBy: backup.clearedBy || null
  });
}

// POST — restores the backup by MERGING it with whatever's in the log
// now, rather than overwriting.
//
// A straight replace would throw away anything that happened since the
// clear, turning a recovery into a second act of data loss. Merging and
// de-duplicating means restoring is safe whenever it's run, and running
// it twice does nothing the second time.
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

  // Same confirmation as clearing — this rewrites shared group data, so
  // it shouldn't be a single misclick away.
  const expectedConfirm = normalizeGroup(user.group) || '(local only)';
  const submittedConfirm = (body.confirmText || '').toString().trim();
  if (submittedConfirm.toLowerCase() !== expectedConfirm.toLowerCase()) {
    return json({ error: 'That doesn\'t match — type it exactly to confirm.' }, 400);
  }

  const backupRaw = await env.EQL_KV.get(backupKeyFor(user));
  if (!backupRaw) return json({ error: 'There is no backup to restore.' }, 404);

  let backup;
  try {
    backup = JSON.parse(backupRaw);
  } catch (e) {
    return json({ error: 'The backup could not be read.' }, 500);
  }
  const backupLog = Array.isArray(backup.log) ? backup.log : [];
  if (!backupLog.length) return json({ error: 'The backup is empty.' }, 404);

  const currentRaw = await env.EQL_KV.get(logKeyFor(user));
  const currentLog = currentRaw ? JSON.parse(currentRaw) : [];

  // Merge, de-duplicating on the fields that identify an entry. Entries
  // carry no ID, but type+name+time is unique in practice.
  const seen = {};
  const merged = [];
  function add(entry) {
    if (!entry) return;
    const key = entry.type + '|' + entry.name + '|' + entry.time;
    if (seen[key]) return;
    seen[key] = true;
    merged.push(entry);
  }
  backupLog.forEach(add);
  currentLog.forEach(add);

  merged.sort(function (a, b) {
    return new Date(a.time || 0) - new Date(b.time || 0);
  });

  const restoredCount = merged.length - currentLog.length;
  if (restoredCount <= 0) {
    // Nothing new to add — skip the write entirely rather than burning
    // quota rewriting an identical log.
    return json({ ok: true, restored: 0, total: merged.length });
  }

  const restoredEntry = {
    type: 'restored',
    time: new Date().toISOString(),
    name: username,
    restoredCount: restoredCount
  };
  merged.push(restoredEntry);

  await env.EQL_KV.put(logKeyFor(user), JSON.stringify(merged));
  context.waitUntil(broadcastEntry(env, username, user.group, restoredEntry));

  return json({ ok: true, restored: restoredCount, total: merged.length });
}
