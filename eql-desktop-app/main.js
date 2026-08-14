const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { autoUpdater } = require('electron-updater');

// Works around a well-documented electron-updater + GitHub Releases issue
// (net::ERR_HTTP2_SERVER_REFUSED_STREAM / ERR_HTTP2_PROTOCOL_ERROR) where
// Chromium's HTTP/2 implementation occasionally has trouble with GitHub's
// release-asset CDN. Forcing HTTP/1.1 for all of the app's network
// requests avoids the whole class of bug. Must be set before the app is
// ready, so it's here at the very top of the file.
app.commandLine.appendSwitch('disable-http2');

// Since this app deliberately minimizes to the tray instead of fully
// closing (see the closeBehavior setting), it's easy to forget it's
// already running and accidentally launch a second copy — which would
// mean two independent processes both polling the shared log and both
// firing their own notification for the same event. This lock makes any
// second launch just focus the existing window instead of running
// alongside it.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  runApp();
}

function runApp() {

let mainWindow = null;
let tray = null;
let notifyWindow = null;

// ---- Auto-update state ----
// status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
let updateState = { status: 'idle', version: null, progress: 0, errorMessage: null };

// ---- Settings persistence ----

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

// Temporary diagnostic logging for the realtime WebSocket ping/pong
// investigation — writes to a plain file so it's visible regardless of
// whether the app was launched from a terminal or just double-clicked.
const REALTIME_DEBUG_LOG_PATH = path.join(app.getPath('userData'), 'realtime-debug.log');
const REALTIME_DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB safety cap
function realtimeDebugLog(line) {
  try {
    var stats = fs.existsSync(REALTIME_DEBUG_LOG_PATH) ? fs.statSync(REALTIME_DEBUG_LOG_PATH) : null;
    if (stats && stats.size > REALTIME_DEBUG_LOG_MAX_BYTES) {
      // Roll over rather than growing forever if this ends up running
      // for longer than expected — keep just a marker of the reset so
      // it's obvious in the file itself what happened.
      fs.writeFileSync(REALTIME_DEBUG_LOG_PATH, '[' + new Date().toISOString() + '] --- log rolled over (exceeded 5MB) ---\n');
    }
    fs.appendFileSync(REALTIME_DEBUG_LOG_PATH, '[' + new Date().toISOString() + '] ' + line + '\n');
  } catch (e) { /* best-effort only */ }
}

// So a fresh install works immediately without anyone needing to know or
// type the backend URL. Only applied when nothing's been saved yet — an
// existing settings.json always wins, so this never overrides a value the
// user (or a future different backend) actually set.
const DEFAULT_API_BASE_URL = 'https://eqlegends-hardcore.pages.dev';

// The separate Durable Object worker that pushes live updates over
// WebSocket, replacing constant polling. Only used to trigger an
// immediate check when something actually happens — the log data itself
// still comes from the same /api/kv endpoint as always, so this worker
// never needs to be treated as a second source of truth.
const DEFAULT_REALTIME_URL = 'https://eql-realtime-worker.bradley-scott82.workers.dev';

function loadSettings() {
  var settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    settings = {};
  }
  if (!settings.apiBaseUrl) {
    settings.apiBaseUrl = DEFAULT_API_BASE_URL;
  }
  if (!settings.realtimeUrl) {
    settings.realtimeUrl = DEFAULT_REALTIME_URL;
  }
  if (typeof settings.soundsEnabled !== 'boolean') {
    settings.soundsEnabled = true; // on by default — only an explicit false (a real saved choice) turns it off
  }
  if (typeof settings.notificationsEnabled !== 'boolean') {
    settings.notificationsEnabled = true;
  }
  if (typeof settings.notificationVolume !== 'number') {
    settings.notificationVolume = 1.0; // 100% — a multiplier on top of each sound's own tuned base volume
  }
  return settings;
}

function saveSettingsToDisk(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Could not save settings:', e);
  }
}

