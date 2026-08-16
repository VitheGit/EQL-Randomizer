import { getUsernameFromRequest } from '../_lib/auth-crypto.js';
import { getUser } from '../_lib/auth-users.js';
import { logKeyFor } from '../_lib/groups.js';
import { ensureRollEntry } from '../_lib/ensure-roll-entry.js';
import { broadcastEntry } from '../_lib/broadcast.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// A lightweight "keep the shared view honest" endpoint, called by the
// client on ANY in-game log activity (zoning, chat, combat — anything),
// not just milestones. It does two repair jobs:
//
//   1. Restores the character's roll entry if the log was cleared while
//      they were mid-run, so they reappear on the leaderboard/log.
//   2. Catches the leaderboard up on level if the app missed level-ups
//      (e.g. it was closed while they played), since the leaderboard
//      reads level from log entries, not the character record.
//
// Entries written here are flagged silent:true — they exist to correct
// the leaderboard/log, not to announce something that already happened,
// so clients skip notifications for them.
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);

  const username = await getUsernameFromRequest(request, env);
  if (!username) return json({ error: 'Not logged in' }, 401);

  const user = await getUser(env, username);
  if (!user) return json({ error: 'Account no longer exists' }, 401);

  const character = user.currentCharacter;
  // Nothing to repair if there's no active character.
  if (!character || !character.locked) return json({ ok: true, repaired: false });

  let body = {};
  try { body = await request.json(); } catch (e) { /* body is optional */ }

  const logRaw = await env.EQL_KV.get(logKeyFor(user));
  const log = logRaw ? JSON.parse(logRaw) : [];
  const before = log.length;

  ensureRollEntry(log, username, character);
  const rollRestored = log.length > before;

  // Catch the leaderboard up on level if the client reports a higher one
  // than anything currently logged for this run.
  let levelAdded = null;
  const reportedLevel = Number(body.level);
  if (Number.isFinite(reportedLevel) && reportedLevel > 1 && reportedLevel <= 50) {
    const rolledAt = character.rolledAt ? new Date(character.rolledAt) : null;
    let highestLogged = 0;
    log.forEach(function (e) {
      if (!e || e.name !== username) return;
      if (e.type !== 'levelup' && e.type !== 'died' && e.type !== 'ding') return;
      // Only consider entries belonging to THIS run, not an earlier one.
      if (rolledAt && e.time && new Date(e.time) < rolledAt) return;
      if (typeof e.level === 'number' && e.level > highestLogged) highestLogged = e.level;
    });

    if (reportedLevel > highestLogged) {
      levelAdded = {
        type: 'levelup',
        time: new Date().toISOString(),
        name: username,
        primary: character.primary,
        secondary: character.secondary,
        tertiary: character.tertiary,
        race: character.race,
        hardcore: !!character.hardcore,
        pathMode: !!character.pathMode,
        manualBuild: !!character.manualBuild,
        ssf: !!character.ssf,
        server: character.server || null,
        d4: !!character.d4,
        level: reportedLevel,
        silent: true // a correction, not an announcement
      };
      log.push(levelAdded);
    }
  }

  if (!rollRestored && !levelAdded) {
    // Nothing changed — skip the KV write entirely. This matters: sync is
    // called on ordinary log activity, and KV writes are the tighter of
    // the two free-tier limits, so the common "everything's fine" case
    // must not cost a write.
    return json({ ok: true, repaired: false });
  }

  await env.EQL_KV.put(logKeyFor(user), JSON.stringify(log));
  if (levelAdded) {
    context.waitUntil(broadcastEntry(env, username, user.group, levelAdded));
  }

  return json({ ok: true, repaired: true, rollRestored: rollRestored, levelAdded: levelAdded ? levelAdded.level : null });
}
