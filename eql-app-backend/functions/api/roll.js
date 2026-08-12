import { getUsernameFromRequest } from '../_lib/auth-crypto.js';
import { getUser, saveUser } from '../_lib/auth-users.js';
import { drawCharacter, generateLevelingPath, RACES, CLASSES, isEligible } from '../_lib/gamedata.js';

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

  const user = await getUser(env, username);
  if (!user) return json({ error: 'Account no longer exists' }, 401);

  // Enforced server-side, tied to the account — not the browser — so
  // switching devices or using a private window can't get around it.
  if (user.currentCharacter && user.currentCharacter.locked) {
    return json({ error: 'You already have a locked character. Resolve it before rolling again.' }, 409);
  }

  let body = {};
  try { body = await request.json(); } catch (e) { /* no body sent, default to non-hardcore random roll */ }

  const manualBuild = !!body.manualBuild;
  const pathMode = !!body.pathMode;
  const ssf = !!body.ssf;
  let character;

  if (manualBuild) {
    // Manually-chosen characters are always Hardcore — this whole feature
    // exists specifically so a player can build a Hardcore character on
    // purpose rather than leaving it to chance. Never trust the client's
    // claim that a race/class combo is legal — validate everything here.
    const race = body.race;
    const primary = body.primary;
    const secondary = body.secondary;
    const tertiary = body.tertiary;

    if (RACES.indexOf(race) === -1) return json({ error: 'Invalid race.' }, 400);
    if (CLASSES.indexOf(primary) === -1) return json({ error: 'Invalid Primary class.' }, 400);
    if (CLASSES.indexOf(secondary) === -1) return json({ error: 'Invalid Secondary class.' }, 400);
    if (CLASSES.indexOf(tertiary) === -1) return json({ error: 'Invalid Tertiary class.' }, 400);
    if (!isEligible(race, primary)) {
      return json({ error: primary + ' is not eligible for ' + race + '.' }, 400);
    }
    if (secondary === primary || tertiary === primary || secondary === tertiary) {
      return json({ error: 'Secondary and Tertiary must be different from Primary and from each other.' }, 400);
    }

    character = {
      primary: primary,
      secondary: secondary,
      tertiary: tertiary,
      race: race,
      fellBack: false,
      hardcore: true,
      pathMode: pathMode,
      path: pathMode ? generateLevelingPath() : null,
      manualBuild: true,
      ssf: ssf,
      locked: true
    };
  } else {
    const hardcore = !!body.hardcore;
    const drawn = drawCharacter();
    character = {
      primary: drawn.primary,
      secondary: drawn.secondary,
      tertiary: drawn.tertiary,
      race: drawn.race,
      fellBack: drawn.fellBack,
      hardcore: hardcore,
      pathMode: pathMode,
      path: pathMode ? generateLevelingPath() : null,
      manualBuild: false,
      ssf: ssf,
      locked: true
    };
  }

  user.currentCharacter = character;
  await saveUser(env, user);

  const logRaw = await env.EQL_KV.get('log');
  const log = logRaw ? JSON.parse(logRaw) : [];
  log.push({
    type: 'roll',
    time: new Date().toISOString(),
    name: username,
    primary: character.primary,
    secondary: character.secondary,
    tertiary: character.tertiary,
    race: character.race,
    hardcore: character.hardcore,
    pathMode: character.pathMode,
    path: character.path,
    manualBuild: character.manualBuild,
    ssf: character.ssf
  });
  await env.EQL_KV.put('log', JSON.stringify(log));

  return json({ character: character });
}