// ---- Custom notifications ----
//
// Deliberately NOT using Electron's native Notification API (Windows toasts).
// Two reasons: (1) Windows automatically enables Focus Assist / Do Not
// Disturb while a game is running in fullscreen by default, which silently
// swallows native toasts at exactly the moment they matter most; (2) this
// gives full control over position (top-center of the primary monitor)
// instead of wherever Windows decides to put toasts.
//
// This is a separate, always-on-top, click-through, frameless window that
// stays alive for the whole app session and just streams toast data into
// it via IPC — nothing to do with the OS notification center at all.

function getNotifyWindow() {
  if (notifyWindow && !notifyWindow.isDestroyed()) return notifyWindow;

  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const winWidth = 400;
  const winHeight = 640;
  const x = Math.round(workArea.x + (workArea.width - winWidth) / 2);
  const y = workArea.y + 10;

  notifyWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false, // never steal focus/keyboard input from the game
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'notify-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  notifyWindow.setAlwaysOnTop(true, 'screen-saver'); // highest level Electron offers on Windows
  notifyWindow.setIgnoreMouseEvents(true, { forward: true }); // fully click-through
  notifyWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notifyWindow.loadFile(path.join(__dirname, 'renderer', 'notify.html'));
  notifyWindow.once('ready-to-show', function () {
    notifyWindow.showInactive(); // visible without stealing focus
  });

  return notifyWindow;
}

