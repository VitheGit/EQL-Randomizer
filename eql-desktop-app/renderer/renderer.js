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
    hardcoreMode: true, pathToggle: false, ssfToggle: false, d4Toggle: false,

    manualMode: false,
    manualRace: '', manualPrimary: '', manualSecondary: '', manualTertiary: '',

    confirmingDeath: false, deathLevel: '',
    confirmingDing: false, dingLevel: '',

    log: [], leaderboard: [], leaderboardResetAt: null,
    lbTab: 'randomized', // 'randomized' | 'manual'
    lbFilterClass: '', lbFilterStatus: '', lbFilterSSF: false, lbFilterPath: false, lbFilterD4: false,
    chatMessages: [], chatInput: '', chatCollapsed: false, chatOnlineUsers: [], chatOfflineUsers: [], chatColor: '#2A2016', chatOverlayOpen: false, chatOverlayOpacity: 0.9, emojiPickerOpen: false,
    logTab: 'randomized', // 'randomized' | 'manual'

    settingsLogFilePath: '', settingsCharacterName: '',
    watching: false, currentDetectedLevel: null, settingsSaved: false,
    closeBehavior: 'tray', // 'tray' | 'quit'
    soundsEnabled: true,
    notificationsEnabled: true,
    notificationVolume: 1.0,
    notificationPosition: 'top-middle',
    groupName: '', groupInput: '',
    appVersion: '',
    updateStatus: { status: 'idle', version: null, progress: 0, errorMessage: null },
    updateCheckCooldownUntil: 0, // timestamp (ms) - Check for Updates button stays disabled until this passes

    confirmingClear: null, clearInput: '', clearError: '', clearBusy: false,

    view: 'randomizer' // 'randomizer' | 'leaderboard' | 'log' | 'instructions' | 'settings'
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

  var NOTIFICATION_POSITIONS = [
    { value: 'top-left', label: 'Top-Left' },
    { value: 'top-middle', label: 'Top-Middle' },
    { value: 'top-right', label: 'Top-Right' },
    { value: 'middle-left', label: 'Middle-Left' },
    { value: 'center', label: 'Center' },
    { value: 'middle-right', label: 'Middle-Right' },
    { value: 'bottom-left', label: 'Bottom-Left' },
    { value: 'bottom-middle', label: 'Bottom-Middle' },
    { value: 'bottom-right', label: 'Bottom-Right' }
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

  // A small custom icon (rather than an emoji) so the road and the "?"
  // can each have their own distinct, controllable color.
  var PATH_ICON_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-4px;">' +
      '<path d="M4 22 C4 22 17 20 17 15.5 C17 11 3 11 3 6.5 C3 3.5 11 2.5 13 2" stroke="#2A2016" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
      '<text x="20" y="12" font-size="13" font-weight="900" fill="#C0392B" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif">?</text>' +
    '</svg>';

  // A small triangular die icon (the classic tetrahedron/d4 shape) with
  // the "4" set inside it, so a D4-flagged character is visually
  // distinct rather than just another text badge.
  var D4_ICON_SVG =
    '<svg width="22" height="22" viewBox="0 0 24 24" style="vertical-align:-6px;">' +
      '<polygon points="12,2 22.5,21 1.5,21" fill="#8C3B2A" stroke="#4A2015" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<text x="12" y="18" font-size="13" font-weight="900" fill="#F5E6C8" text-anchor="middle" font-family="Arial, sans-serif">4</text>' +
    '</svg>';

  var CLASS_ABBR = {
    'Enchanter': 'ENC', 'Magician': 'MAG', 'Necromancer': 'NEC', 'Wizard': 'WIZ',
    'Bard': 'BRD', 'Beastlord': 'BST', 'Paladin': 'PAL', 'Ranger': 'RNG',
    'Shadow Knight': 'SHD', 'Cleric': 'CLR', 'Druid': 'DRU', 'Shaman': 'SHM',
    'Berserker': 'BER', 'Monk': 'MNK', 'Rogue': 'ROG', 'Warrior': 'WAR'
  };

  function abbrClass(name) {
    return CLASS_ABBR[name] || name; // falls back to the full name if unrecognized
  }

  // Native title-attribute tooltips ignore CSS entirely (no word-wrap,
  // no max-width) — the only way to control their line length is to
  // insert real line breaks, which native tooltips DO respect.
  function wrapTooltipText(str, maxLineLength) {
    maxLineLength = maxLineLength || 100;
    var words = str.split(' ');
    var lines = [];
    var currentLine = '';
    words.forEach(function (word) {
      var candidate = currentLine ? (currentLine + ' ' + word) : word;
      if (candidate.length > maxLineLength) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    });
    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
  }

  var USEFUL_LINKS = [
    { name: 'EQ Legends Wiki', url: 'https://eqlwiki.com/' },
    { name: 'EQ Legends Plane of Sky', url: 'https://eqlposky.com/' },
    { name: 'EQ Legends Companion App', url: 'https://jmoyers.github.io/everquest-companion/' }
  ];

  var MODE_DESCRIPTIONS = {
    hardcore: wrapTooltipText('This is a perma-death mode!  Create a new character with the race and classes that were given to you.  If you die, immediately log out and delete the character!'),
    ssf: wrapTooltipText('This is a Solo-Self Found mode.  You are not allowed to trade with other players, and no group with other players.  No outside help at all.'),
    path: wrapTooltipText('This will generate a random leveling path for your character to follow.  You are expected to only hunt, and use items from the zones given to you.  An extra difficulty if you so desire!'),
    d4: wrapTooltipText('Difficulty 4 Only — the highest of the 4 difficulty tiers. Restrict yourself to Difficulty 4 content only for an extra challenge.')
  };

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

  // The 46-50 planes are brutal and can end a run outright, so the path
  // display offers an explicit out. Applied at DISPLAY time rather than
  // baked into stored paths, so it shows up immediately for characters
  // that were already rolled, with no data migration needed.
  // The 46-50 planes can end a run outright, so that row offers the
  // player's own 40-46 zone as an alternative — pulled from their actual
  // path rather than described generically, so they don't have to look
  // it up. Applied at DISPLAY time, so characters rolled before this
  // existed pick it up with no data migration.
  function formatPathZone(b, path) {
    var zone = b.zone || b.note || 'Anywhere';
    if (!b.zone || b.range !== '46-50' || !path) return zone;
    var prior = null;
    path.forEach(function (p) {
      if (p && p.range === '40-46' && p.zone) prior = p.zone;
    });
    return prior ? (prior + ' or ' + zone) : zone;
  }

  function formatPathTooltip(path) {
    if (!path || !path.length) return 'Random Leveling Path';
    var lines = ['Leveling Path:'];
    path.forEach(function (b) {
      lines.push(b.range + ': ' + formatPathZone(b, path));
    });
    return lines.join('\n');
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
      if (!byName[n]) byName[n] = { lastRollTime: null, runs: [], current: null };
      if (e.type === 'roll') {
        byName[n].lastRollTime = e.time;
        byName[n].current = {
          level: 1, // no levelup entry yet — assume level 1 until we see one
          race: e.race, primary: e.primary, secondary: e.secondary, tertiary: e.tertiary,
          hardcore: !!e.hardcore, pathMode: !!e.pathMode, manualBuild: !!e.manualBuild, ssf: !!e.ssf,
          path: e.path || null, server: e.server || null, d4: !!e.d4,
          rollTime: e.time
        };
      } else if (e.type === 'levelup') {
        if (byName[n].current) byName[n].current.level = Number(e.level) || byName[n].current.level;
      } else if (e.type === 'died' || e.type === 'ding') {
        var level = e.type === 'ding' ? 50 : (Number(e.level) || 0);
        var duration = byName[n].lastRollTime ? (new Date(e.time) - new Date(byName[n].lastRollTime)) : null;
        byName[n].runs.push({
          level: level, duration: duration, time: e.time, type: e.type,
          race: e.race, primary: e.primary, secondary: e.secondary, tertiary: e.tertiary,
          hardcore: !!e.hardcore, pathMode: !!e.pathMode,
          killedBy: e.killedBy || null, manual: !!e.manual, manualBuild: !!e.manualBuild,
          ssf: !!e.ssf, path: e.path || null, server: e.server || null, d4: !!e.d4
        });
        byName[n].lastRollTime = null;
        byName[n].current = null; // resolved — no longer in progress
      } else if (e.type === 'retired') {
        byName[n].lastRollTime = null;
        byName[n].current = null;
      }
    });
    return byName;
  }

  function computeLeaderboard(log, resetAt) {
    var lbLog = resetAt
      ? log.filter(function (e) { return new Date(e.time) > new Date(resetAt); })
      : log;
    var byName = computeRuns(lbLog);
    var rows = [];
    Object.keys(byName).forEach(function (name) {
      byName[name].runs.forEach(function (run) {
        if (!run.hardcore) return;
        rows.push({
          name: name, level: run.level, duration: run.duration, race: run.race,
          primary: run.primary, secondary: run.secondary, tertiary: run.tertiary,
          type: run.type, pathMode: run.pathMode, killedBy: run.killedBy, manual: run.manual,
          manualBuild: run.manualBuild, ssf: run.ssf, path: run.path, server: run.server, d4: run.d4,
          status: run.type === 'died' ? 'dead' : 'alive'
        });
      });
      // Still-active, unresolved characters show up too — this is what makes
      // the leaderboard feel "live" rather than only updating on death/ding.
      var current = byName[name].current;
      if (current && current.hardcore) {
        var elapsed = current.rollTime ? (Date.now() - new Date(current.rollTime)) : null;
        rows.push({
          name: name, level: current.level, duration: elapsed, race: current.race,
          primary: current.primary, secondary: current.secondary, tertiary: current.tertiary,
          type: 'inprogress', pathMode: current.pathMode, killedBy: null, manual: false,
          manualBuild: current.manualBuild, ssf: current.ssf, path: current.path, server: current.server, d4: current.d4,
          status: 'alive'
        });
      }
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
    state.leaderboard = computeLeaderboard(state.log, state.leaderboardResetAt);
  }

  async function refreshSharedData() {
    var res = await apiRequest('/api/kv?key=log');
    if (res.ok && res.data && typeof res.data.value === 'string') {
      try { state.log = JSON.parse(res.data.value); } catch (e) { state.log = []; }
    }
    var resetRes = await apiRequest('/api/kv?key=leaderboard-reset-at');
    state.leaderboardResetAt = (resetRes.ok && resetRes.data && typeof resetRes.data.value === 'string') ? resetRes.data.value : null;
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
      state.hasD4 = !!character.d4;
      state.rolledAt = character.rolledAt || null;
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
      state.hasD4 = false;
      state.rolledAt = null;
      state.locked = false;
    }
  }

  // ---- Render ----

  function renderLogRow(entry) {
    var stamp = formatStamp(new Date(entry.time));
    var serverTag = entry.server ? ' <span style="opacity:0.7;">[' + escapeHtml(entry.server) + ']</span>' : '';
    var d4Tag = entry.d4 ? ' <span title="Difficulty 4 Only">' + D4_ICON_SVG + '</span>' : '';
    var who = escapeHtml(entry.name || 'Unknown') + serverTag + d4Tag + (entry.ssf ? ' <span class="ssf-tag">SSF</span>' : '');
    var pathTag = entry.pathMode ? ' <span class="eql-path-icon" title="' + escapeHtml(formatPathTooltip(entry.path)) + '">' + PATH_ICON_SVG + '</span>' : '';
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
    } else if (entry.type === 'levelup') {
      text = '<strong>' + who + ' reached level ' + escapeHtml(entry.level) + ':</strong>' + buildTag + pathTag;
    } else if (entry.type === 'aa') {
      text = '<strong>&#128142; ' + who + ' gained an AA:</strong>' + buildTag + pathTag;
    } else if (entry.type === 'cleared') {
      var clearedWhat = entry.target === 'leaderboard' ? 'Leaderboard' : 'Log';
      text = '<em style="opacity:0.8;">' + clearedWhat + ' was cleared on ' + escapeHtml(formatStamp(new Date(entry.time))) + ' by ' + escapeHtml(entry.name || 'Unknown') + '</em>';
    } else if (entry.type === 'notable') {
      text = '<strong>&#128481; ' + who + ' defeated ' + escapeHtml(entry.npc) +
        (typeof entry.difficulty === 'number' ? ' on Difficulty ' + entry.difficulty : '') + '</strong>' + buildTag;
    } else if (entry.type === 'died') {
      text = '<strong>' + who + ' died' + (entry.level ? ' at level ' + escapeHtml(entry.level) : '') + ':</strong>' + buildTag + killedByTag + pathTag + manualTag;
    } else {
      // Unknown type. This used to fall through to the death message,
      // so any newer entry type silently rendered as "X died" — wrong,
      // and indistinguishable from a real death.
      text = '<strong>' + who + ':</strong> ' + escapeHtml(entry.type);
    }
    return '<div class="log-row"><span class="log-stamp">' + stamp + '</span><span class="log-text">' + text + '</span></div>';
  }

  function renderLbRow(row, rank) {
    var medal = rank === 1 ? '&#129351; ' : rank === 2 ? '&#129352; ' : rank === 3 ? '&#129353; ' : '';
    var icon = row.type === 'ding' ? '&#127881; ' : row.type === 'died' ? '&#128128; ' : '';
    var pathIcon = row.pathMode ? '<span class="eql-path-icon" title="' + escapeHtml(formatPathTooltip(row.path)) + '">' + PATH_ICON_SVG + '</span> ' : '';
    var manualTag = row.manual ? ' <span style="font-size:10px;font-style:italic;opacity:0.65">(manual)</span>' : '';
    var ssfTag = row.ssf ? ' <span class="ssf-tag">SSF</span>' : '';
    var statusTag = row.status === 'dead'
      ? ' <span class="status-tag status-dead">DEAD</span>'
      : ' <span class="status-tag status-alive">ALIVE</span>';
    var killedByTag = (row.type === 'died' && row.killedBy) ? ' <span class="killed-by">· killed by ' + escapeHtml(row.killedBy) + '</span>' : '';
    var serverTag = row.server ? ' <span style="opacity:0.7;">[' + escapeHtml(row.server) + ']</span>' : '';
    var d4Tag = row.d4 ? ' <span title="Difficulty 4 Only">' + D4_ICON_SVG + '</span>' : '';
    var classes = (row.secondary && row.tertiary)
      ? (abbrClass(row.primary) + ' / ' + abbrClass(row.secondary) + ' / ' + abbrClass(row.tertiary))
      : abbrClass(row.primary);
    var levelClass = 'lb-level' + (row.type === 'ding' ? ' ding-glow' : '');
    return (
      '<div class="lb-row">' +
        '<span class="lb-rank">#' + rank + '</span>' +
        '<div class="lb-main">' +
          '<div class="lb-line1">' +
            '<span class="lb-name">' + escapeHtml(row.name) + ' <span style="font-weight:400;font-style:italic;color:var(--ink-soft)">(' + escapeHtml(row.race) + ')</span>' + serverTag + d4Tag + ssfTag + statusTag + (medal ? ' ' + medal : '') + '</span>' +
            '<span class="' + levelClass + '">' + icon + pathIcon + 'Lvl ' + row.level + manualTag + '</span>' +
          '</div>' +
          '<div class="lb-build">' + escapeHtml(classes) + ' · ' + formatDuration(row.duration) + killedByTag + '</div>' +
        '</div>' +
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
    var updateStatus = (state.updateStatus && state.updateStatus.status) || 'idle';
    var updateBanner = (updateStatus === 'available' || updateStatus === 'downloaded')
      ? '<p class="update-banner">*Update Available!*<br>Please go to the SETTINGS tab and update!</p>'
      : '';
    html += '<div class="header">' +
      '<img src="../build/icon.png" alt="EQ Legends Randomizer" />' +
      updateBanner +
      '<p class="subtitle">Character Randomizer</p>' +
    '</div>';

    html += '<div class="user-bar"><span>Logged in as <strong>' + escapeHtml(state.username) + '</strong></span>' +
      '<button id="btn-logout">Log out</button>' +
    '</div>';

    var NAV_ITEMS = [
      { view: 'randomizer', label: 'Randomizer' },
      { view: 'leaderboard', label: 'Leaderboard' },
      { view: 'log', label: 'Adventure Log' },
      { view: 'instructions', label: 'Instructions' },
      { view: 'settings', label: 'Settings' },
      { view: 'admin', label: 'Admin' }
    ];

    html += '<div class="app-shell">' +
      '<div class="sidebar-nav">' +
        NAV_ITEMS.map(function (item) {
          return '<button class="sidebar-nav-item' + (state.view === item.view ? ' active' : '') + '" id="nav-' + item.view + '" type="button">' + escapeHtml(item.label) + '</button>';
        }).join('') +
      '</div>' +
      '<div class="main-content">';

    if (state.view === 'settings') {
      html += renderSettingsView();
    } else if (state.view === 'admin') {
      html += renderAdminView();
    } else if (state.view === 'leaderboard') {
      html += renderLeaderboardView();
    } else if (state.view === 'log') {
      html += renderLogView();
    } else if (state.view === 'instructions') {
      html += renderInstructionsView();
    } else {
      html += renderRandomizerView();
    }

    html += '</div></div>';

    html += '<div class="links-bar">' +
      '<span class="links-bar-label">EQ Legends Useful Links:</span>' +
      USEFUL_LINKS.map(function (link, i) {
        return '<a href="#" class="links-bar-item" data-link-index="' + i + '">' + escapeHtml(link.name) + '</a>';
      }).join('<span class="links-bar-sep">·</span>') +
    '</div>';

    html += '<p class="legal-footer">EverQuest Legends is a trademark of Darkpaw Games and Game Jawn. This is an unofficial, fan-made tool and is not affiliated with, endorsed by, or sponsored by Darkpaw Games, Game Jawn, or their affiliates.</p>';

    root.innerHTML = html;
    bindAppEvents();
  }

  function renderRandomizerView() {
    var html = '';

    var cardBadges = state.locked ? (
      (state.hasPath ? '<span class="eql-path-icon" title="' + escapeHtml(formatPathTooltip(state.levelingPath)) + '">' + PATH_ICON_SVG + '</span>' : '') +
      (state.hasSSF ? '<span class="ssf-tag" title="Solo Self Found">SSF</span>' : '') +
      (state.hasD4 ? '<span title="Difficulty 4 Only">' + D4_ICON_SVG + '</span>' : '')
    ) : '';

    html += '<div class="card" id="character-card">' +
      (cardBadges ? '<div class="character-card-badges">' + cardBadges + '</div>' : '') +
      '<p class="result-label page-title">Your Character</p>' +
      '<p class="race-line">' + (state.race || '???') + '</p>' +
      '<p class="race-tag">' + (state.primary ? 'Race, eligible for ' + state.primary : 'Race') + '</p>' +
      '<div class="trio">' +
        '<div class="class-slot is-primary"><span class="n">Primary</span>' + (state.primary || '???') + '</div>' +
        '<div class="class-slot"><span class="n">Secondary</span>' + (state.secondary || '???') + '</div>' +
        '<div class="class-slot"><span class="n">Tertiary</span>' + (state.tertiary || '???') + '</div>' +
      '</div>' +
      (!state.primary
        ? '<p class="note">Click Randomize! or Create Manually to draw your character.</p>'
        : state.locked && !state.confirmingDeath && !state.confirmingDing
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

    if (state.locked && state.confirmingDing) {
      var autoLevelKnownForDing = state.watching && state.currentDetectedLevel;
      html += '<div class="card" style="max-width:320px;margin:0 auto 16px;">' +
        (autoLevelKnownForDing
          ? '<label class="field-label">Current Level</label>' +
            '<p style="text-align:center;font-size:20px;font-weight:700;margin:4px 0 2px;">' + escapeHtml(state.currentDetectedLevel) + '</p>' +
            '<p class="hint">Detected automatically from your log file.</p>'
          : '<label class="field-label">Current Level</label>' +
            '<select id="in-ding-level">' +
              '<option value="" disabled' + (state.dingLevel ? '' : ' selected') + '>Select level</option>' +
              Array.from({ length: 50 }, function (_, i) { return i + 1; }).map(function (lvl) {
                return '<option value="' + lvl + '"' + (String(lvl) === String(state.dingLevel) ? ' selected' : '') + '>' + lvl + '</option>';
              }).join('') +
            '</select>') +
        '<p class="hint">Level 50 completes this character (counts as a finished run on the leaderboard). Any other level just updates your live standing.</p>' +
        '<div class="actions">' +
          '<button class="btn btn-ding" id="btn-confirm-ding"' + (state.resolving ? ' disabled' : '') + '>Confirm</button>' +
          '<button class="btn btn-ghost" id="btn-cancel-ding">Cancel</button>' +
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
          ? ((state.confirmingDeath || state.confirmingDing) ? ''
              : state.hardcore
                ? '<button class="btn btn-died" id="btn-died"' + (state.resolving ? ' disabled' : '') + '>I Died</button>' +
                  '<button class="btn btn-ding" id="btn-ding"' + (state.resolving ? ' disabled' : '') + '>Ding!</button>'
                : '<button class="btn btn-primary" id="btn-roll-again"' + (state.resolving ? ' disabled' : '') + '>Roll Again</button>')
          : '<button class="btn btn-primary" id="btn-roll"' + (state.rolling ? ' disabled' : '') + '>' + (state.rolling ? 'Randomizing…' : 'Randomize!') + '</button>' +
            '<button class="btn btn-ghost" id="btn-manual-mode">Create Manually</button>') +
      '</div>';
    }

    if (!state.locked && !state.manualMode) {
      html += '<div class="toggles-row">' +
        '<label class="toggle" title="' + escapeHtml(MODE_DESCRIPTIONS.hardcore) + '"><input type="checkbox" id="in-hardcore"' + (state.hardcoreMode ? ' checked' : '') + ' /> Hardcore</label>' +
        '<label class="toggle" title="' + escapeHtml(MODE_DESCRIPTIONS.ssf) + '"><input type="checkbox" id="in-ssf"' + (state.ssfToggle ? ' checked' : '') + ' /> SSF</label>' +
        '<label class="toggle" title="' + escapeHtml(MODE_DESCRIPTIONS.path) + '"><input type="checkbox" id="in-path"' + (state.pathToggle ? ' checked' : '') + ' /> Random Leveling Path</label>' +
        '<label class="toggle" title="' + escapeHtml(MODE_DESCRIPTIONS.d4) + '"><input type="checkbox" id="in-d4"' + (state.d4Toggle ? ' checked' : '') + ' /> D4 Only</label>' +
      '</div>' +
      '<p class="hint">* Only Hardcore characters are eligible for the leaderboard</p>';
    } else if (!state.locked && state.manualMode) {
      html += '<div class="toggles-row">' +
        '<label class="toggle" title="' + escapeHtml(MODE_DESCRIPTIONS.ssf) + '"><input type="checkbox" id="in-ssf"' + (state.ssfToggle ? ' checked' : '') + ' /> SSF</label>' +
        '<label class="toggle" title="' + escapeHtml(MODE_DESCRIPTIONS.path) + '"><input type="checkbox" id="in-path"' + (state.pathToggle ? ' checked' : '') + ' /> Random Leveling Path</label>' +
        '<label class="toggle" title="' + escapeHtml(MODE_DESCRIPTIONS.d4) + '"><input type="checkbox" id="in-d4"' + (state.d4Toggle ? ' checked' : '') + ' /> D4 Only</label>' +
      '</div>';
    }

    html += renderChatCard();

    if (state.locked && state.hasPath && state.levelingPath) {
      html += '<div class="card"><h3>Leveling Path</h3><ul class="path-list">' +
        state.levelingPath.map(function (b) {
          return '<li><span class="path-range">' + escapeHtml(b.range) + '</span><span>' + escapeHtml(formatPathZone(b, state.levelingPath)) + '</span></li>';
        }).join('') +
      '</ul></div>';
    }

    var watchBadge = state.watching
      ? '<span class="status-pill on">&#128065; Watching log file' + (state.currentDetectedLevel ? ' · detected level ' + state.currentDetectedLevel : '') + '</span>'
      : '<span class="status-pill off">&#9888; Not watching a log file — set one up in Settings</span>';
    var groupBadge = state.groupName
      ? '<span class="status-pill on">&#128101; Group: ' + escapeHtml(state.groupName) + '</span>'
      : '<span class="status-pill off">&#128100; Local only — no group set</span>';
    html += '<div class="badges-row">' + watchBadge + groupBadge + '</div>';

    return html;
  }

  // Must stay in sync with CHAT_COLORS in the realtime worker — it
  // validates against its own copy and falls back to the first entry
  // for anything it doesn't recognize.
  var CHAT_COLORS = [
    { value: '#2A2016', label: 'Ink' },
    { value: '#8C3B2A', label: 'Ember' },
    { value: '#A85A1F', label: 'Rust' },
    { value: '#8A6A22', label: 'Bronze' },
    { value: '#4B5A3A', label: 'Moss' },
    { value: '#1F6B6B', label: 'Teal' },
    { value: '#2C4A7C', label: 'Blue' },
    { value: '#6B3A7C', label: 'Violet' },
    { value: '#9B2242', label: 'Crimson' }
  ];

  var CHAT_MAX_MESSAGES = 200;

  // Separate from the notification sounds (which live in the toast
  // window) — chat arrives in this window, so it plays here.
  var chatPopSound = new Audio('sounds/chat_pop.wav');

  function playChatPop() {
    // Follows the same Notification Sounds toggle and volume slider, so
    // muting the app mutes everything rather than leaving one stray
    // sound the user can't find a switch for.
    if (!state.soundsEnabled) return;
    try {
      chatPopSound.volume = Math.max(0, Math.min(1, 0.6 * (typeof state.notificationVolume === 'number' ? state.notificationVolume : 1)));
      chatPopSound.currentTime = 0;
      chatPopSound.play().catch(function () { /* autoplay quirk — not worth surfacing */ });
    } catch (e) { /* ignore playback errors */ }
  }

  function renderChatCard() {
    // Chat is group-scoped by definition — with no group there's nobody
    // to talk to, so the card explains that rather than offering a dead
    // input box.
    if (!state.groupName) {
      return '<div class="card">' +
        '<h3>Group Chat</h3>' +
        '<p class="hint">Set a Group Name in Settings to chat with your group.</p>' +
      '</div>';
    }

    var body = state.chatMessages.length === 0
      ? '<p class="empty-text">No messages yet — say hello!</p>'
      : state.chatMessages.map(function (m) {
          var t = formatChatTime(m.time);
          if (m.system) {
            var kindClass = m.kind === 'achievement' ? ' chat-achievement'
              : m.kind === 'notable' ? ' chat-notable' : '';
            return '<div class="chat-line chat-system' + kindClass + '">' +
              '<span class="chat-time">' + escapeHtml(t) + '</span>' +
              '<span class="chat-text">' + highlightMeta(m.text, m.meta) + '</span>' +
            '</div>';
          }
          var colorAttr = m.color ? ' style="color:' + escapeHtml(m.color) + ';"' : '';
          return '<div class="chat-line">' +
            '<span class="chat-time">' + escapeHtml(t) + '</span>' +
            '<span class="chat-from"' + colorAttr + '>' + escapeHtml(m.from) + ':</span>' +
            '<span class="chat-text">' + escapeHtml(m.text) + '</span>' +
          '</div>';
        }).join('');

    var online = state.chatOnlineUsers || [];
    var offline = state.chatOfflineUsers || [];

    function rosterList(names, offlineStyle) {
      if (!names.length) return '<p class="chat-online-empty">' + (offlineStyle ? 'Nobody' : 'Nobody else online') + '</p>';
      return names.map(function (u) {
        var mine = u === state.username;
        return '<div class="chat-online-user' + (mine ? ' chat-mine' : '') + (offlineStyle ? ' is-offline' : '') + '">' +
          '<span class="chat-online-dot' + (offlineStyle ? ' offline' : '') + '"></span>' + escapeHtml(u) +
        '</div>';
      }).join('');
    }

    return '<div class="card">' +
      '<h3>Group Chat — ' + escapeHtml(state.groupName) + '</h3>' +
      '<div class="chat-body">' +
        '<div class="chat-scroll" id="chat-scroll">' + body + '</div>' +
        '<div class="chat-online">' +
          '<div class="chat-online-title">Online (' + online.length + ')</div>' +
          rosterList(online, false) +
          (offline.length
            ? '<div class="chat-online-title chat-offline-title">Offline (' + offline.length + ')</div>' + rosterList(offline, true)
            : '') +
        '</div>' +
      '</div>' +
      '<div class="chat-input-row">' +
        (state.emojiPickerOpen
          ? '<div class="chat-emoji-panel" id="emoji-panel">' +
              window.EQL_EMOJI.list.map(function (e) {
                return '<button type="button" class="emoji-pick" data-emoji="' + escapeHtml(e.c) + '"' +
                  ' title="' + escapeHtml(e.c + '  :' + e.s + ':') + '">' + e.c + '</button>';
              }).join('') +
            '</div>'
          : '') +
        '<input type="text" id="in-chat" maxlength="500" placeholder="Message your group…" value="' + escapeHtml(state.chatInput) + '" />' +
        '<button type="button" class="chat-emoji-btn" id="btn-emoji" title="Emoji">&#128512;</button>' +
        '<button class="btn btn-primary" id="btn-chat-send">Send</button>' +
      '</div>' +
      '<div class="chat-controls-row">' +
        '<span class="chat-swatches" title="Your chat name color">' +
          CHAT_COLORS.map(function (col) {
            return '<button type="button" class="chat-swatch' + (state.chatColor === col.value ? ' selected' : '') + '"' +
              ' data-color="' + col.value + '" title="Name color: ' + escapeHtml(col.label) + '"' +
              ' style="background:' + col.value + ';"></button>';
          }).join('') +
        '</span>' +
        '<label class="chat-opacity-label" for="in-overlay-opacity">Opacity</label>' +
        '<input type="range" id="in-overlay-opacity" min="20" max="100" value="' + Math.round(state.chatOverlayOpacity * 100) + '" />' +
        '<span class="chat-opacity-value" id="overlay-opacity-value">' + Math.round(state.chatOverlayOpacity * 100) + '%</span>' +
        '<button class="btn btn-ghost chat-action-btn' + (state.chatOverlayOpen ? ' active' : '') + '" id="btn-chat-overlay">' +
          (state.chatOverlayOpen ? 'Close' : 'Overlay') +
        '</button>' +
      '</div>' +
    '</div>';
  }

  // Escapes the message, then wraps a known substring (currently the NPC
  // name on notable kills) so it can be styled. Both the haystack and the
  // Wraps known substrings (the NPC name, and the "Difficulty N" tag) so
  // each can be styled. Ranges are collected against the ESCAPED text and
  // applied in order, so inserting markup for one can't shift the offsets
  // of the other.
  function highlightMeta(text, meta) {
    var safe = escapeHtml(text);
    if (!meta) return safe;

    var ranges = [];
    function addRange(needleRaw, cls, inlineColor) {
      if (!needleRaw) return;
      var needle = escapeHtml(needleRaw);
      var idx = safe.indexOf(needle);
      if (idx === -1) return;
      ranges.push({ start: idx, end: idx + needle.length, cls: cls, color: inlineColor || null });
    }

    // The player's own chosen chat color is applied inline, since it's a
    // per-person value rather than one of a fixed set of classes.
    // A kill can credit several players, so colour each name with that
    // person's own choice. Single-player kills still use meta.player.
    if (meta.players && meta.players.length) {
      meta.players.forEach(function (name) {
        addRange(name, 'chat-player', (meta.playerColors || {})[name] || null);
      });
    } else {
      addRange(meta.player, 'chat-player', meta.playerColor);
    }
    addRange(meta.npc, 'chat-npc');
    if (typeof meta.difficulty === 'number') {
      addRange('Difficulty ' + meta.difficulty, 'chat-diff chat-diff-' + meta.difficulty);
    }
    if (!ranges.length) return safe;

    ranges.sort(function (a, b) { return a.start - b.start; });
    var out = '';
    var cursor = 0;
    ranges.forEach(function (r) {
      if (r.start < cursor) return; // overlapping — skip rather than corrupt
      var style = r.color ? ' style="color:' + escapeHtml(r.color) + ';"' : '';
      out += safe.slice(cursor, r.start) +
        '<span class="' + r.cls + '"' + style + '>' + safe.slice(r.start, r.end) + '</span>';
      cursor = r.end;
    });
    return out + safe.slice(cursor);
  }

  function formatChatTime(iso) {
    try {
      var d = new Date(iso);
      var h = d.getHours(), m = d.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    } catch (e) { return ''; }
  }

  function pushChatMessage(msg) {
    state.chatMessages.push(msg);
    if (state.chatMessages.length > CHAT_MAX_MESSAGES) {
      state.chatMessages = state.chatMessages.slice(-CHAT_MAX_MESSAGES);
    }
  }

  function renderLeaderboardView() {
    var html = '<div class="card"><h3 class="page-title">Leaderboard</h3>' +
      '<p class="hint" style="margin:-6px 0 14px;">Showing: ' + (state.groupName ? escapeHtml(state.groupName) : 'Local') + '</p>';
    var visibleLb = state.leaderboard.filter(function (row) { return !!row.manualBuild === (state.lbTab === 'manual'); });

    var filtersActive = !!(state.lbFilterClass || state.lbFilterStatus || state.lbFilterSSF || state.lbFilterPath || state.lbFilterD4);
    if (state.lbFilterClass) {
      visibleLb = visibleLb.filter(function (row) { return row.primary === state.lbFilterClass; });
    }
    if (state.lbFilterStatus) {
      visibleLb = visibleLb.filter(function (row) { return row.status === state.lbFilterStatus; });
    }
    if (state.lbFilterSSF) {
      visibleLb = visibleLb.filter(function (row) { return !!row.ssf; });
    }
    if (state.lbFilterPath) {
      visibleLb = visibleLb.filter(function (row) { return !!row.pathMode; });
    }
    if (state.lbFilterD4) {
      visibleLb = visibleLb.filter(function (row) { return !!row.d4; });
    }

    html +=
      '<div class="auth-tabs" style="margin-bottom:10px;">' +
        '<button class="auth-tab' + (state.lbTab === 'randomized' ? ' active' : '') + '" id="tab-lb-randomized" type="button">Randomized</button>' +
        '<button class="auth-tab' + (state.lbTab === 'manual' ? ' active' : '') + '" id="tab-lb-manual" type="button">Manual</button>' +
      '</div>' +
      '<div class="lb-filters">' +
        '<div class="field" style="margin-bottom:0;">' +
          '<label class="field-label">Primary Class</label>' +
          '<select id="in-lb-filter-class">' +
            '<option value=""' + (!state.lbFilterClass ? ' selected' : '') + '>Any</option>' +
            CLASSES.map(function (c) { return '<option value="' + escapeHtml(c) + '"' + (state.lbFilterClass === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div class="field lb-filter-status-field" style="margin-bottom:0;">' +
          '<label class="field-label">Status</label>' +
          '<select id="in-lb-filter-status">' +
            '<option value=""' + (!state.lbFilterStatus ? ' selected' : '') + '>Any</option>' +
            '<option value="alive"' + (state.lbFilterStatus === 'alive' ? ' selected' : '') + '>Alive</option>' +
            '<option value="dead"' + (state.lbFilterStatus === 'dead' ? ' selected' : '') + '>Dead</option>' +
          '</select>' +
        '</div>' +
        '<label class="toggle lb-filter-toggle"><input type="checkbox" id="in-lb-filter-ssf"' + (state.lbFilterSSF ? ' checked' : '') + ' /> SSF Only</label>' +
        '<label class="toggle lb-filter-toggle"><input type="checkbox" id="in-lb-filter-path"' + (state.lbFilterPath ? ' checked' : '') + ' /> Leveling Path Only</label>' +
        '<label class="toggle lb-filter-toggle"><input type="checkbox" id="in-lb-filter-d4"' + (state.lbFilterD4 ? ' checked' : '') + ' /> D4 Only</label>' +
      '</div>' +
      '<div class="list-scroll">' +
      (visibleLb.length === 0
        ? '<p class="empty-text">' + (filtersActive ? 'No entries match your filters.' : 'No completed ' + (state.lbTab === 'manual' ? 'manually-built' : 'randomized') + ' Hardcore runs yet.') + '</p>'
        : visibleLb.map(function (row, i) { return renderLbRow(row, i + 1); }).join('')) +
      '</div></div>';
    return html;
  }

  function renderLogView() {
    var html = '<div class="card"><h3 class="page-title">Adventure Log</h3>' +
      '<p class="hint" style="margin:-6px 0 14px;">Showing: ' + (state.groupName ? escapeHtml(state.groupName) : 'Local') + '</p>';
    var visibleLog = state.log.filter(function (entry) {
      if (entry.type === 'cleared') return true; // a clear event applies to the whole log, not one tab
      if (entry.type === 'achievement') return false; // announced in chat only, by request
      if (entry.type === 'aa') return false;
      if (entry.type === 'levelup' && entry.level % 10 !== 0) return false;
      return !!entry.manualBuild === (state.logTab === 'manual');
    });
    html +=
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

  function renderInstructionsView() {
    return '<div class="card"><h3 class="page-title">Instructions</h3>' +
      '<p class="hint">Coming soon.</p>' +
    '</div>';
  }

  var updateCooldownTimer = null;

  // Only ticks while a cooldown is actually active — starts on click,
  // clears itself the moment the cooldown expires, so it's not running
  // in the background the rest of the time.
  function startUpdateCooldownTicker() {
    if (updateCooldownTimer) return; // already running
    updateCooldownTimer = setInterval(function () {
      if (Date.now() >= state.updateCheckCooldownUntil) {
        clearInterval(updateCooldownTimer);
        updateCooldownTimer = null;
      }
      if (state.view === 'settings') render();
    }, 1000);
  }

  function renderUpdateStatus() {
    var s = state.updateStatus || { status: 'idle' };
    var cooldownRemaining = Math.max(0, Math.ceil((state.updateCheckCooldownUntil - Date.now()) / 1000));
    var checkBtnDisabled = cooldownRemaining > 0;
    var checkBtnLabel = checkBtnDisabled ? 'Check for Updates (' + cooldownRemaining + 's)' : 'Check for Updates';

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
        '<button class="btn btn-ding btn-full" id="btn-install-update">Restart & Install Now</button>';
    }
    if (s.status === 'error') {
      return '<p class="error-text">Could not check for updates: ' + escapeHtml(s.errorMessage || 'Unknown error') + '</p>' +
        '<button class="btn btn-blue btn-full" id="btn-check-update"' + (checkBtnDisabled ? ' disabled' : '') + '>' + checkBtnLabel + '</button>';
    }
    // 'idle' or 'not-available'
    return '<p class="hint">You\'re on the latest version.</p>' +
      '<button class="btn btn-blue btn-full" id="btn-check-update"' + (checkBtnDisabled ? ' disabled' : '') + '>' + checkBtnLabel + '</button>';
  }

  function renderSettingsView() {
    return (
      '<div class="card">' +
        '<h3>Settings</h3>' +
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
        '<p class="hint hint-left hint-under-field">This is auto-suggested from the log file name, but double-check it matches your character\'s exact name.</p>' +
        '<div class="field">' +
          '<label class="field-label">Group Name</label>' +
          '<input type="text" id="in-group-name" value="' + escapeHtml(state.groupInput) + '" placeholder="Leave blank for local only"' + (state.locked ? ' disabled' : '') + ' />' +
        '</div>' +
        (state.locked
          ? '<p class="hint hint-left hint-under-field" style="color:var(--ember);">You have an active character right now — resolve it first (die, ding, or Roll Again) before changing your group, so its outcome doesn\'t get split across two different groups\' logs.</p>'
          : '<p class="hint hint-left hint-under-field">Type any name you want.  Anyone who enters the exact same group name (not case-sensitive) will share Leaderboard, Adventure Log, and Notifications.  Leaving this blank will keep everything local to you.</p>') +
        '<button class="btn btn-primary btn-full" id="btn-save-settings" style="margin-top:10px;">' + (state.settingsSaved ? 'Saved ✓' : 'Save Settings') + '</button>' +
        '<div style="text-align:center;margin-top:12px;">' +
          (state.watching
            ? '<span class="status-pill on">&#128065; Currently watching</span>'
            : '<span class="status-pill off">Not watching yet</span>') +
        '</div>' +
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
        '<p class="hint hint-left">If you choose "Quit" the app stops monitoring your log file and you\'ll need to reopen the app.</p>' +
        '<label class="toggle" style="margin-top:12px;"><input type="checkbox" id="in-notifications-enabled"' + (state.notificationsEnabled ? ' checked' : '') + ' /> Notifications</label>' +
        '<p class="hint hint-left">Turn off to disable all notifications.</p>' +
        '<label class="toggle" style="margin-top:6px;"><input type="checkbox" id="in-sounds-enabled"' + (state.soundsEnabled ? ' checked' : '') + (state.notificationsEnabled ? '' : ' disabled') + ' /> Notification Sounds</label>' +
        '<p class="hint hint-left">Turn this off to keep the visual toasts, but disable the sounds they make.' + (state.notificationsEnabled ? '' : ' (Notifications are off, so this has no effect right now.)') + '</p>' +
        '<div class="field" style="margin-top:6px;">' +
          '<label class="field-label">Notification Volume — <span id="volume-pct-label">' + Math.round(state.notificationVolume * 100) + '%</span></label>' +
          '<input type="range" id="in-notification-volume" min="0" max="100" value="' + Math.round(state.notificationVolume * 100) + '"' + ((state.notificationsEnabled && state.soundsEnabled) ? '' : ' disabled') + ' style="width:100%;" />' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">Notification Position</label>' +
          '<select id="in-notification-position"' + (state.notificationsEnabled ? '' : ' disabled') + '>' +
            NOTIFICATION_POSITIONS.map(function (p) {
              return '<option value="' + p.value + '"' + (state.notificationPosition === p.value ? ' selected' : '') + '>' + escapeHtml(p.label) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
      '</div>'
    );
  }

  function renderAdminView() {
    return (
      '<div class="card">' +
        '<h3>Admin</h3>' +
        '<p class="hint">Clearing either of these only affects ' + (state.groupName ? 'your current group, "' + escapeHtml(state.groupName) + '"' : 'your local-only data') + ' — other groups (and anyone in a different group) are untouched. No passcode needed anymore — just type your group\'s name to confirm.</p>' +
        (!state.confirmingClear
          ? '<div class="actions">' +
              '<button class="btn btn-ghost" id="btn-clear-log" type="button">Clear Log for ' + (state.groupName ? 'My Group' : 'Me') + '</button>' +
              '<button class="btn btn-ghost" id="btn-clear-lb" type="button">Clear Leaderboard for ' + (state.groupName ? 'My Group' : 'Me') + '</button>' +
            '</div>'
          : (function () {
              var expected = state.groupName || '(local only)';
              return '<div class="field">' +
                '<label class="field-label">Type "' + escapeHtml(expected) + '" to Confirm Clearing the ' + (state.confirmingClear === 'log' ? 'Log' : 'Leaderboard') + '</label>' +
                '<input type="text" id="in-clear-confirm" value="' + escapeHtml(state.clearInput) + '" autocomplete="off" placeholder="' + escapeHtml(expected) + '"' + (state.clearBusy ? ' disabled' : '') + ' />' +
                (state.clearError ? '<p class="error-text">' + escapeHtml(state.clearError) + '</p>' : '') +
                '<div class="actions">' +
                  '<button class="btn btn-died" id="btn-confirm-clear"' + (state.clearBusy ? ' disabled' : '') + '>' + (state.clearBusy ? 'Clearing…' : 'Confirm Clear') + '</button>' +
                  '<button class="btn btn-ghost" id="btn-cancel-clear"' + (state.clearBusy ? ' disabled' : '') + '>Cancel</button>' +
                '</div>' +
              '</div>';
            })()) +
      '</div>' +
      '<div class="card">' +
        '<h3>Server</h3>' +
        '<p class="hint">Connected to: ' + escapeHtml(state.apiBaseUrl) + '</p>' +
      '</div>'
    );
  }

  function bindAppEvents() {
    var logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

    document.querySelectorAll('.links-bar-item').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var idx = Number(el.getAttribute('data-link-index'));
        var link = USEFUL_LINKS[idx];
        if (link) window.eqlApp.openExternalLink(link.url);
      });
    });

    ['randomizer', 'leaderboard', 'log', 'instructions', 'settings', 'admin'].forEach(function (view) {
      var btn = document.getElementById('nav-' + view);
      if (btn) btn.addEventListener('click', function () {
        state.view = view;
        if (view === 'settings') state.settingsSaved = false;
        render();
      });
    });

    var rollBtn = document.getElementById('btn-roll');
    if (rollBtn) rollBtn.addEventListener('click', handleRoll);
    var hcCheckbox = document.getElementById('in-hardcore');
    if (hcCheckbox) hcCheckbox.addEventListener('change', function (e) { state.hardcoreMode = e.target.checked; });
    var pathCheckbox = document.getElementById('in-path');
    if (pathCheckbox) pathCheckbox.addEventListener('change', function (e) { state.pathToggle = e.target.checked; });
    var ssfCheckbox = document.getElementById('in-ssf');
    if (ssfCheckbox) ssfCheckbox.addEventListener('change', function (e) { state.ssfToggle = e.target.checked; });
    var d4Checkbox = document.getElementById('in-d4');
    if (d4Checkbox) d4Checkbox.addEventListener('change', function (e) { state.d4Toggle = e.target.checked; });

    var diedBtn = document.getElementById('btn-died');
    if (diedBtn) diedBtn.addEventListener('click', function () {
      state.confirmingDeath = true;
      state.deathLevel = (state.watching && state.currentDetectedLevel) ? String(state.currentDetectedLevel) : '';
      render();
    });
    var dingBtn = document.getElementById('btn-ding');
    if (dingBtn) dingBtn.addEventListener('click', function () {
      state.confirmingDing = true;
      state.dingLevel = (state.watching && state.currentDetectedLevel) ? String(state.currentDetectedLevel) : '';
      render();
    });
    var rollAgainBtn = document.getElementById('btn-roll-again');
    if (rollAgainBtn) rollAgainBtn.addEventListener('click', handleRollAgain);

    var deathLevelSel = document.getElementById('in-death-level');
    if (deathLevelSel) deathLevelSel.addEventListener('change', function (e) { state.deathLevel = e.target.value; });
    var confirmDeathBtn = document.getElementById('btn-confirm-death');
    if (confirmDeathBtn) confirmDeathBtn.addEventListener('click', handleConfirmDeath);
    var cancelDeathBtn = document.getElementById('btn-cancel-death');
    if (cancelDeathBtn) cancelDeathBtn.addEventListener('click', function () { state.confirmingDeath = false; render(); });

    var dingLevelSel = document.getElementById('in-ding-level');
    if (dingLevelSel) dingLevelSel.addEventListener('change', function (e) { state.dingLevel = e.target.value; });
    var confirmDingBtn = document.getElementById('btn-confirm-ding');
    if (confirmDingBtn) confirmDingBtn.addEventListener('click', handleConfirmDing);
    var cancelDingBtn = document.getElementById('btn-cancel-ding');
    if (cancelDingBtn) cancelDingBtn.addEventListener('click', function () { state.confirmingDing = false; render(); });

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

    var chatInput = document.getElementById('in-chat');
    if (chatInput) {
      chatInput.addEventListener('input', function (e) { state.chatInput = e.target.value; });
      chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); handleSendChat(); }
      });
    }
    var chatSendBtn = document.getElementById('btn-chat-send');
    if (chatSendBtn) chatSendBtn.addEventListener('click', handleSendChat);

    var emojiBtn = document.getElementById('btn-emoji');
    if (emojiBtn) emojiBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.emojiPickerOpen = !state.emojiPickerOpen;
      render();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.emoji-pick'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var input = document.getElementById('in-chat');
        var emoji = btn.getAttribute('data-emoji');
        if (!input) return;
        // Insert at the caret rather than appending, and update the DOM
        // directly — a re-render here would lose the caret position.
        var start = input.selectionStart == null ? input.value.length : input.selectionStart;
        var end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
        input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
        state.chatInput = input.value;
        var caret = start + emoji.length;
        input.focus();
        input.setSelectionRange(caret, caret);
      });
    });

    var emojiPanel = document.getElementById('emoji-panel');
    if (emojiPanel) emojiPanel.addEventListener('click', function (e) { e.stopPropagation(); });

    var opacitySlider = document.getElementById('in-overlay-opacity');
    if (opacitySlider) {
      var opacityLabel = document.getElementById('overlay-opacity-value');
      opacitySlider.addEventListener('input', async function (e) {
        // Applied live so the effect is visible while dragging, but the
        // label is updated directly rather than via render() — a full
        // re-render mid-drag would drop the slider's focus.
        var v = Number(e.target.value) / 100;
        state.chatOverlayOpacity = v;
        if (opacityLabel) opacityLabel.textContent = Math.round(v * 100) + '%';
        await window.eqlApp.setChatOverlayOpacity(v);
      });
    }

    var overlayBtn = document.getElementById('btn-chat-overlay');
    if (overlayBtn) overlayBtn.addEventListener('click', async function () {
      var res = await window.eqlApp.toggleChatOverlay();
      state.chatOverlayOpen = !!(res && res.open);
      render();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.chat-swatch'), function (btn) {
      btn.addEventListener('click', async function () {
        state.chatColor = btn.getAttribute('data-color');
        await window.eqlApp.saveSettings({ chatColor: state.chatColor });
        render();
      });
    });

    // Keep the transcript pinned to the newest message after each render.
    var chatScroll = document.getElementById('chat-scroll');
    if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;

    var lbTabRandomized = document.getElementById('tab-lb-randomized');
    if (lbTabRandomized) lbTabRandomized.addEventListener('click', function () { state.lbTab = 'randomized'; render(); });
    var lbTabManual = document.getElementById('tab-lb-manual');
    if (lbTabManual) lbTabManual.addEventListener('click', function () { state.lbTab = 'manual'; render(); });

    var lbFilterClassSel = document.getElementById('in-lb-filter-class');
    if (lbFilterClassSel) lbFilterClassSel.addEventListener('change', function (e) { state.lbFilterClass = e.target.value; render(); });
    var lbFilterStatusSel = document.getElementById('in-lb-filter-status');
    if (lbFilterStatusSel) lbFilterStatusSel.addEventListener('change', function (e) { state.lbFilterStatus = e.target.value; render(); });
    var lbFilterSSFCheckbox = document.getElementById('in-lb-filter-ssf');
    if (lbFilterSSFCheckbox) lbFilterSSFCheckbox.addEventListener('change', function (e) { state.lbFilterSSF = e.target.checked; render(); });
    var lbFilterPathCheckbox = document.getElementById('in-lb-filter-path');
    if (lbFilterPathCheckbox) lbFilterPathCheckbox.addEventListener('change', function (e) { state.lbFilterPath = e.target.checked; render(); });
    var lbFilterD4Checkbox = document.getElementById('in-lb-filter-d4');
    if (lbFilterD4Checkbox) lbFilterD4Checkbox.addEventListener('change', function (e) { state.lbFilterD4 = e.target.checked; render(); });

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

    var groupInput = document.getElementById('in-group-name');
    if (groupInput) groupInput.addEventListener('input', function (e) { state.groupInput = e.target.value; state.settingsSaved = false; });

    var closeBehaviorSel = document.getElementById('in-close-behavior');
    if (closeBehaviorSel) closeBehaviorSel.addEventListener('change', async function (e) {
      state.closeBehavior = e.target.value;
      await window.eqlApp.saveSettings({ closeBehavior: state.closeBehavior });
      render();
    });

    var notificationsEnabledCheckbox = document.getElementById('in-notifications-enabled');
    if (notificationsEnabledCheckbox) notificationsEnabledCheckbox.addEventListener('change', async function (e) {
      state.notificationsEnabled = e.target.checked;
      await window.eqlApp.saveSettings({ notificationsEnabled: state.notificationsEnabled });
      render();
    });

    var soundsEnabledCheckbox = document.getElementById('in-sounds-enabled');
    if (soundsEnabledCheckbox) soundsEnabledCheckbox.addEventListener('change', async function (e) {
      state.soundsEnabled = e.target.checked;
      await window.eqlApp.saveSettings({ soundsEnabled: state.soundsEnabled });
      render();
    });

    var volumeSlider = document.getElementById('in-notification-volume');
    if (volumeSlider) {
      var volumeLabel = document.getElementById('volume-pct-label');
      volumeSlider.addEventListener('input', function (e) {
        // Live label update while dragging — no save yet, avoids writing
        // to disk on every pixel of drag movement.
        if (volumeLabel) volumeLabel.textContent = e.target.value + '%';
      });
      volumeSlider.addEventListener('change', async function (e) {
        state.notificationVolume = Number(e.target.value) / 100;
        await window.eqlApp.saveSettings({ notificationVolume: state.notificationVolume });
      });
    }

    var positionSelect = document.getElementById('in-notification-position');
    if (positionSelect) positionSelect.addEventListener('change', async function (e) {
      state.notificationPosition = e.target.value;
      await window.eqlApp.saveSettings({ notificationPosition: state.notificationPosition });
    });

    var checkUpdateBtn = document.getElementById('btn-check-update');
    if (checkUpdateBtn) checkUpdateBtn.addEventListener('click', function () {
      if (Date.now() < state.updateCheckCooldownUntil) return; // guard against any stray double-click
      state.updateStatus = { status: 'checking', version: null, progress: 0, errorMessage: null };
      state.updateCheckCooldownUntil = Date.now() + 30000;
      startUpdateCooldownTicker();
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
    var clearConfirmInput = document.getElementById('in-clear-confirm');
    if (clearConfirmInput) {
      clearConfirmInput.addEventListener('input', function (e) { state.clearInput = e.target.value; });
      clearConfirmInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleConfirmClear(); });
      clearConfirmInput.focus();
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
    state.groupName = data.group || '';
    state.groupInput = data.group || '';

    var settings = await window.eqlApp.saveSettings({
      apiBaseUrl: state.apiBaseUrl,
      token: state.token,
      username: state.username
    });
    state.settingsLogFilePath = settings.logFilePath || '';
    state.settingsCharacterName = settings.characterName || guessCharacterName(settings.logFilePath);
    state.serverName = settings.serverName || guessServerName(settings.logFilePath);

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

  var VALID_SERVERS = ['Qeynos', 'Freeport', 'Oggok', 'Neriak', 'Rivervale', 'Halas', 'Paineel'];

  function guessCharacterName(logPath) {
    if (!logPath) return '';
    var base = logPath.split(/[\\/]/).pop() || '';
    var match = base.match(/^eqlog_([^_]+)_/i);
    return match ? match[1] : '';
  }

  function guessServerName(logPath) {
    if (!logPath) return '';
    var base = logPath.split(/[\\/]/).pop() || '';
    var match = base.match(/^eqlog_[^_]+_([^_.]+)/i);
    if (!match) return '';
    var extracted = match[1];
    var known = VALID_SERVERS.filter(function (s) { return s.toLowerCase() === extracted.toLowerCase(); })[0];
    return known || ''; // unrecognized server name in the filename — leave blank rather than show something wrong
  }

  // ---- Character actions ----

  function handleRoll() {
    if (state.rolling || state.locked) return;
    state.rolling = true;
    render();
    finishRoll();
  }

  async function finishRoll() {
    var res = await apiRequest('/api/roll', { method: 'POST', body: { hardcore: !!state.hardcoreMode, pathMode: !!state.pathToggle, ssf: !!state.ssfToggle, d4: !!state.d4Toggle, server: state.serverName } });
    state.rolling = false;
    if (!res.ok) {
      alert((res.data && res.data.error) || 'Could not randomize right now.');
      applyCharacterFromServer(null);
      render();
      return;
    }
    applyCharacterFromServer(res.data.character);
    render();
    window.eqlApp.notifyCharacterRolled({ d4: state.hasD4, classes: [state.primary, state.secondary, state.tertiary].filter(Boolean), rolledAt: state.rolledAt });
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
      d4: !!state.d4Toggle,
      race: state.manualRace,
      primary: state.manualPrimary,
      secondary: state.manualSecondary,
      tertiary: state.manualTertiary,
      server: state.serverName
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
    window.eqlApp.notifyCharacterRolled({ d4: state.hasD4, classes: [state.primary, state.secondary, state.tertiary].filter(Boolean), rolledAt: state.rolledAt });
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
    window.eqlApp.showNotification('You Died', 'Your character was slain at level ' + levelNum + '.', 'death');
    window.eqlApp.notifyCharacterUnlocked();
    await refreshSharedData();
    render();
  }

  async function handleConfirmDing() {
    if (!state.locked || state.resolving) return;
    var levelNum = Number(state.dingLevel);
    if (!state.dingLevel || !Number.isFinite(levelNum) || levelNum < 1 || levelNum > 50) {
      alert('Select your current level first.');
      return;
    }
    state.resolving = true;
    render();

    if (levelNum === 50) {
      // Same as reaching 50 via auto-detection: completes the character.
      var res = await apiRequest('/api/resolve', { method: 'POST', body: { type: 'ding', manual: true } });
      state.resolving = false;
      if (!res.ok) {
        alert((res.data && res.data.error) || 'Could not record that.');
        render();
        return;
      }
      applyCharacterFromServer(null);
      state.confirmingDing = false;
      render();
      window.eqlApp.showNotification('Ding! Level 50!', 'Your character reached level 50!', 'ding');
      window.eqlApp.notifyCharacterUnlocked();
      await refreshSharedData();
      render();
    } else {
      // Below 50: just a milestone — character stays locked, live
      // leaderboard standing updates, same as an auto-detected level-up.
      var msRes = await apiRequest('/api/milestone', { method: 'POST', body: { type: 'levelup', level: levelNum } });
      state.resolving = false;
      if (!msRes.ok) {
        alert((msRes.data && msRes.data.error) || 'Could not record that.');
        render();
        return;
      }
      state.confirmingDing = false;
      window.eqlApp.showNotification('Level Up!', 'Your character reached level ' + levelNum + '.', 'levelup');
      render();
      await refreshSharedData();
      render();
    }
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
    state.serverName = guessServerName(filePath);
    state.settingsSaved = false;
    render();
  }

  async function handleSaveSettings() {
    var groupChanged = state.groupInput !== state.groupName;
    if (groupChanged && state.locked) {
      alert('You can\'t change your group while you have an active character. Resolve it first (die, ding, or Roll Again), then change your group — otherwise your character\'s death/ding could end up recorded in the wrong group\'s log.');
      return;
    }

    await window.eqlApp.saveSettings({
      logFilePath: state.settingsLogFilePath,
      characterName: state.settingsCharacterName,
      serverName: state.serverName
    });

    if (state.locked && state.serverName) {
      // Covers a real flow: die/ding, roll a new character (its log file
      // doesn't exist yet), then point Settings at the new log file once
      // it appears — meaning the roll itself already recorded whatever
      // server was set at that earlier moment. This corrects the
      // character record so future events (level-ups, the eventual
      // death/ding) show the right server going forward.
      await apiRequest('/api/character-server', { method: 'POST', body: { server: state.serverName } });
    }

    if (groupChanged) {
      var res = await apiRequest('/api/group', { method: 'POST', body: { group: state.groupInput } });
      if (!res.ok) {
        alert((res.data && res.data.error) || 'Could not save that group name.');
        return;
      }
      state.groupName = res.data.group;
      state.groupInput = res.data.group;
      // The group's shared data is a completely different dataset now —
      // reset main's tracking baseline and pull the new group's leaderboard/log.
      window.eqlApp.notifyGroupChanged();
      await refreshSharedData();
    }

    state.settingsSaved = true;
    var status = await window.eqlApp.getWatchStatus();
    state.watching = status.watching;
    state.currentDetectedLevel = status.currentLevel || null;
    render();
  }

  async function handleSendChat() {
    var text = (state.chatInput || '').trim();
    if (!text || !state.groupName) return;
    // :beer: -> 🍺 before it leaves this machine, so recipients and the
    // worker never need to know shortcodes exist.
    text = window.EQL_EMOJI.expand(text);
    state.emojiPickerOpen = false;
    var res = await window.eqlApp.sendChat(text);
    state.chatInput = '';
    if (res && res.ok === false) {
      pushChatMessage({ system: true, text: 'Could not send — not connected to the group right now.', time: new Date().toISOString() });
    }
    render();
    var el = document.getElementById('in-chat');
    if (el) el.focus();
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
    var confirmText = state.clearInput;
    state.clearBusy = true;
    state.clearError = '';
    render();
    var res = await apiRequest('/api/admin/clear', { method: 'POST', body: { target: target, confirmText: confirmText } });
    state.clearBusy = false;
    if (!res.ok) {
      state.clearError = (res.data && res.data.error) || 'That didn\'t match. Nothing was cleared.';
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

  window.eqlApp.onChatMessage(function (msg) {
    pushChatMessage({ from: msg.from, text: msg.text, time: msg.time, color: msg.color });
    // No sound for your own message echoing back — you know you sent it.
    if (msg.from !== state.username) playChatPop();
    render();
  });

  // Click anywhere outside the picker closes it. Registered once at
  // startup rather than inside bindAppEvents, which runs on every render.
  document.addEventListener('click', function () {
    if (state.emojiPickerOpen) {
      state.emojiPickerOpen = false;
      render();
    }
  });

  window.eqlApp.onChatOverlayState(function (open) {
    state.chatOverlayOpen = !!open;
    render();
  });

  window.eqlApp.onChatPresence(function (payload) {
    // Older payloads were a bare array of online users; newer ones carry
    // both lists. Handle both so a version mismatch degrades gracefully.
    if (Array.isArray(payload)) {
      state.chatOnlineUsers = payload;
      state.chatOfflineUsers = [];
    } else {
      state.chatOnlineUsers = (payload && payload.users) || [];
      state.chatOfflineUsers = (payload && payload.offline) || [];
    }
    render();
  });

  window.eqlApp.onChatSystem(function (payload) {
    // Notifications double as a shared record of what happened, so they
    // land in the chat transcript too.
    var text = payload.title + (payload.body ? ' — ' + payload.body : '');
    pushChatMessage({ system: true, text: text, time: payload.time, kind: payload.kind, meta: payload.meta });
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
    state.serverName = settings.serverName || guessServerName(settings.logFilePath);
    state.token = settings.token || null;
    state.username = settings.username || '';
    state.closeBehavior = settings.closeBehavior || 'tray';
    state.soundsEnabled = settings.soundsEnabled !== false;
    state.notificationsEnabled = settings.notificationsEnabled !== false;
    state.notificationVolume = typeof settings.notificationVolume === 'number' ? settings.notificationVolume : 1.0;
    state.notificationPosition = settings.notificationPosition || 'top-middle';
    state.chatColor = settings.chatColor || '#2A2016';
    state.chatOverlayOpacity = typeof settings.chatOverlayOpacity === 'number' ? settings.chatOverlayOpacity : 0.9;

    state.appVersion = await window.eqlApp.getAppVersion();
    state.updateStatus = await window.eqlApp.getUpdateStatus();

    if (state.token && state.apiBaseUrl) {
      var res = await apiRequest('/api/me');
      if (res.ok) {
        applyCharacterFromServer(res.data.currentCharacter);
        state.screen = 'app';
        state.groupName = res.data.group || '';
        state.groupInput = res.data.group || '';
        if (state.locked) {
          window.eqlApp.notifyCharacterLockedSync({ d4: state.hasD4, classes: [state.primary, state.secondary, state.tertiary].filter(Boolean), rolledAt: state.rolledAt });
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
