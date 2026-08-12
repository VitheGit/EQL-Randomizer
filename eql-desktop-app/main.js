const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let notifyWindow = null;

// ---- Settings persistence ----

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
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
    const win = getNotifyWindow();
    const send = function () {
      win.webContents.send('show-toast', { title: title, body: body, kind: kind || 'info' });
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

// ---- Log file watching (polling-based tail) ----

const LEVEL_UP_RE = /\]\s*You have gained a level! Welcome to level (\d+)!/;
// The game refers to your OWN death in first person ("You"), not by your
// character's name — third-person "X has been slain by Y!" is what shows
// for other people's deaths, which this app doesn't need to detect from
// the log at all (that comes from polling the shared server data instead).
const SELF_DEATH_RE = /\]\s*You have been slain by (.+?)!/;

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
  }
}

// ---- Shared log polling (for OTHER players' death/ding announcements) ----

var lastSeenLogLength = null;

async function pollSharedLog() {
  const s = loadSettings();
  if (!s.apiBaseUrl) return;
  try {
    const res = await fetch(s.apiBaseUrl.replace(/\/$/, '') + '/api/kv?key=log');
    const data = await res.json().catch(function () { return null; });
    if (!data || typeof data.value !== 'string') return;
    const log = JSON.parse(data.value);

    if (lastSeenLogLength === null) {
      // First check after launch — don't fire notifications for the
      // entire pre-existing history, just start tracking from here.
      lastSeenLogLength = log.length;
      sendToRenderer('log-updated', log);
      return;
    }

    if (log.length > lastSeenLogLength) {
      const newEntries = log.slice(lastSeenLogLength);
      newEntries.forEach(function (entry) {
        if (entry.name === s.username) return; // already notified locally via the log watcher
        if (entry.type === 'died') {
          notify('Death Announcement', entry.name + ' died at level ' + (entry.level || '?') + '.', 'death');
        } else if (entry.type === 'ding') {
          notify('Level 50!', entry.name + ' reached level 50!', 'ding');
        }
      });
      sendToRenderer('log-updated', log);
    }
    lastSeenLogLength = log.length;
  } catch (e) {
    // Transient network errors are expected occasionally; ignore quietly.
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
  return merged;
});

ipcMain.handle('show-notification', function (event, payload) {
  notify((payload && payload.title) || 'EQ Legends Randomizer', (payload && payload.body) || '');
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

// ---- Window & tray ----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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
  setInterval(pollSharedLog, 5000);

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
});
