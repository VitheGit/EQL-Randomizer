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

export class GroupRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/connect') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.acceptSession(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.json();
      this.broadcast(JSON.stringify({ type: 'entry', entry: payload.entry }));
      return json({ ok: true, delivered: this.sessions.length });
    }

    return new Response('Not found', { status: 404 });
  }

  acceptSession(ws) {
    ws.accept();
    this.sessions.push(ws);

    var self = this;
    ws.addEventListener('close', function () {
      self.sessions = self.sessions.filter(function (s) { return s !== ws; });
    });
    ws.addEventListener('error', function () {
      self.sessions = self.sessions.filter(function (s) { return s !== ws; });
    });
    // The client doesn't send anything meaningful, but some proxies/load
    // balancers close idle connections — respond to pings if any arrive.
    ws.addEventListener('message', function () { /* no-op */ });
  }

  broadcast(message) {
    this.sessions = this.sessions.filter(function (ws) {
      try {
        ws.send(message);
        return true;
      } catch (e) {
        return false;
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
