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

// Unlike /api/resolve (which ends a character's run), this endpoint just
// appends a shared log entry for an in-progress milestone — a regular
// level-up or an AA point gain — while leaving the character locked and
// still in play. This is what lets other players' apps pick it up via the
// shared log poll and announce it, without affecting anyone's leaderboard
// status or ending anyone's run.
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);

  const username = await getUsernameFromRequest(request, env);
  if (!username) return json({ error: 'Not logged in' }, 401);

  const user = await getUser(env, username);
  if (!user || !user.currentCharacter || !user.currentCharacter.locked) {
    return json({ error: 'You do not have a locked character.' }, 409);
  }

  let body = {};
  try { body = await request.json(); } catch (e) { /* ignore */ }

  const type = body.type;
  if (type !== 'levelup' && type !== 'aa') {
    return json({ error: 'Invalid milestone type.' }, 400);
  }

  const character = user.currentCharacter;
  const entry = {
    type: type,
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
    d4: !!character.d4
  };

  if (type === 'levelup') {
    const level = Number(body.level);
    if (!Number.isFinite(level) || level < 1 || level > 49) {
      return json({ error: 'Invalid level.' }, 400);
    }
    entry.level = level;
  } else {
    const aaTotal = Number(body.aaTotal);
    if (!Number.isFinite(aaTotal) || aaTotal < 0) {
      return json({ error: 'Invalid AA total.' }, 400);
    }
    entry.aaTotal = aaTotal;
  }

  const logRaw = await env.EQL_KV.get(logKeyFor(user));
  const log = logRaw ? JSON.parse(logRaw) : [];
  // If the log was cleared while this character was active, its roll
  // entry is gone — restore it so the character reappears on the
  // leaderboard/log with its run duration intact.
  ensureRollEntry(log, username, character);
  log.push(entry);
  await env.EQL_KV.put(logKeyFor(user), JSON.stringify(log));
  context.waitUntil(broadcastEntry(env, username, user.group, entry));

  // Deliberately no saveUser() call — the character stays locked exactly
  // as it was, since a milestone doesn't end anyone's run.
  return json({ ok: true });
}
