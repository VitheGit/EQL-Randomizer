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

// Chat name colors are restricted to a fixed palette rather than free
// input: it keeps everything readable against the parchment background,
// and means a client can never inject arbitrary values into what other
// people render.
// How long an offline member stays listed before being forgotten.
const MEMBER_TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

const CHAT_COLORS = [
  '#2A2016', '#8C3B2A', '#A85A1F', '#8A6A22',
  '#4B5A3A', '#1F6B6B', '#2C4A7C', '#6B3A7C', '#9B2242'
];

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
      server.serializeAttachment({
        lastPong: Date.now(),
        username: request.headers.get('X-EQL-Username') || null,
        lastChatAt: 0
      });
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

    sockets.forEach(function (ws, i) {
      var lastPong = now;
      var attachmentFound = false;
      try {
        var attachment = ws.deserializeAttachment();
        if (attachment && attachment.lastPong) {
          lastPong = attachment.lastPong;
          attachmentFound = true;
        }
      } catch (e) { /* no attachment yet — treat as fresh */ }

      var diff = now - lastPong;
      console.log('[GroupRoom] socket #' + i + ': attachmentFound=' + attachmentFound + ' lastPong=' + lastPong + ' now=' + now + ' diff=' + diff + 'ms (threshold=' + STALE_THRESHOLD_MS + 'ms)');

      if (diff > STALE_THRESHOLD_MS) {
        console.log('[GroupRoom] closing stale socket #' + i + ' — no pong for', diff, 'ms');
        try { ws.close(1000, 'stale connection'); } catch (e) { console.log('[GroupRoom] close() threw:', e.message); }
      } else {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
          console.log('[GroupRoom] sent ping to socket #' + i);
        } catch (e) {
          console.log('[GroupRoom] send(ping) threw for socket #' + i + ':', e.message);
        }
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
    let att = {};
    try { att = ws.deserializeAttachment() || {}; } catch (e) { att = {}; }

    let data = null;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.log('[GroupRoom] webSocketMessage JSON parse failed:', e.message);
      return;
    }
    if (!data || !data.type) return;

    if (data.type === 'pong') {
      // Merge rather than replace — the attachment also carries the
      // socket's username, which must survive every heartbeat.
      att.lastPong = Date.now();
      ws.serializeAttachment(att);
      return;
    }

    if (data.type === 'hello' || data.type === 'setcolor') {
      // 'hello' is sent once a client's socket is genuinely open (using
      // this rather than broadcasting at accept-time avoids a race where
      // the roster goes out before the new client can receive it).
      // 'setcolor' arrives when someone changes their name color, so
      // everyone's view updates without needing a reconnect.
      if (CHAT_COLORS.indexOf(data.color) !== -1) {
        att.color = data.color;
        ws.serializeAttachment(att);
      }
      if (data.type === 'hello') await this.touchMember(att.username);
      await this.broadcastRoster();
      return;
    }

    if (data.type === 'chat') {
      const text = String(data.text == null ? '' : data.text).trim().slice(0, 500);
      if (!text) return;
      // Attribution comes from the server-verified username stored at
      // connect time — never from the message payload.
      const from = att.username;
      if (!from) return;

      // Light rate limit so one client can't flood the room.
      const now = Date.now();
      if (att.lastChatAt && now - att.lastChatAt < 750) return;
      att.lastChatAt = now;
      ws.serializeAttachment(att);

      const color = CHAT_COLORS.indexOf(data.color) !== -1 ? data.color : CHAT_COLORS[0];

      this.broadcast(JSON.stringify({
        type: 'chat',
        from: from,
        text: text,
        color: color,
        time: new Date(now).toISOString()
      }));
      return;
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    console.log('[GroupRoom] webSocketClose fired. code=' + code + ' reason=' + reason + ' wasClean=' + wasClean);
    // Someone left — tell everyone still here so their list updates.
    try {
      // Record when they left, so the 5-day clock starts from their last
      // actual activity rather than from when they first connected.
      const a = ws.deserializeAttachment();
      if (a && a.username) await this.touchMember(a.username);
    } catch (e) { /* attachment may be gone — non-critical */ }
    try { await this.broadcastRoster(); } catch (e) { /* non-critical */ }
    // No manual cleanup needed — a closed socket just stops appearing in
    // future state.getWebSockets() calls on its own.
  }

  async webSocketError(ws, error) {
    // Same as above — nothing to do here.
  }

  // The room already holds a socket per connected member, each tagged
  // with its username — so presence needs no storage, just a read of
  // what's currently connected. Deduped, since one person can briefly
  // hold two sockets during a reconnect.
  getRoster() {
    const seen = {};
    this.state.getWebSockets().forEach(function (ws) {
      try {
        const a = ws.deserializeAttachment();
        if (a && a.username) seen[a.username] = true;
      } catch (e) { /* socket without an attachment — skip */ }
    });
    return Object.keys(seen).sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
  }

  // Everyone who has connected to this room recently, kept in the Durable
  // Object's own storage. This is what lets the client show an offline
  // section — the socket list alone only knows who's here right now.
  // Stored as one object under a single key (username -> last-seen ms)
  // rather than a key per member, so reads and writes stay at one row.
  async loadMembers() {
    const raw = await this.state.storage.get('members');
    if (!raw) return {};
    if (Array.isArray(raw)) {
      // Migrate the original shape, which was a plain array of names with
      // no timestamps. Treat them all as seen now rather than expiring
      // everyone the moment this ships.
      const now = Date.now();
      const migrated = {};
      raw.forEach(function (n) { migrated[n] = now; });
      await this.state.storage.put('members', migrated);
      return migrated;
    }
    return raw;
  }

  // Called when someone connects AND when they disconnect, so "last seen"
  // reflects when they actually left rather than when they arrived —
  // otherwise a long uninterrupted session would age out mid-play.
  async touchMember(username) {
    if (!username) return;
    const members = await this.loadMembers();
    members[username] = Date.now();
    await this.state.storage.put('members', members);
  }

  async broadcastRoster() {
    const online = this.getRoster();
    const members = await this.loadMembers();
    const now = Date.now();

    // Drop anyone who hasn't connected in a while, so the offline list
    // stays a picture of the active group rather than growing forever.
    let pruned = false;
    Object.keys(members).forEach(function (name) {
      if (online.indexOf(name) === -1 && (now - members[name]) > MEMBER_TTL_MS) {
        delete members[name];
        pruned = true;
      }
    });
    // Only write when something actually changed — this runs on every
    // join and leave, and pruning is rare.
    if (pruned) await this.state.storage.put('members', members);

    const offline = Object.keys(members)
      .filter(function (m) { return online.indexOf(m) === -1; })
      .sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });

    // Colors of everyone currently connected, so clients can render a
    // player's name in their chosen color anywhere it appears — not just
    // on their own chat messages.
    const colors = {};
    this.state.getWebSockets().forEach(function (ws) {
      try {
        const a = ws.deserializeAttachment();
        if (a && a.username && a.color) colors[a.username] = a.color;
      } catch (e) { /* skip */ }
    });

    this.broadcast(JSON.stringify({ type: 'presence', users: online, offline: offline, colors: colors }));
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
      // Forward the SERVER-VERIFIED username to the room. Chat messages
      // are attributed from this, never from anything the client sends,
      // so nobody can post under someone else's name.
      const fwd = new Request(request, request);
      fwd.headers.set('X-EQL-Username', username);
      return stub.fetch(fwd);
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
