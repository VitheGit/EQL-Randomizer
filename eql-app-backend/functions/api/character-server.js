import { getUsernameFromRequest } from '../_lib/auth-crypto.js';
import { getUser, saveUser } from '../_lib/auth-users.js';
import { SERVERS } from '../_lib/gamedata.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Corrects the server tag on the account's CURRENT active character.
// Needed for a real flow: someone dies/dings, rolls a NEW character
// (whose log file doesn't exist yet), and only points Settings at the
// new log file afterward — meaning the roll itself already submitted
// whatever server was set at that moment. This doesn't rewrite that
// original roll entry (that's left as historical record), but it
// corrects the character record so every event AFTER this point —
// level-ups, the eventual death/ding — shows the right server.
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);

  const username = await getUsernameFromRequest(request, env);
  if (!username) return json({ error: 'Not logged in' }, 401);

  const user = await getUser(env, username);
  if (!user) return json({ error: 'Account no longer exists' }, 401);

  if (!user.currentCharacter || !user.currentCharacter.locked) {
    // No active character to correct — not an error, just nothing to do.
    return json({ ok: true, updated: false });
  }

  let body = {};
  try { body = await request.json(); } catch (e) { /* ignore */ }

  const server = SERVERS.filter(function (s) { return body.server && s.toLowerCase() === String(body.server).toLowerCase(); })[0];
  if (!server) {
    // Nothing recognizable submitted — leave the existing value alone
    // rather than blank out something that may already be correct.
    return json({ ok: true, updated: false });
  }

  user.currentCharacter.server = server;
  await saveUser(env, user);

  return json({ ok: true, updated: true, server: server });
}
