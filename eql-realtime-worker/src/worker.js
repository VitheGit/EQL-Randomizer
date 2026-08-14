// EQL Realtime Worker
//
// Hosts one Durable Object "room" per group. Connected clients (the
// desktop app) open a WebSocket to /connect and get pushed new log
// entries the instant they happen, instead of polling KV every few
// seconds. The main backend (eql-app-backend) calls POST /broadcast
// after writing a new entry to KV, which forwards it to the right
// room's connected sockets.
//
// NOTE: the group-key logic here is deliberately duplicated from
// eql-app-backend/functions/_lib/groups.js, since this is a separate
// Worker and can't import across deployments. If that file's group-key
// scheme ever changes, this must be updated to match or rooms will
// silently stop lining up with the right group.

function groupKeyFor(username, rawGroup) {
  const g = (rawGroup || '').toString().trim().slice(0, 60);
  return g ? ('group:' + g.toLowerCase()) : ('solo:' + username.toLowerCase());
}

async function usernameFromToken(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  const username = await env.EQL_KV.get('session:' + token);
  return username || null;
}

async function getUserGroup(env, username) {
  const raw = await env.EQL_KV.get('user:' + username.trim().toLowerCase());
  if (!raw) return null;
  try {
    const user = JSON.parse(raw);
    return user.group || '';
  } catch (e) {
    return '';
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const HEARTBEAT_INTERVAL_MS = 30000; // check every 30s
const STALE_THRESHOLD_MS = 65000; // ~2 missed heartbeats = treat as dead

export class GroupRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Deliberately no in-memory session list here — under hibernation,
    // this constructor can run again with a blank slate after the DO
    // wakes back up, so state.getWebSockets() (which Cloudflare tracks
    // correctly across hibernation) is the only reliable source of
    // "who's currently connected," not anything this class remembers.
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/connect') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // state.acceptWebSocket (not server.accept()) is what lets this
      // Durable Object hibernate — go idle and get evicted from memory —
      // WITHOUT dropping the connection. The older ws.accept() API pins
      // the DO in memory for as long as the socket is open; once it's
      // evicted anyway (which Cloudflare does for idle DOs regardless),
      // the connection silently dies with it. That idle-eviction-then-
      // drop is what was actually happening before this fix.
      this.state.acceptWebSocket(server);
      // Give it a fresh "last heard from" timestamp so it isn't
      // immediately treated as stale before its first heartbeat cycle.
      server.serializeAttachment({ lastPong: Date.now() });
      console.log('[GroupRoom] connection accepted. Total sockets now:', this.state.getWebSockets().length);
      await this.ensureHeartbeatScheduled();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.json();
      const socketCount = this.state.getWebSockets().length;
      console.log('[GroupRoom] broadcast received. Connected sockets in this room:', socketCount, '| entry type:', payload.entry && payload.entry.type);
      this.broadcast(JSON.stringify({ type: 'entry', entry: payload.entry }));
      return json({ ok: true, delivered: socketCount });
    }

    return new Response('Not found', { status: 404 });
  }

  async ensureHeartbeatScheduled() {
    const current = await this.state.storage.getAlarm();
    if (current === null) {
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
    }
  }

  // The actual fix for stale connections: a server-initiated ping/pong.
  // A dead connection (network drop, sleep/wake, ISP hiccup — anything
  // that didn't send a clean close frame) can sit in getWebSockets()
  // looking perfectly normal, and ws.send() on it often won't throw
  // right away either. Without this, broadcasts silently "succeed"
  // against a connection nobody's listening on anymore. This alarm
  // periodically pings everyone, and anyone who hasn't answered within
  // ~2 cycles gets forcibly closed so they drop out of future broadcasts
  // (the client's own reconnect logic then gets them a fresh, live one).
  async alarm() {
    const sockets = this.state.getWebSockets();
    const now = Date.now();
    console.log('[GroupRoom] heartbeat check — sockets:', sockets.length);

    sockets.forEach(function (ws) {
      var lastPong = now;
      try {
        var attachment = ws.deserializeAttachment();
        if (attachment && attachment.lastPong) lastPong = attachment.lastPong;
      } catch (e) { /* no attachment yet — treat as fresh */ }

      if (now - lastPong > STALE_THRESHOLD_MS) {
        console.log('[GroupRoom] closing stale socket — no pong for', now - lastPong, 'ms');
        try { ws.close(1000, 'stale connection'); } catch (e) { /* already gone */ }
      } else {
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* will show as stale next cycle */ }
      }
    });

    // Keep the heartbeat going as long as this room exists — cheap to
    // run, and correctly resumes even if the DO hibernates in between
    // (the alarm itself is what wakes it back up).
    await this.state.storage.setAlarm(now + HEARTBEAT_INTERVAL_MS);
  }

  // These are called directly by the Cloudflare runtime — including
  // right after a hibernation wake-up, when this class has just been
  // freshly re-constructed with no memory of prior state.
  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      if (data && data.type === 'pong') {
        ws.serializeAttachment({ lastPong: Date.now() });
      }
    } catch (e) {
      // Not JSON, or not a pong — nothing to do.
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    // No manual cleanup needed — a closed socket just stops appearing in
    // future state.getWebSockets() calls on its own.
  }

  async webSocketError(ws, error) {
    // Same as above — nothing to do here.
  }

  broadcast(message) {
    const sockets = this.state.getWebSockets();
    sockets.forEach(function (ws) {
      try {
        ws.send(message);
      } catch (e) {
        // A socket in a bad state will show up as closed (or get pruned
        // by the next heartbeat) on its own; nothing to clean up here.
      }
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/connect') {
      const username = await usernameFromToken(request, env);
      if (!username) return new Response('Unauthorized', { status: 401 });

      const group = await getUserGroup(env, username);
      if (group === null) return new Response('Account no longer exists', { status: 401 });

      const groupKey = groupKeyFor(username, group);
      console.log('[Router] connect: username=' + username + ' group="' + group + '" -> groupKey=' + groupKey);
      const id = env.GROUP_ROOM.idFromName(groupKey);
      const stub = env.GROUP_ROOM.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const secret = request.headers.get('X-Broadcast-Secret') || '';
      if (!env.BROADCAST_SECRET || secret !== env.BROADCAST_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      let payload;
      try {
        payload = await request.json();
      } catch (e) {
        return json({ error: 'Invalid request.' }, 400);
      }
      if (!payload.username || !payload.entry) {
        return json({ error: 'Missing username or entry.' }, 400);
      }
      const groupKey = groupKeyFor(payload.username, payload.group);
      console.log('[Router] broadcast: username=' + payload.username + ' group="' + payload.group + '" -> groupKey=' + groupKey);
      const id = env.GROUP_ROOM.idFromName(groupKey);
      const stub = env.GROUP_ROOM.get(id);
      const forwardRequest = new Request('https://internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return stub.fetch(forwardRequest);
    }

    if (url.pathname === '/health') {
      return json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  }
};
