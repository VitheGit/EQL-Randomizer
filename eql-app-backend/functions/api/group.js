import { getUsernameFromRequest } from '../_lib/auth-crypto.js';
import { getUser, saveUser } from '../_lib/auth-users.js';
import { normalizeGroup } from '../_lib/groups.js';

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

  let body = {};
  try { body = await request.json(); } catch (e) { /* ignore */ }

  const group = normalizeGroup(body.group);
  user.group = group;
  await saveUser(env, user);

  return json({ ok: true, group: group });
}
