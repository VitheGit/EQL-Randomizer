import { getUsernameFromRequest } from '../_lib/auth-crypto.js';
import { getUser, saveUser } from '../_lib/auth-users.js';
import { logKeyFor } from '../_lib/groups.js';
import { ensureRollEntry } from '../_lib/ensure-roll-entry.js';
import { broadcastEntry } from '../_lib/broadcast.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);

  const username = await getUsernameFromRequest(request, env);
  if (!username) return json({ error: 'Not logged in' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request.' }, 400);
  }

  const type = body.type;
  if (type !== 'died' && type !== 'ding' && type !== 'retired') {
    return json({ error: 'Invalid resolution type.' }, 400);
  }

  const user = await getUser(env, username);
  if (!user || !user.currentCharacter || !user.currentCharacter.locked) {
    return json({ error: 'You do not have a locked character to resolve.' }, 409);
  }

  const character = user.currentCharacter;

  if (type === 'retired' && character.hardcore) {
    return json({ error: 'Hardcore characters must be resolved with "I Died" or "Ding! Level 50!".' }, 400);
  }

  let level = null;
  if (type === 'died') {
    level = Number(body.level);
    if (!Number.isFinite(level) || level < 1 || level > 125) {
      return json({ error: 'Enter a valid level (1 or higher).' }, 400);
    }
  }

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
    path: character.path || null,
    manual: !!body.manual,
    manualBuild: !!character.manualBuild,
    ssf: !!character.ssf,
    server: character.server || null,
    d4: !!character.d4
  };
  if (type === 'died') {
    entry.level = level;
    if (body.killedBy && typeof body.killedBy === 'string') {
      entry.killedBy = body.killedBy.slice(0, 200); // sanity-cap length
    }
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

  user.currentCharacter = null;
  await saveUser(env, user);

  return json({ ok: true });
}
