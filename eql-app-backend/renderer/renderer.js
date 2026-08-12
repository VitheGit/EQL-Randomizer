(function () {
  var root = document.getElementById('app');

  var state = {
    screen: 'loading', // 'loading' | 'auth' | 'app'

    apiBaseUrl: '',
    token: null,
    username: '',

    authMode: 'login', // 'login' | 'register'
    authUsername: '',
    authPassword: '',
    authApiUrl: '',
    authError: '',
    authBusy: false,

    primary: null, secondary: null, tertiary: null, race: null,
    fellBack: false, hardcore: false, hasPath: false, levelingPath: null,
    locked: false, rolling: false, resolving: false,
    hardcoreMode: true, pathToggle: false,

    confirmingDeath: false, deathLevel: '',

    log: [], leaderboard: [],

    settingsLogFilePath: '', settingsCharacterName: '',
    watching: false, currentDetectedLevel: null, settingsSaved: false,

    confirmingClear: null, clearInput: '', clearError: '', clearBusy: false,

    view: 'randomizer' // 'randomizer' | 'settings'
  };

  // ---- Helpers ----

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatStamp(date) {
    var d = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    var t = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d + ' · ' + t;
  }

  function formatDuration(ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return '—';
    var s = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var parts = [];
    if (h) parts.push(h + 'h');
    if (h || m) parts.push(m + 'm');
    parts.push(sec + 's');
    return parts.join(' ');
  }

  async function apiRequest(path, options) {
    options = options || {};
    var headers = options.headers || {};
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    if (options.body) headers['Content-Type'] = 'application/json';
    try {
      var res = await fetch(state.apiBaseUrl.replace(/\/$/, '') + path, {
        method: options.method || 'GET',
        headers: headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      var data = null;
      try { data = await res.json(); } catch (e) { /* ignore */ }
      return { ok: res.ok, status: res.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, data: null, networkError: true };
    }
  }

  // ---- Leaderboard computation (mirrors the website's logic) ----

  function computeRuns(log) {
    var byName = {};
    log.slice().sort(function (a, b) { return new Date(a.time) - new Date(b.time); }).forEach(function (e) {
      var n = e.name || 'Unknown';
      if (!byName[n]) byName[n] = { lastRollTime: null, runs: [] };
      if (e.type === 'roll') {
        byName[n].lastRollTime = e.time;
      } else if (e.type === 'died' || e.type === 'ding') {
        var level = e.type === 'ding' ? 50 : (Number(e.level) || 0);
        var duration = byName[n].lastRollTime ? (new Date(e.time) - new Date(byName[n].lastRollTime)) : null;
        byName[n].runs.push({
          level: level, duration: duration, time: e.time, type: e.type,
          race: e.race, primary: e.primary, secondary: e.secondary, tertiary: e.tertiary,
          hardcore: !!e.hardcore, pathMode: !!e.pathMode,
          killedBy: e.killedBy || null, manual: !!e.manual
        });
        byName[n].lastRollTime = null;
      } else if (e.type === 'retired') {
        byName[n].lastRollTime = null;
      }
    });
    return byName;
  }

  function computeLeaderboard(log) {
    var byName = computeRuns(log);
    var rows = [];
    Object.keys(byName).forEach(function (name) {
      byName[name].runs.forEach(function (run) {
        if (!run.hardcore) return;
        rows.push({
          name: name, level: run.level, duration: run.duration, race: run.race,
          primary: run.primary, secondary: run.secondary, tertiary: run.tertiary,
          type: run.type, pathMode: run.pathMode, killedBy: run.killedBy, manual: run.manual
        });
      });
    });
    rows.sort(function (a, b) {
      if (b.level !== a.level) return b.level - a.level;
      var ad = a.duration == null ? Infinity : a.duration;
      var bd = b.duration == null ? Infinity : b.duration;
      return ad - bd;
    });
    return rows;
  }

  function refreshLeaderboardFromLog() {
    state.leaderboard = computeLeaderboard(state.log);
  }

  async function refreshSharedData() {
    var res = await apiRequest('/api/kv?key=log');
    if (res.ok && res.data && typeof res.data.value === 'string') {
      try { state.log = JSON.parse(res.data.value); } catch (e) { state.log = []; }
    }
    refreshLeaderboardFromLog();
  }

  // ---- Character state ----

  function applyCharacterFromServer(character) {
    if (character && character.locked) {
      state.primary = character.primary;
      state.secondary = character.secondary;
      state.tertiary = character.tertiary;
      state.race = character.race;
      state.fellBack = !!character.fellBack;
      state.hardcore = !!character.hardcore;
      state.hasPath = !!character.pathMode;
      state.levelingPath = character.path || null;
      state.locked = true;
    } else {
      state.primary = null;
      state.secondary = null;
      state.tertiary = null;
      state.race = null;
      state.fellBack = false;
      state.hardcore = false;
      state.hasPath = false;
      state.levelingPath = null;
      state.locked = false;
    }
  }

  // ---- Render ----

  function renderLogRow(entry) {
    var stamp = formatStamp(new Date(entry.time));
    var who = escapeHtml(entry.name || 'Unknown');
    var pathTag = entry.pathMode ? ' <span style="opacity:0.7">&#128506;</span>' : '';
    var manualTag = entry.manual ? ' <span style="font-size:10px;font-style:italic;opacity:0.65">(manual)</span>' : '';
    var killedByTag = (entry.type === 'died' && entry.killedBy) ? ' <span style="opacity:0.75">— killed by ' + escapeHtml(entry.killedBy) + '</span>' : '';
    var text;
    if (entry.type === 'roll') text = '<strong>' + who + ' randomized:</strong> ' + escapeHtml(entry.race) + ' ' + escapeHtml(entry.primary) + pathTag;
    else if (entry.type === 'ding') text = '<strong>&#127881; ' + who + ' hit Level 50!</strong>' + pathTag + manualTag;
    else if (entry.type === 'retired') text = '<strong>' + who + ' retired (casual)</strong>' + pathTag;
    else text = '<strong>' + who + ' died' + (entry.level ? ' at level ' + escapeHtml(entry.level) : '') + '</strong>' + killedByTag + pathTag + manualTag;
    return '<div class="log-row"><span class="log-stamp">' + stamp + '</span><span class="log-text">' + text + '</span></div>';
  }

  function renderLbRow(row, rank) {
    var medal = rank === 1 ? '&#129351; ' : rank === 2 ? '&#129352; ' : rank === 3 ? '&#129353; ' : '';
    var icon = row.type === 'ding' ? '&#127881; ' : '&#128128; ';
    var pathIcon = row.pathMode ? '&#128506; ' : '';
    var manualTag = row.manual ? ' <span style="font-size:10px;font-style:italic;opacity:0.65">(manual)</span>' : '';
    var killedByTag = (row.type === 'died' && row.killedBy) ? ' · killed by ' + escapeHtml(row.killedBy) : '';
    var classes = (row.secondary && row.tertiary) ? (row.primary + ' / ' + row.secondary + ' / ' + row.tertiary) : row.primary;
    return (
      '<div class="lb-row">' +
        '<span class="lb-rank">' + medal + '#' + rank + '</span>' +
        '<span class="lb-name">' + escapeHtml(row.name) + ' <span style="font-weight:400;font-style:italic;color:var(--ink-soft)">(' + escapeHtml(row.race) + ')</span></span>' +
        '<span class="lb-level">' + icon + pathIcon + 'Lvl ' + row.level + manualTag + '</span>' +
        '<span class="lb-build">' + escapeHtml(classes) + ' · ' + formatDuration(row.duration) + killedByTag + '</span>' +
      '</div>'
    );
  }

  function render() {
    if (state.screen === 'loading') {
      root.innerHTML = '<div class="header"><p class="subtitle">Loading…</p></div>';
      return;
    }

    if (state.screen === 'auth') {
      renderAuthScreen();
      return;
    }

    renderAppScreen();
  }

  function renderAuthScreen() {
    var isRegister = state.authMode === 'register';
    root.innerHTML =
      '<div class="header">' +
        '<img src="../build/icon.png" alt="EQ Legends Randomizer" />' +
        '<p class="subtitle">Character Randomizer</p>' +
      '</div>' +
      '<div class="card" style="max-width:380px;margin:0 auto;">' +
        '<div class="field">' +
          '<label class="field-label">Server URL</label>' +
          '<input type="text" id="in-api-url" placeholder="https://your-backend.pages.dev" value="' + escapeHtml(state.authApiUrl) + '" />' +
        '</div>' +
        '<div class="auth-tabs">' +
          '<button class="auth-tab' + (!isRegister ? ' active' : '') + '" id="tab-login" type="button">Log In</button>' +
          '<button class="auth-tab' + (isRegister ? ' active' : '') + '" id="tab-register" type="button">Create Account</button>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">Username</label>' +
          '<input type="text" id="in-username" value="' + escapeHtml(state.authUsername) + '" />' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">Password</label>' +
          '<input type="password" id="in-password" value="' + escapeHtml(state.authPassword) + '" />' +
        '</div>' +
        (state.authError ? '<p class="error-text">' + escapeHtml(state.authError) + '</p>' : '') +
        '<button class="btn btn-primary btn-full" id="btn-auth-submit"' + (state.authBusy ? ' disabled' : '') + '>' +
          (state.authBusy ? 'Please wait…' : (isRegister ? 'Create Account' : 'Log In')) +
        '</button>' +
      '</div>';

    document.getElementById('tab-login').addEventListener('click', function () { state.authMode = 'login'; state.authError = ''; render(); });
    document.getElementById('tab-register').addEventListener('click', function () { state.authMode = 'register'; state.authError = ''; render(); });
    document.getElementById('in-api-url').addEventListener('input', function (e) { state.authApiUrl = e.target.value; });
    document.getElementById('in-username').addEventListener('input', function (e) { state.authUsername = e.target.value; });
    document.getElementById('in-password').addEventListener('input', function (e) { state.authPassword = e.target.value; });
    document.getElementById('btn-auth-submit').addEventListener('click', function () {
      if (state.authMode === 'register') doRegister(); else doLogin();
    });
  }

  function renderAppScreen() {
    var html = '';
    html += '<div class="header">' +
      '<img src="../build/icon.png" alt="EQ Legends Randomizer" />' +
      '<p class="subtitle">Character Randomizer</p>' +
    '</div>';

    html += '<div class="user-bar"><span>Logged in as <strong>' + escapeHtml(state.username) + '</strong></span>' +
      '<button id="btn-logout">Log out</button>' +
      '<span style="opacity:0.5">|</span>' +
      '<button id="tab-view-randomizer">Randomizer</button>' +
      '<button id="tab-view-settings">Settings</button>' +
    '</div>';

    if (state.view === 'settings') {
      html += renderSettingsView();
    } else {
      html += renderRandomizerView();
    }

    root.innerHTML = html;
    bindAppEvents();
  }

  function renderRandomizerView() {
    var html = '';

    html += '<div class="card">' +
      '<p class="result-label">Your Character</p>' +
      '<p class="primary-line">' + (state.primary || '???') + '</p>' +
      '<p class="arrow">&#8595;</p>' +
      '<p class="race-line">' + (state.race || '???') + '</p>' +
      '<p class="race-tag">' + (state.primary ? 'Race, eligible for ' + state.primary : 'Race') + '</p>' +
      '<div class="trio">' +
        '<div class="class-slot is-primary"><span class="n">Primary</span>' + (state.primary || '???') + '</div>' +
        '<div class="class-slot"><span class="n">Secondary</span>' + (state.secondary || '???') + '</div>' +
        '<div class="class-slot"><span class="n">Tertiary</span>' + (state.tertiary || '???') + '</div>' +
      '</div>' +
      (!state.primary
        ? '<p class="note">Click Randomize! to draw your character.</p>'
        : state.locked && !state.confirmingDeath
          ? '<p class="note warn">' + (state.hardcore ? 'Locked in — eligible for the leaderboard. Deaths/level 50 are detected automatically from your log file.' : 'Casual character. Click "Roll Again" whenever you\'re ready.') + '</p>'
          : '') +
    '</div>';

    if (state.locked && state.confirmingDeath) {
      html += '<div class="card" style="max-width:320px;margin:0 auto 16px;">' +
        '<label class="field-label">Level at Death</label>' +
        '<select id="in-death-level">' +
          '<option value="" disabled' + (state.deathLevel ? '' : ' selected') + '>Select level</option>' +
          Array.from({ length: 50 }, function (_, i) { return i + 1; }).map(function (lvl) {
            return '<option value="' + lvl + '"' + (String(lvl) === String(state.deathLevel) ? ' selected' : '') + '>' + lvl + '</option>';
          }).join('') +
        '</select>' +
        '<div class="actions">' +
          '<button class="btn btn-died" id="btn-confirm-death"' + (state.resolving ? ' disabled' : '') + '>Confirm Death</button>' +
          '<button class="btn btn-ghost" id="btn-cancel-death">Cancel</button>' +
        '</div>' +
      '</div>';
    }

    html += '<div class="actions">' +
      (state.locked
        ? (state.confirmingDeath ? ''
            : state.hardcore
              ? '<button class="btn btn-died" id="btn-died"' + (state.resolving ? ' disabled' : '') + '>I Died (manual)</button>' +
                '<button class="btn btn-ding" id="btn-ding"' + (state.resolving ? ' disabled' : '') + '>Ding! Level 50! (manual)</button>'
              : '<button class="btn btn-primary" id="btn-roll-again"' + (state.resolving ? ' disabled' : '') + '>Roll Again</button>')
        : '<button class="btn btn-primary" id="btn-roll"' + (state.rolling ? ' disabled' : '') + '>' + (state.rolling ? 'Randomizing…' : 'Randomize!') + '</button>') +
    '</div>';

    if (!state.locked) {
      html += '<div class="toggles-row">' +
        '<label class="toggle"><input type="checkbox" id="in-hardcore"' + (state.hardcoreMode ? ' checked' : '') + ' /> Hardcore</label>' +
        '<label class="toggle"><input type="checkbox" id="in-path"' + (state.pathToggle ? ' checked' : '') + ' /> Random Leveling Path</label>' +
      '</div>' +
      '<p class="hint">* Only Hardcore characters are eligible for the leaderboard.</p>';
    } else if (state.hasPath && state.levelingPath) {
      html += '<div class="card"><h3>Leveling Path</h3><ul class="path-list">' +
        state.levelingPath.map(function (b) {
          return '<li><span class="path-range">' + escapeHtml(b.range) + '</span><span>' + escapeHtml(b.zone || b.note || 'Anywhere') + '</span></li>';
        }).join('') +
      '</ul></div>';
    }

    var watchBadge = state.watching
      ? '<span class="status-pill on">&#128065; Watching log file' + (state.currentDetectedLevel ? ' · detected level ' + state.currentDetectedLevel : '') + '</span>'
      : '<span class="status-pill off">&#9888; Not watching a log file — set one up in Settings</span>';
    html += '<div style="text-align:center;margin-bottom:16px;">' + watchBadge + '</div>';

    html += '<div class="card"><h3>Leaderboard</h3><div class="list-scroll">' +
      (state.leaderboard.length === 0
        ? '<p class="empty-text">No completed Hardcore runs yet.</p>'
        : state.leaderboard.map(function (row, i) { return renderLbRow(row, i + 1); }).join('')) +
    '</div></div>';

    html += '<div class="card"><h3>Adventure Log</h3><div class="list-scroll">' +
      (state.log.length === 0
        ? '<p class="empty-text">No entries yet.</p>'
        : state.log.slice().reverse().slice(0, 50).map(renderLogRow).join('')) +
    '</div></div>';

    return html;
  }

  function renderSettingsView() {
    return (
      '<div class="card">' +
        '<h3>Log File Watching</h3>' +
        '<div class="field">' +
          '<label class="field-label">EQ Legends Log File</label>' +
          '<div style="display:flex;gap:8px;">' +
            '<input type="text" id="in-log-path" readonly value="' + escapeHtml(state.settingsLogFilePath) + '" placeholder="No file selected" style="flex:1" />' +
            '<button class="btn btn-ghost" id="btn-browse-log" type="button">Browse…</button>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">Your In-Game Character Name</label>' +
          '<input type="text" id="in-char-name" value="' + escapeHtml(state.settingsCharacterName) + '" placeholder="e.g. Vithe" />' +
        '</div>' +
        '<p class="hint">This is auto-suggested from the log file name, but double-check it matches your character\'s exact name.</p>' +
        '<button class="btn btn-primary btn-full" id="btn-save-settings" style="margin-top:10px;">' + (state.settingsSaved ? 'Saved ✓' : 'Save Settings') + '</button>' +
        '<div style="text-align:center;margin-top:12px;">' +
          (state.watching
            ? '<span class="status-pill on">&#128065; Currently watching</span>'
            : '<span class="status-pill off">Not watching yet</span>') +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h3>Server</h3>' +
        '<p class="hint">Connected to: ' + escapeHtml(state.apiBaseUrl) + '</p>' +
      '</div>' +
      '<div class="card">' +
        '<h3>Admin</h3>' +
        '<p class="hint">Clearing either of these affects everyone using this backend, not just you.</p>' +
        (!state.confirmingClear
          ? '<div class="actions">' +
              '<button class="btn btn-ghost" id="btn-clear-log" type="button">Clear Log for Everyone</button>' +
              '<button class="btn btn-ghost" id="btn-clear-lb" type="button">Clear Leaderboard for Everyone</button>' +
            '</div>'
          : '<div class="field">' +
              '<label class="field-label">Enter Passcode to Clear the ' + (state.confirmingClear === 'log' ? 'Log' : 'Leaderboard') + ' for Everyone</label>' +
              '<input type="password" id="in-clear-passcode" value="' + escapeHtml(state.clearInput) + '" autocomplete="off"' + (state.clearBusy ? ' disabled' : '') + ' />' +
              (state.clearError ? '<p class="error-text">' + escapeHtml(state.clearError) + '</p>' : '') +
              '<div class="actions">' +
                '<button class="btn btn-died" id="btn-confirm-clear"' + (state.clearBusy ? ' disabled' : '') + '>' + (state.clearBusy ? 'Checking…' : 'Confirm Clear') + '</button>' +
                '<button class="btn btn-ghost" id="btn-cancel-clear"' + (state.clearBusy ? ' disabled' : '') + '>Cancel</button>' +
              '</div>' +
            '</div>') +
      '</div>'
    );
  }

  function bindAppEvents() {
    var logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

    var tabRandomizer = document.getElementById('tab-view-randomizer');
    if (tabRandomizer) tabRandomizer.addEventListener('click', function () { state.view = 'randomizer'; render(); });
    var tabSettings = document.getElementById('tab-view-settings');
    if (tabSettings) tabSettings.addEventListener('click', function () { state.view = 'settings'; state.settingsSaved = false; render(); });

    var rollBtn = document.getElementById('btn-roll');
    if (rollBtn) rollBtn.addEventListener('click', handleRoll);
    var hcCheckbox = document.getElementById('in-hardcore');
    if (hcCheckbox) hcCheckbox.addEventListener('change', function (e) { state.hardcoreMode = e.target.checked; });
    var pathCheckbox = document.getElementById('in-path');
    if (pathCheckbox) pathCheckbox.addEventListener('change', function (e) { state.pathToggle = e.target.checked; });

    var diedBtn = document.getElementById('btn-died');
    if (diedBtn) diedBtn.addEventListener('click', function () { state.confirmingDeath = true; state.deathLevel = ''; render(); });
    var dingBtn = document.getElementById('btn-ding');
    if (dingBtn) dingBtn.addEventListener('click', handleDing);
    var rollAgainBtn = document.getElementById('btn-roll-again');
    if (rollAgainBtn) rollAgainBtn.addEventListener('click', handleRollAgain);

    var deathLevelSel = document.getElementById('in-death-level');
    if (deathLevelSel) deathLevelSel.addEventListener('change', function (e) { state.deathLevel = e.target.value; });
    var confirmDeathBtn = document.getElementById('btn-confirm-death');
    if (confirmDeathBtn) confirmDeathBtn.addEventListener('click', handleConfirmDeath);
    var cancelDeathBtn = document.getElementById('btn-cancel-death');
    if (cancelDeathBtn) cancelDeathBtn.addEventListener('click', function () { state.confirmingDeath = false; render(); });

    var browseBtn = document.getElementById('btn-browse-log');
    if (browseBtn) browseBtn.addEventListener('click', handleBrowseLog);
    var charNameInput = document.getElementById('in-char-name');
    if (charNameInput) charNameInput.addEventListener('input', function (e) { state.settingsCharacterName = e.target.value; state.settingsSaved = false; });
    var saveSettingsBtn = document.getElementById('btn-save-settings');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', handleSaveSettings);

    var clearLogBtn = document.getElementById('btn-clear-log');
    if (clearLogBtn) clearLogBtn.addEventListener('click', function () { handleClearClick('log'); });
    var clearLbBtn = document.getElementById('btn-clear-lb');
    if (clearLbBtn) clearLbBtn.addEventListener('click', function () { handleClearClick('leaderboard'); });
    var clearPasscodeInput = document.getElementById('in-clear-passcode');
    if (clearPasscodeInput) {
      clearPasscodeInput.addEventListener('input', function (e) { state.clearInput = e.target.value; });
      clearPasscodeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleConfirmClear(); });
      clearPasscodeInput.focus();
    }
    var confirmClearBtn = document.getElementById('btn-confirm-clear');
    if (confirmClearBtn) confirmClearBtn.addEventListener('click', handleConfirmClear);
    var cancelClearBtn = document.getElementById('btn-cancel-clear');
    if (cancelClearBtn) cancelClearBtn.addEventListener('click', function () { state.confirmingClear = null; state.clearInput = ''; state.clearError = ''; render(); });
  }

  // ---- Auth actions ----

  async function doLogin() {
    if (state.authBusy) return;
    var apiUrl = state.authApiUrl.trim();
    if (!apiUrl) { state.authError = 'Enter the server URL first.'; render(); return; }
    state.apiBaseUrl = apiUrl;
    state.authBusy = true; state.authError = ''; render();
    var res = await apiRequest('/api/auth/login', { method: 'POST', body: { username: state.authUsername.trim(), password: state.authPassword } });
    state.authBusy = false;
    if (!res.ok) {
      state.authError = (res.data && res.data.error) || 'Incorrect username or password.';
      render();
      return;
    }
    await finishLogin(res.data);
  }

  async function doRegister() {
    if (state.authBusy) return;
    var apiUrl = state.authApiUrl.trim();
    if (!apiUrl) { state.authError = 'Enter the server URL first.'; render(); return; }
    state.apiBaseUrl = apiUrl;
    state.authBusy = true; state.authError = ''; render();
    var res = await apiRequest('/api/auth/register', { method: 'POST', body: { username: state.authUsername.trim(), password: state.authPassword } });
    state.authBusy = false;
    if (!res.ok) {
      state.authError = (res.data && res.data.error) || 'Something went wrong.';
      render();
      return;
    }
    await finishLogin(res.data);
  }

  async function finishLogin(data) {
    state.token = data.token;
    state.username = data.username;
    applyCharacterFromServer(data.currentCharacter);
    state.screen = 'app';

    var settings = await window.eqlApp.saveSettings({
      apiBaseUrl: state.apiBaseUrl,
      token: state.token,
      username: state.username
    });
    state.settingsLogFilePath = settings.logFilePath || '';
    state.settingsCharacterName = settings.characterName || guessCharacterName(settings.logFilePath);

    await refreshSharedData();
    render();

    var status = await window.eqlApp.getWatchStatus();
    state.watching = status.watching;
    render();
  }

  async function doLogout() {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    state.token = null;
    state.username = '';
    applyCharacterFromServer(null);
    await window.eqlApp.saveSettings({ token: null, username: '' });
    state.screen = 'auth';
    render();
  }

  function guessCharacterName(logPath) {
    if (!logPath) return '';
    var base = logPath.split(/[\\/]/).pop() || '';
    var match = base.match(/^eqlog_([^_]+)_/i);
    return match ? match[1] : '';
  }

  // ---- Character actions ----

  function handleRoll() {
    if (state.rolling || state.locked) return;
    state.rolling = true;
    render();
    finishRoll();
  }

  async function finishRoll() {
    var res = await apiRequest('/api/roll', { method: 'POST', body: { hardcore: !!state.hardcoreMode, pathMode: !!state.pathToggle } });
    state.rolling = false;
    if (!res.ok) {
      alert((res.data && res.data.error) || 'Could not randomize right now.');
      applyCharacterFromServer(null);
      render();
      return;
    }
    applyCharacterFromServer(res.data.character);
    render();
    window.eqlApp.notifyCharacterRolled();
    await refreshSharedData();
    render();
  }

  async function handleConfirmDeath() {
    if (state.resolving) return;
    var levelNum = Number(state.deathLevel);
    if (!state.deathLevel || !Number.isFinite(levelNum) || levelNum < 1) {
      alert('Select the level you died at first.');
      return;
    }
    state.resolving = true;
    render();
    var res = await apiRequest('/api/resolve', { method: 'POST', body: { type: 'died', level: levelNum, manual: true } });
    state.resolving = false;
    if (!res.ok) {
      alert((res.data && res.data.error) || 'Could not record that.');
      render();
      return;
    }
    state.confirmingDeath = false;
    state.deathLevel = '';
    applyCharacterFromServer(null);
    render();
    window.eqlApp.notifyCharacterUnlocked();
    await refreshSharedData();
    render();
  }

  async function handleDing() {
    if (!state.locked || state.resolving) return;
    state.resolving = true;
    render();
    var res = await apiRequest('/api/resolve', { method: 'POST', body: { type: 'ding', manual: true } });
    state.resolving = false;
    if (!res.ok) {
      alert((res.data && res.data.error) || 'Could not record that.');
      render();
      return;
    }
    applyCharacterFromServer(null);
    render();
    window.eqlApp.notifyCharacterUnlocked();
    await refreshSharedData();
    render();
  }

  async function handleRollAgain() {
    if (!state.locked || state.hardcore || state.resolving) return;
    state.resolving = true;
    render();
    var res = await apiRequest('/api/resolve', { method: 'POST', body: { type: 'retired' } });
    state.resolving = false;
    if (!res.ok) {
      alert((res.data && res.data.error) || 'Could not clear that character.');
      render();
      return;
    }
    applyCharacterFromServer(null);
    render();
    window.eqlApp.notifyCharacterUnlocked();
    await refreshSharedData();
    render();
  }

  // ---- Settings actions ----

  async function handleBrowseLog() {
    var filePath = await window.eqlApp.selectLogFile();
    if (!filePath) return;
    state.settingsLogFilePath = filePath;
    if (!state.settingsCharacterName) {
      state.settingsCharacterName = guessCharacterName(filePath);
    }
    state.settingsSaved = false;
    render();
  }

  async function handleSaveSettings() {
    await window.eqlApp.saveSettings({
      logFilePath: state.settingsLogFilePath,
      characterName: state.settingsCharacterName
    });
    state.settingsSaved = true;
    var status = await window.eqlApp.getWatchStatus();
    state.watching = status.watching;
    render();
  }

  // ---- Admin actions ----

  function handleClearClick(target) {
    if (state.clearBusy) return;
    state.confirmingClear = target; // 'log' or 'leaderboard'
    state.clearInput = '';
    state.clearError = '';
    render();
  }

  async function handleConfirmClear() {
    if (state.clearBusy) return;
    var target = state.confirmingClear;
    var passcode = state.clearInput;
    state.clearBusy = true;
    state.clearError = '';
    render();
    var res = await apiRequest('/api/admin/clear', { method: 'POST', body: { target: target, passcode: passcode } });
    state.clearBusy = false;
    if (!res.ok) {
      state.clearError = (res.data && res.data.error) || 'Wrong passcode. Nothing was cleared.';
      render();
      return;
    }
    state.confirmingClear = null;
    state.clearInput = '';
    state.clearError = '';
    render();
    await refreshSharedData();
    render();
  }

  // ---- IPC listeners ----

  window.eqlApp.onLevelUpdate(function (level) {
    state.currentDetectedLevel = level;
    render();
  });

  window.eqlApp.onCharacterResolved(async function () {
    var res = await apiRequest('/api/me');
    if (res.ok) applyCharacterFromServer(res.data.currentCharacter);
    await refreshSharedData();
    render();
  });

  window.eqlApp.onWatchStatus(function (payload) {
    state.watching = !!payload.watching;
    render();
  });

  window.eqlApp.onLogUpdated(function (log) {
    state.log = log;
    refreshLeaderboardFromLog();
    render();
  });

  // ---- Boot ----

  (async function init() {
    var settings = await window.eqlApp.loadSettings();
    state.apiBaseUrl = settings.apiBaseUrl || '';
    state.authApiUrl = settings.apiBaseUrl || '';
    state.settingsLogFilePath = settings.logFilePath || '';
    state.settingsCharacterName = settings.characterName || '';
    state.token = settings.token || null;
    state.username = settings.username || '';

    if (state.token && state.apiBaseUrl) {
      var res = await apiRequest('/api/me');
      if (res.ok) {
        applyCharacterFromServer(res.data.currentCharacter);
        state.screen = 'app';
        if (state.locked) {
          window.eqlApp.notifyCharacterLockedSync();
        }
        await refreshSharedData();
        var status = await window.eqlApp.getWatchStatus();
        state.watching = status.watching;
      } else {
        state.token = null;
        state.screen = 'auth';
      }
    } else {
      state.screen = 'auth';
    }

    render();
  })();
})();
