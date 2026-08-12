// User account storage helpers. Each account lives at KV key "user:<lowercased username>".

export function isValidUsername(u) {
  return typeof u === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(u);
}

function userKey(username) {
  return 'user:' + username.trim().toLowerCase();
}

export async function getUser(env, username) {
  const raw = await env.EQL_KV.get(userKey(username));
  return raw ? JSON.parse(raw) : null;
}

export async function saveUser(env, userRecord) {
  await env.EQL_KV.put(userKey(userRecord.username), JSON.stringify(userRecord));
}
