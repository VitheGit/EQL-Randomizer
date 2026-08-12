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
    manualBuild: false, hasSSF: false,
    locked: false, rolling: false, resolving: false,
    hardcoreMode: true, pathToggle: false, ssfToggle: false,

    manualMode: false,
    manualRace: '', manualPrimary: '', manualSecondary: '', manualTertiary: '',

    confirmingDeath: false, deathLevel: '',

    log: [], leaderboard: [],
    lbTab: 'randomized', // 'randomized' | 'manual'
    logTab: 'randomized', // 'randomized' | 'manual'

    settingsLogFilePath: '', settingsCharacterName: '',
    watching: false, currentDetectedLevel: null, settingsSaved: false,
    closeBehavior: 'tray', // 'tray' | 'quit'
    appVersion: '',
    updateStatus: { status: 'idle', version: null, progress: 0, errorMessage: null },

    confirmingClear: null, clearInput: '', clearError: '', clearBusy: false,

    view: 'randomizer' // 'randomizer' | 'settings'
  };

  // ---- Helpers ----

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var RACES = [
    "Barbarian", "Dark Elf", "Dwarf", "Erudite", "Froglok",
    "Gnome", "Half-Elf", "Halfling", "High Elf", "Human",
    "Iksar", "Kerran", "Ogre", "Troll", "Wood Elf"
  ];

  var CLASSES = [
    "Enchanter", "Magician", "Necromancer", "Wizard", "Bard",
    "Beastlord", "Paladin", "Ranger", "Shadow Knight", "Cleric",
    "Druid", "Shaman", "Berserker", "Monk", "Rogue", "Warrior"
  ];

  // class -> eligible races (matches the server's authoritative table exactly)
  var ELIGIBILITY = {
    "Beastlord": ["Barbarian","Iksar","Kerran","Ogre","Troll"],
    "Berserker": ["Barbarian","Dwarf","Kerran","Ogre","Troll"],
    "Rogue": ["Barbarian","Dark Elf","Dwarf","Froglok","Gnome","Half-Elf","Halfling","Human","Kerran","Wood Elf"],
    "Shaman": ["Barbarian","Froglok","Iksar","Kerran","Ogre","Troll"],
    "Warrior": ["Barbarian","Dark Elf","Dwarf","Froglok","Gnome","Half-Elf","Halfling","Human","Iksar","Kerran","Ogre","Troll","Wood Elf"],
    "Cleric": ["Dark Elf","Dwarf","Erudite","Froglok","Gnome","Halfling","High Elf","Human"],
    "Enchanter": ["Dark Elf","Erudite","Gnome","High Elf","Human"],
    "Magician": ["Dark Elf","Erudite","Gnome","High Elf","Human"],
    "Necromancer": ["Dark Elf","Erudite","Froglok","Gnome","Human","Iksar"],
    "Wizard": ["Dark Elf","Erudite","Froglok","Gnome","High Elf","Human"],
    "Paladin": ["Dwarf","Erudite","Froglok","Gnome","Half-Elf","Halfling","High Elf","Human"],
    "Shadow Knight": ["Dark Elf","Erudite","Froglok","Gnome","Human","Iksar","Ogre","Troll"],
    "Monk": ["Froglok","Human","Iksar"],
    "Bard": ["Half-Elf","Human","Kerran","Wood Elf"],
    "Druid": ["Half-Elf","Halfling","Human","Kerran","Wood Elf"],
    "Ranger": ["Half-Elf","Halfling","Human","Wood Elf"]
  };

  function eligiblePrimariesForRace(race) {
    if (!race) return [];
    return CLASSES.filter(function (cls) {
      return (ELIGIBILITY[cls] || []).indexOf(race) !== -1;
    });
  }

  var CLASS_ABBR = {
    'Enchanter': 'ENC', 'Magician': 'MAG', 'Necromancer': 'NEC', 'Wizard': 'WIZ',
    'Bard': 'BRD', 'Beastlord': 'BST', 'Paladin': 'PAL', 'Ranger': 'RNG',
    'Shadow Knight': 'SHD', 'Cleric': 'CLR', 'Druid': 'DRU', 'Shaman': 'SHM',
    'Berserker': 'BER', 'Monk': 'MNK', 'Rogue': 'ROG', 'Warrior': 'WAR'
  };

  function abbrClass(name) {
    return CLASS_ABBR[name] || name; // falls back to the full name if unrecognized
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
          killedBy: e.killedBy || null, manual: !!e.manual, manualBuild: !!e.manualBuild,
          ssf: !!e.ssf
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
          type: run.type, pathMode: run.pathMode, killedBy: run.killedBy, manual: run.manual,
          manualBuild: run.manualBuild, ssf: run.ssf
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
      state.manualBuild = !!character.manualBuild;
      state.hasSSF = !!character.ssf;
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
      state.manualBuild = false;
      state.hasSSF = false;
      state.locked = false;
    }
  }

  // ---- Render ----

  function renderLogRow(entry) {
    var stamp = formatStamp(new Date(entry.time));
    var who = escapeHtml(entry.name || 'Unknown') + (entry.ssf ? ' <span class="ssf-tag">SSF</span>' : '');
    var pathTag = entry.pathMode ? ' <span style="opacity:0.7">&#128506;</span>' : '';
    var manualTag = entry.manual ? ' <span style="font-size:10px;font-style:italic;opacity:0.65">(manual)</span>' : '';
    var killedByTag = (entry.type === 'died' && entry.killedBy) ? ' <span class="killed-by">— killed by ' + escapeHtml(entry.killedBy) + '</span>' : '';
    var trioTag = (entry.secondary && entry.tertiary)
      ? ' <span style="opacity:0.75">(Sec: ' + escapeHtml(abbrClass(entry.secondary)) + ', Ter: ' + escapeHtml(abbrClass(entry.tertiary)) + ')</span>'
      : '';
    var buildTag = (entry.race && entry.primary) ? ' ' + escapeHtml(entry.race) + ' ' + escapeHtml(abbrClass(entry.primary)) + trioTag : '';
    var text;
    if (entry.type === 'roll') {
      text = '<strong>' + who + ' ' + (entry.manualBuild ? 'created' : 'randomized') + ':</strong>' + buildTag + pathTag;
    } else if (entry.type === 'ding') {
      text = '<strong class="ding-glow">&#127881; ' + who + ' hit Level 50!:</strong>' + buildTag + pathTag + manualTag;
    } else if (entry.type === 'retired') {
      text = '<strong>' + who + ' retired (casual):</strong>' + buildTag + pathTag;
    } else {
      text = '<strong>' + who + ' died' + (entry.level ? ' at level ' + escapeHtml(entry.level) : '') + ':</strong>' + buildTag + killedByTag + pathTag + manualTag;
    }
    return '<div class="log-row"><span class="log-stamp">' + stamp + '</span><span class="log-text">' + text + '</span></div>';
  }

  function renderLbRow(row, rank) {
    var medal = rank === 1 ? '&#129351; ' : rank === 2 ? '&#129352; ' : rank === 3 ? '&#129353; ' : '';
    var icon = row.type === 'ding' ? '&#127881; ' : '&#128128; ';
    var pathIcon = row.pathMode ? '&#128506; ' : '';
    var manualTag = row.manual ? ' <span style="font-size:10px;font-style:italic;opacity:0.65">(manual)</span>' : '';
    var ssfTag = row.ssf ? ' <span class="ssf-tag">SSF</span>' : '';
    var killedByTag = (row.type === 'died' && row.killedBy) ? ' <span class="killed-by">· killed by ' + escapeHtml(row.killedBy) + '</span>' : '';
    var classes = (row.secondary && row.tertiary)
      ? (abbrClass(row.primary) + ' / ' + abbrClass(row.secondary) + ' / ' + abbrClass(row.tertiary))
      : abbrClass(row.primary);
    var levelClass = 'lb-level' + (row.type === 'ding' ? ' ding-glow' : '');
    return (
      '<div class="lb-row">' +
        '<span class="lb-rank">' + medal + '#' + rank + '</span>' +
        '<span class="lb-name">' + escapeHtml(row.name) + ' <span style="font-weight:400;font-style:italic;color:var(--ink-soft)">(' + escapeHtml(row.race) + ')</span>' + ssfTag + '</span>' +
        '<span class="' + levelClass + '">' + icon + pathIcon + 'Lvl ' + row.level + manualTag + '</span>' +
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
        ? '<p class="note">Click Randomize! or Create Manually to draw your character.</p>'
        : state.locked && !state.confirmingDeath
          ? '<p class="note warn">' + (state.hardcore ? 'Locked in — eligible for the leaderboard. Deaths/level 50 are detected automatically from your log file.' : 'Casual character. Click "Roll Again" whenever you\'re ready.') + (state.manualBuild ? ' <span style="opacity:0.75">(manually built)</span>' : '') + '</p>'
          : '') +
    '</div>';

    if (state.locked && state.confirmingDeath) {
      var autoLevelKnown = state.watching && state.currentDetectedLevel;
      html += '<div class="card" style="max-width:320px;margin:0 auto 16px;">' +
        (autoLevelKnown
          ? '<label class="field-label">Level at Death</label>' +
            '<p style="text-align:center;font-size:20px;font-weight:700;margin:4px 0 2px;">' + escapeHtml(state.currentDetectedLevel) + '</p>' +
            '<p class="hint">Detected automatically from your log file.</p>'
          : '<label class="field-label">Level at Death</label>' +
            '<select id="in-death-level">' +
              '<option value="" disabled' + (state.deathLevel ? '' : ' selected') + '>Select level</option>' +
              Array.from({ length: 50 }, function (_, i) { return i + 1; }).map(function (lvl) {
                return '<option value="' + lvl + '"' + (String(lvl) === String(state.deathLevel) ? ' selected' : '') + '>' + lvl + '</option>';
              }).join('') +
            '</select>') +
        '<div class="actions">' +
          '<button class="btn btn-died" id="btn-confirm-death"' + (state.resolving ? ' disabled' : '') + '>Confirm Death</button>' +
          '<button class="btn btn-ghost" id="btn-cancel-death">Cancel</button>' +
        '</div>' +
      '</div>';
    }

    if (!state.locked && state.manualMode) {
      var eligiblePrimaries = eligiblePrimariesForRace(state.manualRace);
      html += '<div class="card">' +
        '<h3>Create Character Manually</h3>' +
        '<div class="field">' +
          '<label class="field-label">Race</label>' +
          '<select id="in-manual-race">' +
            '<option value="" disabled' + (state.manualRace ? '' : ' selected') + '>Select a race</option>' +
            RACES.map(function (r) { return '<option value="' + r + '"' + (state.manualRace === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">Primary Class</label>' +
          '<select id="in-manual-primary"' + (!state.manualRace ? ' disabled' : '') + '>' +
            '<option value="" disabled' + (state.manualPrimary ? '' : ' selected') + '>' + (state.manualRace ? 'Select a class' : 'Select a race first') + '</option>' +
            eligiblePrimaries.map(function (c) { return '<option value="' + c + '"' + (state.manualPrimary === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">Secondary Class</label>' +
          '<select id="in-manual-secondary"' + (!state.manualPrimary ? ' disabled' : '') + '>' +
            '<option value="" disabled' + (state.manualSecondary ? '' : ' selected') + '>' + (state.manualPrimary ? 'Select a class' : 'Select Primary first') + '</option>' +
            CLASSES.filter(function (c) { return c !== state.manualPrimary; }).map(function (c) { return '<option value="' + c + '"' + (state.manualSecondary === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">Tertiary Class</label>' +
          '<select id="in-manual-tertiary"' + (!state.manualSecondary ? ' disabled' : '') + '>' +
            '<option value="" disabled' + (state.manualTertiary ? '' : ' selected') + '>' + (state.manualSecondary ? 'Select a class' : 'Select Secondary first') + '</option>' +
            CLASSES.filter(function (c) { return c !== state.manualPrimary && c !== state.manualSecondary; }).map(function (c) { return '<option value="' + c + '"' + (state.manualTertiary === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<p class="hint">Manually-built characters are always Hardcore and eligible for the leaderboard.</p>' +
        '<div class="actions">' +
          '<button class="btn btn-primary" id="btn-manual-create"' + (state.rolling ? ' disabled' : '') + '>' + (state.rolling ? 'Creating…' : 'Lock In Character') + '</button>' +
          '<button class="btn btn-ghost" id="btn-manual-cancel"' + (state.rolling ? ' disabled' : '') + '>Cancel</button>' +
        '</div>' +
      '</div>';
    } else {
      html += '<div class="actions">' +
        (state.locked
          ? (state.confirmingDeath ? ''
              : state.hardcore
                ? '<button class="btn btn-died" id="btn-died"' + (state.resolving ? ' disabled' : '') + '>I Died (manual)</button>' +
                  '<button class="btn btn-ding" id="btn-ding"' + (state.resolving ? ' disabled' : '') + '>Ding! Level 50! (manual)</button>'
                : '<button class="btn btn-primary" id="btn-roll-again"' + (state.resolving ? ' disabled' : '') + '>Roll Again</button>')
          : '<button class="btn btn-primary" id="btn-roll"' + (state.rolling ? ' disabled' : '') + '>' + (state.rolling ? 'Randomizing…' : 'Randomize!') + '</button>' +
            '<button class="btn btn-ghost" id="btn-manual-mode">Create Manually</button>') +
      '</div>';
    }

    if (!state.locked && !state.manualMode) {
      html += '<div class="toggles-row">' +
        '<label class="toggle"><input type="checkbox" id="in-hardcore"' + (state.hardcoreMode ? ' checked' : '') + ' /> Hardcore</label>' +
        '<label class="toggle"><input type="checkbox" id="in-ssf"' + (state.ssfToggle ? ' checked' : '') + ' /> SSF</label>' +
        '<label class="toggle"><input type="checkbox" id="in-path"' + (state.pathToggle ? ' checked' : '') + ' /> Random Leveling Path</label>' +
      '</div>' +
      '<p class="hint">* Only Hardcore characters are eligible for the leaderboard. SSF = Solo Self Found, no trading with other players.</p>';
    } else if (!state.locked && state.manualMode) {
      html += '<div class="toggles-row">' +
        '<label class="toggle"><input type="checkbox" id="in-ssf"' + (state.ssfToggle ? ' checked' : '') + ' /> SSF</label>' +
        '<label class="toggle"><input type="checkbox" id="in-path"' + (state.pathToggle ? ' checked' : '') + ' /> Random Leveling Path</label>' +
      '</div>';
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

    var visibleLb = state.leaderboard.filter(function (row) { return !!row.manualBuild === (state.lbTab === 'manual'); });
    html += '<div class="card"><h3>Leaderboard</h3>' +
      '<div class="auth-tabs" style="margin-bottom:10px;">' +
        '<button class="auth-tab' + (state.lbTab === 'randomized' ? ' active' : '') + '" id="tab-lb-randomized" type="button">Randomized</button>' +
        '<button class="auth-tab' + (state.lbTab === 'manual' ? ' active' : '') + '" id="tab-lb-manual" type="button">Manual</button>' +
      '</div>' +
      '<div class="list-scroll">' +
      (visibleLb.length === 0
        ? '<p class="empty-text">No completed ' + (state.lbTab === 'manual' ? 'manually-built' : 'randomized') + ' Hardcore runs yet.</p>'
        : visibleLb.map(function (row, i) { return renderLbRow(row, i + 1); }).join('')) +
    '</div></div>';

    var visibleLog = state.log.filter(function (entry) { return !!entry.manualBuild === (state.logTab === 'manual'); });
    html += '<div class="card"><h3>Adventure Log</h3>' +
      '<div class="auth-tabs" style="margin-bottom:10px;">' +
        '<button class="auth-tab' + (state.logTab === 'randomized' ? ' active' : '') + '" id="tab-log-randomized" type="button">Randomized</button>' +
        '<button class="auth-tab' + (state.logTab === 'manual' ? ' active' : '') + '" id="tab-log-manual" type="button">Manual</button>' +
      '</div>' +
      '<div class="list-scroll">' +
      (visibleLog.length === 0
        ? '<p class="empty-text">No ' + (state.logTab === 'manual' ? 'manually-built' : 'randomized') + ' entries yet.</p>'
        : visibleLog.slice().reverse().slice(0, 50).map(renderLogRow).join('')) +
    '</div></div>';

    return html;
  }

  function renderUpdateStatus() {
    var s = state.updateStatus || { status: 'idle' };
    if (s.status === 'checking') {
      return '<p class="hint">Checking for updates…</p>' +
        '<button class="btn btn-ghost btn-full" disabled>Checking…</button>';
    }
    if (s.status === 'available') {
      return '<p class="note warn" style="text-align:left;margin:0 0 10px;">Version ' + escapeHtml(s.version) + ' is available!</p>' +
        '<button class="btn btn-primary btn-full" id="btn-download-update">Download Update</button>';
    }
    if (s.status === 'downloading') {
      return '<p class="hint">Downloading update… ' + (s.progress || 0) + '%</p>' +
        '<button class="btn btn-ghost btn-full" disabled>Downloading…</button>';
    }
    if (s.status === 'downloaded') {
      return '<p class="note warn" style="text-align:left;margin:0 0 10px;">Version ' + escapeHtml(s.version) + ' is downloaded and ready.</p>' +
        '<button class="btn btn-ding btn-full" id="btn-install-update">Restart && Install Now</button>';
    }
    if (s.status === 'error') {
      return '<p class="error-text">Could not check for updates: ' + escapeHtml(s.errorMessage || 'Unknown error') + '</p>' +
        '<button class="btn btn-blue btn-full" id="btn-check-update">Check for Updates</button>';
    }
    // 'idle' or 'not-available'
    return '<p class="hint">You\'re on the latest version.</p>' +
      '<button class="btn btn-blue btn-full" id="btn-check-update">Check for Updates</button>';
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
        '<h3>Updates</h3>' +
        '<p class="hint">Current version: ' + escapeHtml(state.appVersion || '—') + '</p>' +
        renderUpdateStatus() +
      '</div>' +
      '<div class="card">' +
        '<h3>App Behavior</h3>' +
        '<div class="field">' +
          '<label class="field-label">When you click the X button</label>' +
          '<select id="in-close-behavior">' +
            '<option value="tray"' + (state.closeBehavior === 'tray' ? ' selected' : '') + '>Minimize to system tray (recommended — keeps watching your log file)</option>' +
            '<option value="quit"' + (state.closeBehavior === 'quit' ? ' selected' : '') + '>Quit the app completely</option>' +
          '</select>' +
        '</div>' +
        '<p class="hint">If you choose "Quit," the app stops watching your log file entirely until you reopen it — you\'ll need to reopen the app to get death/level notifications again.</p>' +
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
    var ssfCheckbox = document.getElementById('in-ssf');
    if (ssfCheckbox) ssfCheckbox.addEventListener('change', function (e) { state.ssfToggle = e.target.checked; });

    var diedBtn = document.getElementById('btn-died');
    if (diedBtn) diedBtn.addEventListener('click', function () {
      state.confirmingDeath = true;
      state.deathLevel = (state.watching && state.currentDetectedLevel) ? String(state.currentDetectedLevel) : '';
      render();
    });
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

    var manualModeBtn = document.getElementById('btn-manual-mode');
    if (manualModeBtn) manualModeBtn.addEventListener('click', function () {
      state.manualMode = true;
      state.manualRace = ''; state.manualPrimary = ''; state.manualSecondary = ''; state.manualTertiary = '';
      render();
    });
    var manualCancelBtn = document.getElementById('btn-manual-cancel');
    if (manualCancelBtn) manualCancelBtn.addEventListener('click', function () {
      state.manualMode = false;
      state.manualRace = ''; state.manualPrimary = ''; state.manualSecondary = ''; state.manualTertiary = '';
      render();
    });
    var manualRaceSel = document.getElementById('in-manual-race');
    if (manualRaceSel) manualRaceSel.addEventListener('change', function (e) {
      state.manualRace = e.target.value;
      // Changing race can invalidate the previously chosen Primary — reset the whole chain.
      state.manualPrimary = ''; state.manualSecondary = ''; state.manualTertiary = '';
      render();
    });
    var manualPrimarySel = document.getElementById('in-manual-primary');
    if (manualPrimarySel) manualPrimarySel.addEventListener('change', function (e) {
      state.manualPrimary = e.target.value;
      state.manualSecondary = ''; state.manualTertiary = '';
      render();
    });
    var manualSecondarySel = document.getElementById('in-manual-secondary');
    if (manualSecondarySel) manualSecondarySel.addEventListener('change', function (e) {
      state.manualSecondary = e.target.value;
      state.manualTertiary = '';
      render();
    });
    var manualTertiarySel = document.getElementById('in-manual-tertiary');
    if (manualTertiarySel) manualTertiarySel.addEventListener('change', function (e) { state.manualTertiary = e.target.value; });
    var manualCreateBtn = document.getElementById('btn-manual-create');
    if (manualCreateBtn) manualCreateBtn.addEventListener('click', handleManualCreate);

    var lbTabRandomized = document.getElementById('tab-lb-randomized');
    if (lbTabRandomized) lbTabRandomized.addEventListener('click', function () { state.lbTab = 'randomized'; render(); });
    var lbTabManual = document.getElementById('tab-lb-manual');
    if (lbTabManual) lbTabManual.addEventListener('click', function () { state.lbTab = 'manual'; render(); });
    var logTabRandomized = document.getElementById('tab-log-randomized');
    if (logTabRandomized) logTabRandomized.addEventListener('click', function () { state.logTab = 'randomized'; render(); });
    var logTabManual = document.getElementById('tab-log-manual');
    if (logTabManual) logTabManual.addEventListener('click', function () { state.logTab = 'manual'; render(); });

    var browseBtn = document.getElementById('btn-browse-log');
    if (browseBtn) browseBtn.addEventListener('click', handleBrowseLog);
    var charNameInput = document.getElementById('in-char-name');
    if (charNameInput) charNameInput.addEventListener('input', function (e) { state.settingsCharacterName = e.target.value; state.settingsSaved = false; });
    var saveSettingsBtn = document.getElementById('btn-save-settings');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', handleSaveSettings);

    var closeBehaviorSel = document.getElementById('in-close-behavior');
    if (closeBehaviorSel) closeBehaviorSel.addEventListener('change', async function (e) {
      state.closeBehavior = e.target.value;
      await window.eqlApp.saveSettings({ closeBehavior: state.closeBehavior });
      render();
    });

    var checkUpdateBtn = document.getElementById('btn-check-update');
    if (checkUpdateBtn) checkUpdateBtn.addEventListener('click', function () {
      state.updateStatus = { status: 'checking', version: null, progress: 0, errorMessage: null };
      render();
      window.eqlApp.checkForUpdates();
    });
    var downloadUpdateBtn = document.getElementById('btn-download-update');
    if (downloadUpdateBtn) downloadUpdateBtn.addEventListener('click', function () {
      window.eqlApp.downloadUpdate();
    });
    var installUpdateBtn = document.getElementById('btn-install-update');
    if (installUpdateBtn) installUpdateBtn.addEventListener('click', function () {
      window.eqlApp.installUpdate();
    });

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
    state.currentDetectedLevel = status.currentLevel || null;
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
    var res = await apiRequest('/api/roll', { method: 'POST', body: { hardcore: !!state.hardcoreMode, pathMode: !!state.pathToggle, ssf: !!state.ssfToggle } });
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

  async function handleManualCreate() {
    if (state.rolling) return;
    if (!state.manualRace || !state.manualPrimary || !state.manualSecondary || !state.manualTertiary) {
      alert('Choose a race and all three classes first.');
      return;
    }
    state.rolling = true;
    render();
    var res = await apiRequest('/api/roll', { method: 'POST', body: {
      manualBuild: true,
      pathMode: !!state.pathToggle,
      ssf: !!state.ssfToggle,
      race: state.manualRace,
      primary: state.manualPrimary,
      secondary: state.manualSecondary,
      tertiary: state.manualTertiary
    } });
    state.rolling = false;
    if (!res.ok) {
      alert((res.data && res.data.error) || 'Could not create that character.');
      render();
      return;
    }
    applyCharacterFromServer(res.data.character);
    state.manualMode = false;
    state.manualRace = ''; state.manualPrimary = ''; state.manualSecondary = ''; state.manualTertiary = '';
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
    state.currentDetectedLevel = status.currentLevel || null;
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

  window.eqlApp.onUpdateStatus(function (payload) {
    state.updateStatus = payload;
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
    state.closeBehavior = settings.closeBehavior || 'tray';

    state.appVersion = await window.eqlApp.getAppVersion();
    state.updateStatus = await window.eqlApp.getUpdateStatus();

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
        state.currentDetectedLevel = status.currentLevel || null;
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
