// Notifies the eql-realtime-worker so connected clients get pushed the
// new entry instantly, instead of waiting for their next poll.
//
// Deliberately fire-and-forget with its own try/catch: a broadcast
// failure (worker down, misconfigured secret, etc.) should never break
// the actual roll/resolve/milestone/clear action itself — KV remains the
// source of truth, and clients still have their slow polling fallback if
// the realtime push never arrives.
export async function broadcastEntry(env, username, group, entry) {
  if (!env.REALTIME_WORKER_URL || !env.BROADCAST_SECRET) return;
  try {
    await fetch(env.REALTIME_WORKER_URL.replace(/\/$/, '') + '/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Broadcast-Secret': env.BROADCAST_SECRET
      },
      body: JSON.stringify({ username: username, group: group, entry: entry })
    });
  } catch (e) {
    // Silent — see comment above.
  }
}