function notify(title, body, kind) {
  try {
    const settings = loadSettings();
    if (!settings.notificationsEnabled) return; // master switch — nothing shows at all, not even silently
    const win = getNotifyWindow();
    const soundsEnabled = settings.soundsEnabled;
    const notificationVolume = settings.notificationVolume;
    const send = function () {
      win.webContents.send('show-toast', { title: title, body: body, kind: kind || 'info', soundsEnabled: soundsEnabled, notificationVolume: notificationVolume });
      if (!win.isVisible()) win.showInactive();
    };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  } catch (e) {
    console.error('Custom notification failed:', e);
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---- Auto-update wiring ----
//
// autoDownload is deliberately off — the app notifies the user an update
// exists, but only downloads/installs when they choose to (from Settings),
// rather than silently using their bandwidth in the background.

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function setUpdateState(patch) {
  updateState = Object.assign({}, updateState, patch);
  sendToRenderer('update-status', updateState);
}

// Tracks whether the check currently in flight was started by the user
// clicking "Check for Updates," as opposed to the automatic background
// check (on launch, and every 4 hours). Background checks that fail
// (e.g. a transient GitHub rate limit) shouldn't leave a stale error
// sitting in the UI for the user to stumble across hours later when they
// weren't even asking — only a check THEY just triggered should surface
// its own error.
var manualCheckInFlight = false;

// electron-updater's HTTP errors often embed the ENTIRE raw response —
// headers, a full HTML error page body, everything — concatenated into
// err.message. That's fine for logs, but never fit to show a user.
// This keeps just the short, meaningful summary at the front of the
// message (e.g. "429 Too Many Requests ...") and drops everything after
// the first line, with a hard length cap as a backstop for any other
// unexpectedly verbose error shape.
function summarizeUpdateError(err) {
  var raw = (err && err.message) ? String(err.message) : '';
  if (!raw) return 'Unknown error checking for updates.';
  var firstLine = raw.split('\n')[0].trim();
  if (!firstLine) firstLine = raw.trim();
  if (firstLine.length > 150) firstLine = firstLine.slice(0, 150) + '…';
  return firstLine || 'Unknown error checking for updates.';
}

autoUpdater.on('checking-for-update', function () {
  setUpdateState({ status: 'checking', errorMessage: null });
});

autoUpdater.on('update-available', function (info) {
  setUpdateState({ status: 'available', version: info.version, errorMessage: null });
  notify('Update Available!', 'Version ' + info.version + ' is ready. Go to Settings to update.', 'update');
  manualCheckInFlight = false;
});

autoUpdater.on('update-not-available', function () {
  setUpdateState({ status: 'not-available', version: null, errorMessage: null });
  manualCheckInFlight = false;
});

autoUpdater.on('download-progress', function (progress) {
  setUpdateState({ status: 'downloading', progress: Math.round(progress.percent) });
});

autoUpdater.on('update-downloaded', function (info) {
  setUpdateState({ status: 'downloaded', version: info.version, progress: 100, errorMessage: null });
  notify('Update Ready!', 'Restart the app from Settings to finish installing version ' + info.version + '.', 'update');
});

autoUpdater.on('error', function (err) {
  if (manualCheckInFlight) {
    setUpdateState({ status: 'error', errorMessage: summarizeUpdateError(err) });
  } else {
    // Silent background failure — log it, but don't leave a stale error
    // sitting in the UI. Still has to move OFF the 'checking' state
    // though, or the UI gets stuck showing "Checking..." forever.
    console.error('Background update check failed silently:', err);
    setUpdateState({ status: 'idle', errorMessage: null });
  }
  manualCheckInFlight = false;
});

// ---- Backend API calls made from the main process (background auto-submit) ----

async function autoSubmit(type, level, killedBy) {
  const s = loadSettings();
  if (!s.apiBaseUrl || !s.token) return;
  try {
    const body = { type: type };
    if (level !== null && level !== undefined) body.level = level;
    if (killedBy) body.killedBy = killedBy;
    // Deliberately no "manual" flag here — this path is only reached by
    // the automatic log-file detection, never the manual buttons.
    const res = await fetch(s.apiBaseUrl.replace(/\/$/, '') + '/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.token },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(function () { return null; });
    if (!res.ok) {
      console.error('Auto-submit failed:', data);
      notify('Sync Problem', (data && data.error) || 'Could not report that to the server.', 'error');
      return;
    }
    sendToRenderer('character-resolved', { type: type, level: level });
  } catch (e) {
    console.error('Auto-submit network error:', e);
    notify('Sync Problem', 'Could not reach the server. Check your connection.', 'error');
  }
}

async function submitMilestone(type, extra) {
  const s = loadSettings();
  if (!s.apiBaseUrl || !s.token) return;
  try {
    const body = Object.assign({ type: type }, extra);
    const res = await fetch(s.apiBaseUrl.replace(/\/$/, '') + '/api/milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.token },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const data = await res.json().catch(function () { return null; });
      console.error('Milestone submit failed:', data);
    }
  } catch (e) {
    console.error('Milestone submit network error:', e);
    // Deliberately no user-facing "Sync Problem" notification here — a
    // missed level-up/AA broadcast is low-stakes compared to a missed
    // death/ding, not worth interrupting the player over.
  }
}

// ---- Log file watching (polling-based tail) ----

const LEVEL_UP_RE = /\]\s*You have gained a level! Welcome to level (\d+)!/;
// The game refers to your OWN death in first person ("You"), not by your
// character's name — third-person "X has been slain by Y!" is what shows
// for other people's deaths, which this app doesn't need to detect from
// the log at all (that comes from polling the shared server data instead).
const SELF_DEATH_RE = /\]\s*You have been slain by (.+?)!/;
const AA_GAIN_RE = /\]\s*You have gained an ability point!\s*You now have (\d+) ability points?\./;

var watchState = {
  timer: null,
  lastSize: 0,
  currentLevel: null,
  characterName: null,
  logPath: null,
  // True only while we believe there's a currently-locked character that
  // hasn't been resolved yet. Guards against repeated "You Died" spam if
  // a character keeps dying (e.g. corpse-camped) before being deleted —
  // only the FIRST death after a roll gets reported.
  characterActive: false
};

function stopLogWatching() {
  if (watchState.timer) clearInterval(watchState.timer);
  watchState.timer = null;
}

