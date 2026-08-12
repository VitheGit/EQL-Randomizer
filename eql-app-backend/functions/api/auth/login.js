import { verifyPassword, createSession } from '../../_lib/auth-crypto.js';
import { getUser } from '../../_lib/auth-users.js';

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

  const user = await getUser(env, username);
  if (!user) {
    return json({ error: 'Incorrect username or password.' }, 401);
  }

  const ok = await verifyPassword(password, user.salt, user.hash);
  if (!ok) {
    return json({ error: 'Incorrect username or password.' }, 401);
  }

  const token = await createSession(env, user.username);
  return json({ token: token, username: user.username, currentCharacter: user.currentCharacter || null });
}
