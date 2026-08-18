import { logKeyFor } from './groups.js';
import { ensureRollEntry } from './ensure-roll-entry.js';

// Appends an entry to the group's shared log.
//
// Cloudflare KV has no atomic append. Doing read-modify-write here meant
// two players acting in the same instant would each read the same log,
// append their own entry, and write back — the second write silently
// discarding the first. That entry then never appeared in the Adventure
// Log or counted on the Leaderboard.
//
// So the append is delegated to the realtime worker's Durable Object,
// which is single-instance per group and serializes the whole
// read-modify-write under a lock. The DO also broadcasts the entry, so
// callers don't need a separate broadcast step.
//
// If the worker is unreachable we fall back to writing KV directly.
// That reintroduces the race, but only while the worker is down, and
// losing an occasional entry beats refusing the write entirely.
export async function appendLogEntry(context, user, entry, options) {
  const env = context.env;
  const opts = options || {};

  if (env.REALTIME_WORKER_URL && env.BROADCAST_SECRET) {
    try {
      const res = await fetch(env.REALTIME_WORKER_URL.replace(/\/$/, '') + '/append', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Broadcast-Secret': env.BROADCAST_SECRET
        },
        body: JSON.stringify({
          username: user.username,
          group: user.group || '',
          entry: entry,
          ensureRoll: opts.ensureRoll || null
        })
      });
      if (res.ok) return { ok: true, viaWorker: true };
    } catch (e) {
      // Fall through to the direct write below.
    }
  }

  // Fallback: write straight to KV, as the backend used to.
  const logKey = logKeyFor(user);
  const raw = await env.EQL_KV.get(logKey);
  const log = raw ? JSON.parse(raw) : [];
  if (opts.ensureRoll && opts.character) {
    ensureRollEntry(log, user.username, opts.character);
  }
  log.push(entry);
  await env.EQL_KV.put(logKey, JSON.stringify(log));
  return { ok: true, viaWorker: false };
}
