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
let chatOverlayWindow = null;

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
  if (!settings.notificationPosition) {
    settings.notificationPosition = 'top-middle'; // matches the previous hardcoded behavior
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

// Computes the notify window's on-screen position from the user's
// setting. Positions are relative to the primary display's work area
// (which excludes the taskbar), with a small margin so toasts don't sit
// flush against the screen edge.
function computeNotifyPosition(position, workArea, winWidth, winHeight) {
  var margin = 10;
  var pos = position || 'top-middle';
  var parts = pos.split('-');
  var vertical = parts[0];   // 'top' | 'middle' | 'bottom'
  var horizontal = parts[1]; // 'left' | 'middle'/'center' | 'right'

  var x;
  if (horizontal === 'left') {
    x = workArea.x + margin;
  } else if (horizontal === 'right') {
    x = workArea.x + workArea.width - winWidth - margin;
  } else {
    x = Math.round(workArea.x + (workArea.width - winWidth) / 2);
  }

  var y;
  if (vertical === 'bottom') {
    y = workArea.y + workArea.height - winHeight - margin;
  } else if (vertical === 'middle' || pos === 'center') {
    y = Math.round(workArea.y + (workArea.height - winHeight) / 2);
  } else {
    y = workArea.y + margin;
  }

  return { x: x, y: y };
}

function getNotifyWindow() {
  if (notifyWindow && !notifyWindow.isDestroyed()) return notifyWindow;

  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const winWidth = 400;
  const winHeight = 640;
  const position = loadSettings().notificationPosition;
  const coords = computeNotifyPosition(position, workArea, winWidth, winHeight);
  const x = coords.x;
  const y = coords.y;

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
  // Mirror into the group chat as a system line. Done here so EVERY
  // notification path is covered automatically, and deliberately before
  // the notificationsEnabled check — turning off popups shouldn't also
  // blank out the chat history of what happened.
  var sysEntry = { title: title, body: body, kind: kind || 'info', time: new Date().toISOString() };
  recordChat({ system: true, text: title + (body ? ' — ' + body : ''), time: sysEntry.time });
  sendToChatWindows('chat-system', sysEntry);
  try {
    const settings = loadSettings();
    if (!settings.notificationsEnabled) return; // master switch — nothing shows at all, not even silently
    const win = getNotifyWindow();
    const soundsEnabled = settings.soundsEnabled;
    const notificationVolume = settings.notificationVolume;
    const send = function () {
      win.webContents.send('show-toast', { title: title, body: body, kind: kind || 'info', soundsEnabled: soundsEnabled, notificationVolume: notificationVolume, position: settings.notificationPosition || 'top-middle' });
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

// The overlay is a second window that can open at any time, so main
// keeps a short rolling buffer of chat — otherwise opening the overlay
// mid-conversation would show an empty box.
var chatHistory = [];
var lastPresence = [];
var CHAT_HISTORY_MAX = 100;
function recordChat(entry) {
  chatHistory.push(entry);
  if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory = chatHistory.slice(-CHAT_HISTORY_MAX);
}

// Chat/presence must reach BOTH the main window and the overlay.
function sendToChatWindows(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  if (chatOverlayWindow && !chatOverlayWindow.isDestroyed()) chatOverlayWindow.webContents.send(channel, payload);
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
const ZONE_ENTER_RE = /\]\s*You have entered ([^.]+)\./;

// EQ log lines are prefixed like "[Wed Jul 29 12:38:40 2026] ...".
// Returns null for anything that doesn't parse, so callers can decide
// how to treat an unknown timestamp rather than trusting a bad date.
function parseLogTimestamp(line) {
  const m = line.match(/^\[([A-Za-z]{3} [A-Za-z]{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\]/);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d.getTime()) ? null : d;
}

// A /who result line, e.g.:
//   [35 CLR/SHD/BER] Vithe (Troll) <Loot Kills> ZONE: The Lair of the Splitpaw (paw)
//   [1 SHD/BRD] Gloond (Froglok)
// Characters have only two classes below level 10, so the third is
// optional. Guild tag and ZONE suffix are both optional too.
const WHO_LINE_RE = /\]\s*\[\s*(\d+)\s+([A-Z]{3}(?:\/[A-Z]{3}){0,2})\]\s+(\S+)\s+\(/;

const CLASS_ABBR = {
  'Enchanter': 'ENC', 'Magician': 'MAG', 'Necromancer': 'NEC', 'Wizard': 'WIZ',
  'Bard': 'BRD', 'Beastlord': 'BST', 'Paladin': 'PAL', 'Ranger': 'RNG',
  'Shadow Knight': 'SHD', 'Cleric': 'CLR', 'Druid': 'DRU', 'Shaman': 'SHM',
  'Berserker': 'BER', 'Monk': 'MNK', 'Rogue': 'ROG', 'Warrior': 'WAR'
};

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
  characterActive: false,
  // Whether the current active character has "D4 Only" enabled — drives
  // the zone-enter reminder below. Kept in sync by the renderer via the
  // character-rolled/character-locked-sync/character-unlocked IPC calls.
  characterD4: false,
  // The rolled character's classes, for verifying /who output against
  // what they're actually logged into. Kept in sync by the renderer.
  characterClasses: null,
  // When the current character was rolled — used to ignore log history
  // belonging to a previous character that shared this log file.
  characterRolledAt: null,
  // Guards against re-notifying about the same mismatch on every /who.
  lastMismatchNotifiedAt: 0
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
    // next death.
    //
    // Crucially, only level-ups logged AFTER the current character was
    // rolled count. A deleted-and-remade character reuses the same log
    // file, so the previous character's level-ups are still sitting in
    // there — without this cutoff, a fresh level 1 would inherit the
    // dead character's level and report the wrong one on death.
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const rolledAt = watchState.characterRolledAt ? new Date(watchState.characterRolledAt) : null;
      const lines = content.split(/\r?\n/);
      let recovered = null;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(LEVEL_UP_RE);
        if (!m) continue;
        if (rolledAt) {
          const stamp = parseLogTimestamp(lines[i]);
          if (!stamp || stamp < rolledAt) continue; // belongs to an earlier character
        }
        recovered = parseInt(m[1], 10);
      }
      // No qualifying level-up means this character hasn't leveled yet —
      // that's level 1, not "unknown".
      watchState.currentLevel = recovered !== null ? recovered : (watchState.characterActive ? 1 : null);
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

// Throttled so ordinary chat/combat spam doesn't hammer the backend —
// the repairs this triggers are rare and not time-critical, so checking
// a few times an hour is plenty.
var SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
var lastSyncAt = 0;

async function syncSharedState(force) {
  const s = loadSettings();
  if (!s.apiBaseUrl || !s.token) return;
  if (!watchState.characterActive) return; // nothing to repair without an active character
  const now = Date.now();
  if (!force && now - lastSyncAt < SYNC_MIN_INTERVAL_MS) return;
  lastSyncAt = now;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(function () { controller.abort(); }, 15000);
    let res;
    try {
      res = await fetch(s.apiBaseUrl.replace(/\/$/, '') + '/api/sync', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + s.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: watchState.currentLevel || null })
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const data = await res.json().catch(function () { return null; });
    if (data && data.repaired) {
      realtimeDebugLog('SYNC — repaired shared state: ' + JSON.stringify(data));
      pollSharedLog(); // pull the corrected log so the UI updates right away
    }
  } catch (e) {
    realtimeDebugLog('SYNC — failed: ' + (e && e.message));
  }
}

// Handles a single /who result line. Only acts on the line matching the
// player's own configured character name — /who lists the whole zone.
var MISMATCH_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

function handleWhoLine(level, classStr, name) {
  if (!watchState.characterActive) return;
  if (!watchState.characterName) return;
  if (name.toLowerCase() !== watchState.characterName.trim().toLowerCase()) return;

  const reported = classStr.split('/');

  // Verify classes against the rolled character. Below level 10 a
  // character only has two classes, so a two-class /who line is a valid
  // prefix match rather than a mismatch.
  if (watchState.characterClasses && watchState.characterClasses.length) {
    const expected = watchState.characterClasses.map(function (cls) {
      return CLASS_ABBR[cls] || String(cls).toUpperCase();
    });
    let mismatch = false;
    for (let i = 0; i < reported.length; i++) {
      if (!expected[i] || reported[i] !== expected[i]) { mismatch = true; break; }
    }
    // More classes shown than the character should have is also wrong.
    if (reported.length > expected.length) mismatch = true;

    if (mismatch) {
      const now = Date.now();
      if (now - watchState.lastMismatchNotifiedAt > MISMATCH_NOTIFY_COOLDOWN_MS) {
        watchState.lastMismatchNotifiedAt = now;
        notify('Character Mismatch', "You're character classes don't match your rolled character, please log into the correct character, or reroll!", 'error');
        realtimeDebugLog('WHO — class mismatch. expected=' + expected.join('/') + ' reported=' + reported.join('/'));
      }
      // Don't push a level correction for a character that isn't the
      // rolled one — that would corrupt the leaderboard with the wrong
      // character's progress.
      return;
    }
  }

  // Classes check out (or we have nothing to compare against) — use the
  // authoritative level from /who to correct the leaderboard if it's
  // behind. syncSharedState only writes when something actually differs.
  if (Number.isFinite(level) && level > 0) {
    // /who is authoritative — it reports what the game itself says, so
    // it corrects a stale HIGH value just as readily as a low one.
    if (watchState.currentLevel !== level) {
      watchState.currentLevel = level;
      sendToRenderer('level-update', level);
    }
    syncSharedState(true);
  }
}

function processLogLine(line) {
  // ANY in-game activity is a chance to notice and repair a stale shared
  // view (a cleared log, or level-ups missed while the app was closed).
  // Throttled internally, and a no-op when nothing actually needs fixing.
  syncSharedState(false);

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

  if (/\bentered\b/i.test(line)) {
    realtimeDebugLog('ZONE — line contains "entered": ' + JSON.stringify(line));
  }
  const whoMatch = line.match(WHO_LINE_RE);
  if (whoMatch) {
    handleWhoLine(parseInt(whoMatch[1], 10), whoMatch[2], whoMatch[3]);
    return;
  }

  const zoneMatch = line.match(ZONE_ENTER_RE);
  if (zoneMatch) {
    var zoneName = zoneMatch[1].trim();
    realtimeDebugLog('ZONE — regex matched, zone="' + zoneName + '" characterActive=' + watchState.characterActive + ' characterD4=' + watchState.characterD4);
    if (watchState.characterActive && watchState.characterD4) {
      // "(Refined)" in the zone name means it's already a D4 zone — no
      // need to remind someone to do something they've already done.
      if (zoneName.indexOf('(Refined)') === -1) {
        // Purely local — a reminder for the person playing, not a group
        // event, so this never touches the backend or broadcasts to anyone.
        notify('D4 Reminder', "Don't forget to change to D4 difficulty!", 'info');
        realtimeDebugLog('ZONE — D4 reminder notification fired');
      } else {
        realtimeDebugLog('ZONE — skipped, zone already (Refined)');
      }
    }
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
    watchState.characterRolledAt = null;
    watchState.characterClasses = null;
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
    // Announce ourselves so the room broadcasts an updated presence
    // roster that includes us.
    try { ws.send(JSON.stringify({ type: 'hello' })); } catch (e) { /* ignore */ }
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

    if (msg && msg.type === 'presence') {
      lastPresence = msg.users || [];
      sendToChatWindows('chat-presence', lastPresence);
      return;
    }

    if (msg && msg.type === 'chat') {
      recordChat({ from: msg.from, text: msg.text, time: msg.time, color: msg.color });
      sendToChatWindows('chat-message', msg);
      return;
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
    // Without a connection we can't know who's online — show nobody
    // rather than a stale list.
    lastPresence = [];
    sendToChatWindows('chat-presence', []);
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
        if (entry.silent) return; // a leaderboard/log correction, not a live event worth announcing
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
  // If the notify window already exists, move it now rather than making
  // the user restart the app to see a position change take effect.
  if (notifyWindow && !notifyWindow.isDestroyed()) {
    try {
      var bounds = notifyWindow.getBounds();
      var wa = screen.getPrimaryDisplay().workArea;
      var c = computeNotifyPosition(merged.notificationPosition, wa, bounds.width, bounds.height);
      notifyWindow.setPosition(c.x, c.y);
    } catch (e) { /* non-critical — it'll be correct next time the window is created */ }
  }
  return merged;
});

ipcMain.handle('send-chat', function (event, text) {
  if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) return { ok: false, error: 'Not connected' };
  try {
    // The worker validates this against its own palette, so an unknown
    // value just falls back to the default rather than being trusted.
    var color = loadSettings().chatColor || null;
    realtimeSocket.send(JSON.stringify({ type: 'chat', text: String(text || '').slice(0, 500), color: color }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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

ipcMain.handle('character-rolled', function (event, payload) {
  // A fresh character starts over — clear any level tracked from a
  // previous (now-resolved) character so a death before the first
  // real level-up line doesn't misreport an old level. Also (re)arm the
  // death/ding guard so this new character's first death gets reported.
  // A brand-new character starts at 1 — not "unknown", which previously
  // let a stale value from the last character survive.
  watchState.currentLevel = 1;
  watchState.characterActive = true;
  watchState.characterD4 = !!(payload && payload.d4);
  watchState.characterClasses = (payload && payload.classes) || null;
  watchState.characterRolledAt = (payload && payload.rolledAt) || new Date().toISOString();
  watchState.lastMismatchNotifiedAt = 0;
  sendToRenderer('level-update', 1);
});

ipcMain.handle('character-locked-sync', function (event, payload) {
  // Used only at app startup to inform main that a character was ALREADY
  // locked from a previous session (not a fresh roll just now) — arms the
  // guard without touching currentLevel, since that's separately recovered
  // from log history.
  watchState.characterActive = true;
  watchState.characterD4 = !!(payload && payload.d4);
  watchState.characterClasses = (payload && payload.classes) || null;
  watchState.characterRolledAt = (payload && payload.rolledAt) || null;
  // The app may have been closed while they played — give the log
  // watcher a moment to recover the current level from history, then
  // push a catch-up sync so the leaderboard reflects reality.
  setTimeout(function () { syncSharedState(true); }, 8000);
});

ipcMain.handle('character-unlocked', function () {
  // A character was resolved via the manual I Died / Ding! / Roll Again
  // buttons in the renderer — main.js wouldn't otherwise know about that,
  // so keep the guard in sync to prevent any stray auto-detected death
  // line for the now-resolved character from firing another notification.
  watchState.characterActive = false;
  watchState.characterD4 = false;
  watchState.characterClasses = null;
  watchState.characterRolledAt = null;
  // Clear the level too — a resolved character's level must not carry
  // over to whatever gets rolled next.
  watchState.currentLevel = null;
  sendToRenderer('level-update', null);
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
  // (isSilent, isForceRunAfter) — installs without the next/finish
  // wizard and relaunches the app automatically once done. This only
  // works alongside "oneClick": true in the nsis build config; with the
  // assisted installer, a silent install completes but the app won't
  // relaunch on its own.
  autoUpdater.quitAndInstall(true, true);
});

// ---- Window & tray ----

var DEFAULT_WINDOW = { width: 1150, height: 820 };

// Returns saved window bounds only if they'd still be visible. A window
// restored onto a monitor that's since been unplugged (or a resolution
// that shrank) would otherwise open off-screen and look like the app
// failed to launch, with no obvious way to recover it.
function resolveSavedBounds() {
  var s = loadSettings();
  var b = s.windowBounds;
  if (!b || typeof b.width !== 'number' || typeof b.height !== 'number') return null;

  var result = {
    width: Math.max(1050, Math.round(b.width)),
    height: Math.max(600, Math.round(b.height))
  };

  if (typeof b.x === 'number' && typeof b.y === 'number') {
    // Keep the saved position only if a meaningful part of the window
    // would land inside some currently-connected display.
    var displays = screen.getAllDisplays();
    var visible = displays.some(function (d) {
      var wa = d.workArea;
      var overlapX = Math.min(b.x + result.width, wa.x + wa.width) - Math.max(b.x, wa.x);
      var overlapY = Math.min(b.y + result.height, wa.y + wa.height) - Math.max(b.y, wa.y);
      return overlapX > 120 && overlapY > 60;
    });
    if (visible) {
      result.x = Math.round(b.x);
      result.y = Math.round(b.y);
    }
  }
  return result;
}

var saveBoundsTimer = null;
function scheduleSaveBounds() {
  // Dragging/resizing fires continuously — debounce so we're not
  // rewriting the settings file dozens of times per second.
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 500);
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    var isMax = mainWindow.isMaximized();
    // getNormalBounds() gives the pre-maximize size, so un-maximizing
    // later restores something sensible rather than a full-screen box.
    var b = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    var merged = Object.assign({}, loadSettings(), {
      windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      windowMaximized: isMax
    });
    saveSettingsToDisk(merged);
  } catch (e) { /* non-critical */ }
}

// ---- Chat overlay window ----
//
// Deliberately the opposite of the notification overlay: that one is
// unfocusable and click-through so it never steals input from the game.
// This one must accept typing, so it takes focus when clicked. Kept
// frameless + transparent with a custom drag bar so it reads as an
// overlay rather than a second app window.
function createChatOverlay() {
  if (chatOverlayWindow && !chatOverlayWindow.isDestroyed()) return chatOverlayWindow;

  var s = loadSettings();
  var b = s.chatOverlayBounds || {};
  var wa = screen.getPrimaryDisplay().workArea;

  var width = Math.max(280, Math.round(b.width || 380));
  var height = Math.max(200, Math.round(b.height || 420));
  var x = typeof b.x === 'number' ? b.x : (wa.x + wa.width - width - 30);
  var y = typeof b.y === 'number' ? b.y : (wa.y + 80);

  // Guard against a saved position on a monitor that's since gone away.
  var onScreen = screen.getAllDisplays().some(function (d) {
    var a = d.workArea;
    return (Math.min(x + width, a.x + a.width) - Math.max(x, a.x)) > 100 &&
           (Math.min(y + height, a.y + a.height) - Math.max(y, a.y)) > 50;
  });
  if (!onScreen) { x = wa.x + wa.width - width - 30; y = wa.y + 80; }

  chatOverlayWindow = new BrowserWindow({
    width: width, height: height, x: x, y: y,
    minWidth: 260, minHeight: 180,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'chat-overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 'screen-saver' is the highest level Electron exposes on Windows —
  // needed to sit above a game running borderless-fullscreen.
  chatOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  var savedOpacity = typeof s.chatOverlayOpacity === 'number' ? s.chatOverlayOpacity : 0.9;
  chatOverlayWindow.setOpacity(Math.max(0.2, Math.min(1, savedOpacity)));
  chatOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  chatOverlayWindow.loadFile(path.join(__dirname, 'renderer', 'chat-overlay.html'));

  chatOverlayWindow.once('ready-to-show', function () {
    chatOverlayWindow.show();
    // Seed it with what's already happened so it isn't blank.
    chatOverlayWindow.webContents.send('chat-history', {
      messages: chatHistory,
      users: lastPresence,
      username: loadSettings().username || '',
      chatColor: loadSettings().chatColor || '#2A2016'
    });
  });

  var saveOverlayTimer = null;
  function saveOverlayBounds() {
    if (!chatOverlayWindow || chatOverlayWindow.isDestroyed()) return;
    try {
      var nb = chatOverlayWindow.getBounds();
      saveSettingsToDisk(Object.assign({}, loadSettings(), { chatOverlayBounds: nb }));
    } catch (e) { /* non-critical */ }
  }
  function scheduleOverlaySave() {
    clearTimeout(saveOverlayTimer);
    saveOverlayTimer = setTimeout(saveOverlayBounds, 500);
  }
  chatOverlayWindow.on('resize', scheduleOverlaySave);
  chatOverlayWindow.on('move', scheduleOverlaySave);
  chatOverlayWindow.on('close', function () { clearTimeout(saveOverlayTimer); saveOverlayBounds(); });
  chatOverlayWindow.on('closed', function () { chatOverlayWindow = null; sendToRenderer('chat-overlay-state', false); });

  return chatOverlayWindow;
}

function closeChatOverlay() {
  if (chatOverlayWindow && !chatOverlayWindow.isDestroyed()) chatOverlayWindow.close();
  chatOverlayWindow = null;
}

ipcMain.handle('toggle-chat-overlay', function () {
  var open = !!(chatOverlayWindow && !chatOverlayWindow.isDestroyed());
  if (open) { closeChatOverlay(); return { open: false }; }
  createChatOverlay();
  return { open: true };
});

ipcMain.handle('close-chat-overlay', function () {
  closeChatOverlay();
  sendToRenderer('chat-overlay-state', false);
  return { open: false };
});

ipcMain.handle('set-chat-overlay-opacity', function (event, value) {
  // Clamped so nobody can slide the overlay to fully invisible and then
  // be unable to find it again.
  var v = Math.max(0.2, Math.min(1, Number(value) || 1));
  saveSettingsToDisk(Object.assign({}, loadSettings(), { chatOverlayOpacity: v }));
  if (chatOverlayWindow && !chatOverlayWindow.isDestroyed()) chatOverlayWindow.setOpacity(v);
  return { opacity: v };
});

ipcMain.handle('get-chat-overlay-state', function () {
  return { open: !!(chatOverlayWindow && !chatOverlayWindow.isDestroyed()) };
});

function createWindow() {
  var saved = resolveSavedBounds();
  var opts = {
    width: (saved && saved.width) || DEFAULT_WINDOW.width,
    height: (saved && saved.height) || DEFAULT_WINDOW.height,
    minWidth: 1050,
    minHeight: 600,
    title: 'EQ Legends Randomizer v' + app.getVersion(),
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };
  if (saved && typeof saved.x === 'number') { opts.x = saved.x; opts.y = saved.y; }

  mainWindow = new BrowserWindow(opts);

  if (loadSettings().windowMaximized) mainWindow.maximize();

  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('maximize', scheduleSaveBounds);
  mainWindow.on('unmaximize', scheduleSaveBounds);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Electron normally syncs the window title to the page's <title> tag once
  // it loads, which would silently overwrite the version number we just set.
  mainWindow.on('page-title-updated', function (event) {
    event.preventDefault();
  });

  mainWindow.on('close', function (e) {
    clearTimeout(saveBoundsTimer);
    saveWindowBounds(); // capture the final size/position before it's gone
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
  closeChatOverlay();
});

} // end runApp()