function startLogWatching(logPath, characterName) {
  stopLogWatching();
  watchState.logPath = logPath;
  watchState.characterName = (characterName || '').trim();
  watchState.currentLevel = null;

  try {
    const stats = fs.statSync(logPath);
    // Start from the current end of the file — we only care about NEW
    // events from this point forward, not the entire history.
    watchState.lastSize = stats.size;

    // Recover the most recently known level from the file's existing
    // history, so restarting the app mid-session (e.g. to apply an
    // update) doesn't lose track and silently report "level 1" on the
    // next death. This is a best-effort heuristic — it can't tell where
    // one character's history ends and a new one begins, so it may be
    // briefly stale if you've already rolled a new character since the
    // last level-up line but haven't leveled again yet.
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const globalLevelRe = new RegExp(LEVEL_UP_RE.source, 'g');
      const matches = content.match(globalLevelRe);
      if (matches && matches.length) {
        const lastLine = matches[matches.length - 1];
        const lastMatch = lastLine.match(LEVEL_UP_RE);
        if (lastMatch) watchState.currentLevel = parseInt(lastMatch[1], 10);
      }
    } catch (e) {
      // Non-fatal — just means we start without a recovered level.
    }
  } catch (e) {
    watchState.lastSize = 0;
    notify('Log File Not Found', 'Could not open the log file at the configured path. Check Settings.', 'error');
    return;
  }

  watchState.timer = setInterval(pollLogFile, 1500);
  sendToRenderer('watch-status', { watching: true, logPath: logPath, characterName: characterName });
  if (watchState.currentLevel) sendToRenderer('level-update', watchState.currentLevel);
}

async function pollLogFile() {
  if (!watchState.logPath) return;
  let stats;
  try {
    stats = fs.statSync(watchState.logPath);
  } catch (e) {
    return; // file may be briefly locked by the game client; retry next tick
  }

  if (stats.size < watchState.lastSize) {
    // Log file was rotated/truncated (e.g. game client reset it) — reset
    // our position rather than trying to read a now-invalid byte range.
    watchState.lastSize = 0;
  }
  if (stats.size === watchState.lastSize) return;

  let chunk;
  try {
    const fd = fs.openSync(watchState.logPath, 'r');
    const length = stats.size - watchState.lastSize;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, watchState.lastSize);
    fs.closeSync(fd);
    chunk = buffer.toString('utf8');
  } catch (e) {
    console.error('Error reading log file:', e);
    return;
  }
  watchState.lastSize = stats.size;

  const lines = chunk.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    processLogLine(line);
  }
}

function processLogLine(line) {
  const levelMatch = line.match(LEVEL_UP_RE);
  if (levelMatch) {
    const level = parseInt(levelMatch[1], 10);
    watchState.currentLevel = level;
    sendToRenderer('level-update', level);
    if (level >= 50) {
      if (watchState.characterActive) {
        watchState.characterActive = false; // guard first, before the async submit even starts
        notify('Ding! Level 50!', (watchState.characterName || 'Your character') + ' reached level 50!', 'ding');
        autoSubmit('ding', null);
      }
    } else {
      notify('Level Up!', (watchState.characterName || 'Your character') + ' reached level ' + level + '.', 'levelup');
      submitMilestone('levelup', { level: level });
    }
    return;
  }

  const aaMatch = line.match(AA_GAIN_RE);
  if (aaMatch) {
    const totalAA = parseInt(aaMatch[1], 10);
    notify('AA Gained!', (watchState.characterName || 'Your character') + ' has gained an AA! (now has ' + totalAA + ' ability point' + (totalAA === 1 ? '' : 's') + ')', 'aa');
    submitMilestone('aa', { aaTotal: totalAA });
    return;
  }

  const deathMatch = line.match(SELF_DEATH_RE);
  if (deathMatch && watchState.characterActive) {
    watchState.characterActive = false; // guard first — any further death lines this session are ignored
    var killer = deathMatch[1].trim();
    var level = watchState.currentLevel || 1;
    notify('You Died', (watchState.characterName || 'Your character') + ' was slain by ' + killer + ' at level ' + level + '.', 'death');
    autoSubmit('died', level, killer);
    watchState.currentLevel = null;
  }
}

// ---- Shared log polling (for OTHER players' death/ding announcements) ----

var lastSeenLogLength = null;
var pollInFlight = false; // guards against overlapping polls if a request runs long

// ---- Realtime WebSocket (low-latency trigger for the poll above) ----
//
// This does NOT replace pollSharedLog as the actual data source — it
// just tells the app to check *right now* instead of waiting for the
// next scheduled tick. That keeps all the existing, already-tested
// fetch/diff/notify logic exactly as it was; the socket's only job is
// cutting the delay down from "up to one poll interval" to "near
// instant," while letting that interval be turned way down (a rare
// safety net instead of the primary delivery mechanism).
var realtimeSocket = null;
var realtimeReconnectTimer = null;
var realtimeReconnectDelay = 2000; // starts at 2s, doubles up to the cap below on repeated failures
var REALTIME_RECONNECT_MAX_DELAY = 60000;
var realtimeIntentionalClose = false;

