import { hashPassword, createSession } from '../../_lib/auth-crypto.js';
import { isValidUsername, getUser, saveUser } from '../../_lib/auth-users.js';

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

  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!isValidUsername(username)) {
    return json({ error: 'Usernames must be 3-20 characters: letters, numbers, and underscores only.' }, 400);
  }
  if (password.length < 6) {
    return json({ error: 'Password must be at least 6 characters.' }, 400);
  }

  const existing = await getUser(env, username);
  if (existing) {
    return json({ error: 'That username is already taken.' }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  const userRecord = {
    username: username,
    hash: hash,
    salt: salt,
    currentCharacter: null,
    createdAt: new Date().toISOString()
  };
  await saveUser(env, userRecord);

  // Re-read after writing. KV has no compare-and-set, so two people
  // registering the same name at the same moment could both pass the
  // check above and the second write would silently replace the first —
  // taking over an account that isn't theirs. Confirming our own record
  // survived closes that window: if someone else's write landed last, we
  // back out rather than hand over a hijacked session.
  const confirmed = await getUser(env, username);
  if (!confirmed || confirmed.createdAt !== userRecord.createdAt) {
    return json({ error: 'That username was just taken. Please try another.' }, 409);
  }

  const token = await createSession(env, userRecord.username);
  return json({ token: token, username: userRecord.username, currentCharacter: null, group: '' });
}
