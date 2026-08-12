import { destroySession } from '../../_lib/auth-crypto.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (env.EQL_KV) {
    await destroySession(request, env);
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