function wsUrlFor(httpUrl) {
  return httpUrl.replace(/\/$/, '').replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/connect';
}

function connectRealtime() {
  var s = loadSettings();
  if (!s.realtimeUrl || !s.token) return;

  // Already connected or actively trying — don't stack up sockets.
  if (realtimeSocket && (realtimeSocket.readyState === WebSocket.OPEN || realtimeSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  clearTimeout(realtimeReconnectTimer);
  realtimeDebugLog('CONNECT ATTEMPT — url=' + wsUrlFor(s.realtimeUrl));

  var ws;
  try {
    ws = new WebSocket(wsUrlFor(s.realtimeUrl), {
      headers: { Authorization: 'Bearer ' + s.token }
    });
  } catch (e) {
    scheduleRealtimeReconnect();
    return;
  }
  realtimeSocket = ws;
  realtimeIntentionalClose = false;

  ws.on('open', function () {
    realtimeDebugLog('OPEN — connection established');
    realtimeReconnectDelay = 2000; // reset backoff on a successful connection
    // Reconnecting (or connecting for the first time) might mean we
    // missed something — do one immediate check to catch up.
    pollSharedLog();
  });

  ws.on('message', function (data) {
    var rawType = Buffer.isBuffer(data) ? 'Buffer' : typeof data;
    var rawText;
    try { rawText = data.toString('utf8'); } catch (e) { rawText = '(could not convert to string: ' + e.message + ')'; }
    realtimeDebugLog('MESSAGE received — raw type=' + rawType + ' content=' + rawText);

    var msg = null;
    try { msg = JSON.parse(rawText); } catch (e) {
      realtimeDebugLog('MESSAGE — JSON.parse failed: ' + e.message);
    }

    if (msg && msg.type === 'ping') {
      realtimeDebugLog('MESSAGE — recognized as ping, attempting to send pong');
      // Server-side heartbeat check — answer it so this connection isn't
      // mistaken for dead and pruned, but this isn't new data, so don't
      // trigger a poll for it.
      try {
        ws.send(JSON.stringify({ type: 'pong' }));
        realtimeDebugLog('MESSAGE — pong sent successfully. readyState=' + ws.readyState);
      } catch (e) {
        realtimeDebugLog('MESSAGE — pong send THREW: ' + e.message);
      }
      return;
    }

    realtimeDebugLog('MESSAGE — not a ping (parsed type=' + (msg && msg.type) + '), triggering poll');
    // Anything else means "something changed" — the existing poll
    // fetches the real, current data regardless of this message's content.
    pollWithConsistencyRetries();
  });

  ws.on('close', function (code, reason) {
    realtimeDebugLog('CLOSE — code=' + code + ' reason=' + (reason ? reason.toString() : '(none)'));
    if (realtimeSocket === ws) realtimeSocket = null;
    if (!realtimeIntentionalClose) scheduleRealtimeReconnect();
  });

  ws.on('error', function () {
    // 'close' fires right after 'error' for connection failures, which
    // schedules the reconnect — nothing else to do here.
  });
}

function scheduleRealtimeReconnect() {
  clearTimeout(realtimeReconnectTimer);
  realtimeReconnectTimer = setTimeout(function () {
    connectRealtime();
    realtimeReconnectDelay = Math.min(realtimeReconnectDelay * 2, REALTIME_RECONNECT_MAX_DELAY);
  }, realtimeReconnectDelay);
}

function disconnectRealtime() {
  realtimeIntentionalClose = true;
  clearTimeout(realtimeReconnectTimer);
  if (realtimeSocket) {
    try { realtimeSocket.close(); } catch (e) { /* ignore */ }
    realtimeSocket = null;
  }
}

function reconnectRealtimeNow() {
  // Used when the account's group changes — the server resolves which
  // "room" to join at connect time, so a stale connection would still
  // be listening to the old group until it reconnects.
  disconnectRealtime();
  connectRealtime();
}

// System sleep is a real gap in the passive "wait for the heartbeat to
// notice" recovery path: when Windows sleeps, the network dies with no
// close/error event at all — the socket object just sits there still
// believing it's open, since nothing ever told it otherwise. Left alone,
// recovery would depend entirely on the next heartbeat cycle noticing
// once the machine wakes back up, which could take a couple of minutes
// rather than being immediate. This handles it directly instead of
// hoping the passive path catches it quickly enough.
function setupPowerMonitorHandling() {
  powerMonitor.on('suspend', function () {
    realtimeDebugLog('POWER — system suspending, disconnecting cleanly');
    disconnectRealtime();
  });
  powerMonitor.on('resume', function () {
    realtimeDebugLog('POWER — system resumed, reconnecting immediately');
    connectRealtime();
  });
}

async function pollSharedLog() {
  if (pollInFlight) return null; // a previous poll hasn't finished yet — skip this tick rather than risk double-processing the same entries
  pollInFlight = true;
  try {
    return await pollSharedLogInner();
  } finally {
    pollInFlight = false;
  }
}

// A WebSocket message means something changed in KV *just* now — but KV
// itself is eventually consistent, and the specific edge location that
// happens to serve a given read can occasionally lag behind. Cloudflare's
// own documentation puts the worst case at up to 60 seconds. Without
// this, a poll that lands during that gap comes back clean (200 OK,
// nothing thrown) but with genuinely stale data, finds nothing new, and
// nothing re-checks again until some later, unrelated event happens to
// trigger another poll — which could be minutes away. These retries,
// spaced out and covering that full documented window, close the gap
// without polling aggressively all the time.
var CONSISTENCY_RETRY_DELAYS_MS = [3000, 6000, 12000, 20000, 20000]; // cumulative: ~61s, matching KV's documented worst case

function pollWithConsistencyRetries() {
  attemptWithRetries(0);

  function attemptWithRetries(retryIndex) {
    pollSharedLog().then(function (foundSomething) {
      if (foundSomething !== false) return; // true = found it, null = skipped/errored — neither needs a consistency retry
      if (retryIndex >= CONSISTENCY_RETRY_DELAYS_MS.length) {
        realtimeDebugLog('POLL — gave up after ' + retryIndex + ' consistency retries (~60s); waiting for the next natural trigger');
        return;
      }
      var delay = CONSISTENCY_RETRY_DELAYS_MS[retryIndex];
      realtimeDebugLog('POLL — came back clean but found nothing new yet; retry ' + (retryIndex + 1) + '/' + CONSISTENCY_RETRY_DELAYS_MS.length + ' in ' + delay + 'ms');
      setTimeout(function () { attemptWithRetries(retryIndex + 1); }, delay);
    });
  }
}

async function pollSharedLogInner() {
  const s = loadSettings();
  if (!s.apiBaseUrl || !s.token) return null;
  realtimeDebugLog('POLL — starting fetch of shared log');
  try {
    // An explicit timeout matters here specifically: without one, a
    // request that hangs (rather than cleanly failing) would leave
    // pollInFlight stuck true indefinitely, silently blocking every
    // future poll — including the one a realtime WebSocket message just
    // triggered — until some much longer, unrelated default timeout
    // eventually gives up on its own.
    const controller = new AbortController();
    const timeoutId = setTimeout(function () { controller.abort(); }, 15000);
    let res;
    try {
      res = await fetch(s.apiBaseUrl.replace(/\/$/, '') + '/api/kv?key=log', {
        headers: { 'Authorization': 'Bearer ' + s.token },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    realtimeDebugLog('POLL — fetch completed, status=' + res.status);
    const data = await res.json().catch(function () { return null; });
    if (!data || typeof data.value !== 'string') return null;
    const log = JSON.parse(data.value);

    if (lastSeenLogLength === null) {
      // First check after launch — don't fire notifications for the
      // entire pre-existing history, just start tracking from here.
      lastSeenLogLength = log.length;
      sendToRenderer('log-updated', log);
      return null;
    }

    if (log.length > lastSeenLogLength) {
      const newEntries = log.slice(lastSeenLogLength);
      newEntries.forEach(function (entry) {
        if (entry.name === s.username) return; // already notified locally via the log watcher
        if (entry.type === 'died') {
          notify('Death Announcement', entry.name + ' died at level ' + (entry.level || '?') + '.', 'death');
        } else if (entry.type === 'ding') {
          notify('Level 50!', entry.name + ' reached level 50!', 'ding');
        } else if (entry.type === 'levelup') {
          notify('Level Up!', entry.name + ' reached level ' + entry.level + '.', 'levelup');
        } else if (entry.type === 'aa') {
          notify('AA Gained!', entry.name + ' has gained an AA! (now has ' + entry.aaTotal + ' ability point' + (entry.aaTotal === 1 ? '' : 's') + ')', 'aa');
        }
      });
      sendToRenderer('log-updated', log);
      // Only ever move forward. Cloudflare KV has eventual consistency —
      // a read can occasionally come back momentarily stale/shorter than a
      // previous read while writes are still propagating. If we let that
      // pull the baseline backward, a later poll that sees the real
      // (longer) log again would re-detect already-notified entries as
      // "new" and fire duplicate notifications for them.
      lastSeenLogLength = Math.max(lastSeenLogLength, log.length);
      return true; // found something new
    }
    lastSeenLogLength = Math.max(lastSeenLogLength, log.length);
    return false; // checked successfully, nothing new (yet — may still be propagating)
  } catch (e) {
    // Transient network errors are expected occasionally; ignore quietly,
    // but log it so this is diagnosable if it keeps happening.
    realtimeDebugLog('POLL — failed/timed out: ' + (e && e.message));
    return null;
  }
}

// ---- IPC handlers ----

ipcMain.handle('select-log-file', async function () {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your EverQuest Legends log file',
    filters: [{ name: 'Log Files', extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('load-settings', function () {
  return loadSettings();
});

ipcMain.handle('save-settings', function (event, newSettings) {
  const merged = Object.assign({}, loadSettings(), newSettings || {});
  saveSettingsToDisk(merged);
  if (merged.logFilePath && merged.characterName) {
    startLogWatching(merged.logFilePath, merged.characterName);
  } else {
    stopLogWatching();
  }
  connectRealtime();
  return merged;
});

ipcMain.handle('show-notification', function (event, payload) {
  notify((payload && payload.title) || 'EQ Legends Randomizer', (payload && payload.body) || '', (payload && payload.kind) || 'info');
});

ipcMain.handle('get-watch-status', function () {
  return {
    watching: !!watchState.timer,
    logPath: watchState.logPath,
    characterName: watchState.characterName,
    currentLevel: watchState.currentLevel
  };
});

ipcMain.handle('character-rolled', function () {
  // A fresh character starts over — clear any level tracked from a
  // previous (now-resolved) character so a death before the first
  // real level-up line doesn't misreport an old level. Also (re)arm the
  // death/ding guard so this new character's first death gets reported.
  watchState.currentLevel = null;
  watchState.characterActive = true;
  sendToRenderer('level-update', null);
});

ipcMain.handle('character-locked-sync', function () {
  // Used only at app startup to inform main that a character was ALREADY
  // locked from a previous session (not a fresh roll just now) — arms the
  // guard without touching currentLevel, since that's separately recovered
  // from log history.
  watchState.characterActive = true;
});

ipcMain.handle('character-unlocked', function () {
  // A character was resolved via the manual I Died / Ding! / Roll Again
  // buttons in the renderer — main.js wouldn't otherwise know about that,
  // so keep the guard in sync to prevent any stray auto-detected death
  // line for the now-resolved character from firing another notification.
  watchState.characterActive = false;
});

ipcMain.handle('group-changed', function () {
  // The group's log is a completely different array now — reset so the
  // next poll re-baselines instead of either missing new entries (if the
  // new group's log is shorter) or notifying about the new group's
  // entire history at once (if it's longer).
  lastSeenLogLength = null;
  reconnectRealtimeNow();
});

// Only these exact URLs can ever be opened externally — the renderer
// can't be trusted to send an arbitrary URL through to shell.openExternal,
// even though this app only ever sends its own known links today.
const ALLOWED_EXTERNAL_LINKS = [
  'https://eqlwiki.com/',
  'https://eqlposky.com/',
  'https://jmoyers.github.io/everquest-companion/'
];

ipcMain.handle('open-external-link', function (event, url) {
  if (ALLOWED_EXTERNAL_LINKS.indexOf(url) !== -1) {
    shell.openExternal(url);
  }
});

ipcMain.handle('get-app-version', function () {
  return app.getVersion();
});

ipcMain.handle('get-update-status', function () {
  return updateState;
});

ipcMain.handle('check-for-updates', function () {
  manualCheckInFlight = true;
  autoUpdater.checkForUpdates().catch(function (err) {
    setUpdateState({ status: 'error', errorMessage: summarizeUpdateError(err) || 'Could not check for updates.' });
    manualCheckInFlight = false;
  });
});

ipcMain.handle('download-update', function () {
  autoUpdater.downloadUpdate().catch(function (err) {
    setUpdateState({ status: 'error', errorMessage: summarizeUpdateError(err) || 'Could not download the update.' });
  });
});

ipcMain.handle('install-update', function () {
  app.isQuitting = true;
  autoUpdater.quitAndInstall();
});

// ---- Window & tray ----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 820,
    minWidth: 1050,
    minHeight: 600,
    title: 'EQ Legends Randomizer v' + app.getVersion(),
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Electron normally syncs the window title to the page's <title> tag once
  // it loads, which would silently overwrite the version number we just set.
  mainWindow.on('page-title-updated', function (event) {
    event.preventDefault();
  });

  mainWindow.on('close', function (e) {
    if (app.isQuitting) return; // real quit via tray menu / setting — let it proceed

    var s = loadSettings();
    if (s.closeBehavior === 'quit') {
      app.isQuitting = true;
      app.quit();
      return;
    }

    // Default: minimize to the system tray instead of closing.
    e.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'build', 'tray.png'));
  const menu = Menu.buildFromTemplate([
    { label: 'Show EQ Legends Randomizer', click: function () { mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Quit', click: function () { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('EQ Legends Randomizer');
  tray.setContextMenu(menu);
  tray.on('click', function () { mainWindow.show(); });
}

app.whenReady().then(function () {
  createWindow();
  createTray();

  const s = loadSettings();
  if (s.logFilePath && s.characterName) {
    startLogWatching(s.logFilePath, s.characterName);
  }

  pollSharedLog();
  setInterval(pollSharedLog, 5 * 60 * 1000); // rare safety net now — the WebSocket is the real delivery mechanism
  connectRealtime();
  setupPowerMonitorHandling();

  // Defensive safety net while the actual root cause of long-idle-period
  // degradation is still being tracked down: force a completely fresh
  // reconnect periodically regardless of the current connection's
  // apparent health. This doesn't fix whatever the underlying issue
  // turns out to be, but it bounds the worst case — instead of a
  // connection potentially degrading for hours before anything notices,
  // it can never go stale for longer than this interval.
  setInterval(function () {
    realtimeDebugLog('PERIODIC — forcing a fresh reconnect as a safety net');
    reconnectRealtimeNow();
  }, 30 * 60 * 1000); // every 30 minutes

  // Check for updates a few seconds after launch (not instantly, so it
  // doesn't compete with initial window/login rendering), then periodically
  // in case the app stays open for a long play session.
  setTimeout(function () {
    autoUpdater.checkForUpdates().catch(function () { /* silent on startup */ });
  }, 8000);
  setInterval(function () {
    autoUpdater.checkForUpdates().catch(function () { /* silent on periodic check */ });
  }, 60 * 60 * 1000); // every 1 hour

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', function () {
  // Intentionally do nothing — the app lives in the tray until Quit is
  // chosen from the tray menu, so background log watching keeps running.
});

app.on('before-quit', function () {
  app.isQuitting = true;
  disconnectRealtime();
});

} // end runApp()
