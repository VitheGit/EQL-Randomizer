(function () {
  var stack = document.getElementById('stack');
  var counter = 0;

  var ICONS = {
    death: '&#128128;',
    ding: '&#127881;',
    levelup: '&#11088;',
    error: '&#9888;',
    info: '&#128276;',
    update: '&#128260;',
    aa: '&#128142;',
    d4: '&#9888;',
    notable: '&#128481;'
  };

  // Each entry: an Audio object plus its own volume. Keyed by
  // notification kind, so adding another sound later is just one more
  // entry here rather than a new copy-pasted block.
  var SOUNDS = {
    death: { audio: new Audio('sounds/kgb_dth.wav'), volume: 0.5 },
    aa: { audio: new Audio('sounds/aa_gained.wav'), volume: 0.65 },
    levelup: { audio: new Audio('sounds/level_up.mp3'), volume: 0.65 },
    ding: { audio: new Audio('sounds/ding_level50.mp3'), volume: 0.8 },
    d4: { audio: new Audio('sounds/d4_reminder.wav'), volume: 0.6 },
    notable: { audio: new Audio('sounds/notable_kill.wav'), volume: 0.75 }
  };
  Object.keys(SOUNDS).forEach(function (key) {
    SOUNDS[key].audio.volume = SOUNDS[key].volume;
  });

  function playSoundFor(kind, volumeMultiplier) {
    var s = SOUNDS[kind];
    if (!s) return;
    var mult = typeof volumeMultiplier === 'number' ? volumeMultiplier : 1.0;
    // The multiplier scales each sound's own tuned base volume rather
    // than overriding it directly — this keeps e.g. the level-50 ding
    // louder than the AA sparkle at every setting, not just at 100%.
    s.audio.volume = Math.max(0, Math.min(1, s.volume * mult));
    // Rewind first so rapid-fire notifications of the same kind (e.g. a
    // group wipe, or a fast burst of AA gains) each play from the start
    // rather than getting silently dropped while one is still playing.
    try {
      s.audio.currentTime = 0;
      s.audio.play().catch(function () { /* browser autoplay quirks — not worth surfacing to the user */ });
    } catch (e) { /* ignore playback errors */ }
  }

  // Wraps a known substring (the NPC name on notable kills) after
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
        addRange(name, 'player', (meta.playerColors || {})[name] || null);
      });
    } else {
      addRange(meta.player, 'player', meta.playerColor);
    }
    addRange(meta.npc, 'npc');
    if (typeof meta.difficulty === 'number') {
      addRange('Difficulty ' + meta.difficulty, 'diff diff-' + meta.difficulty);
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

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addToast(payload) {
    var id = 'toast-' + (counter++);
    var icon = ICONS[payload.kind] || ICONS.info;

    // Anchor the stack to match where the window sits on screen, so
    // toasts hug the correct edge instead of floating in the middle of
    // the (much taller) transparent notify window.
    var pos = payload.position || 'top-middle';
    stack.classList.remove('anchor-bottom', 'anchor-middle');
    if (pos.indexOf('bottom') === 0) {
      stack.classList.add('anchor-bottom');
    } else if (pos.indexOf('middle') === 0 || pos === 'center') {
      stack.classList.add('anchor-middle');
    }

    if (payload.soundsEnabled !== false) playSoundFor(payload.kind, payload.notificationVolume);

    var el = document.createElement('div');
    el.className = 'toast';
    el.id = id;
    el.innerHTML =
      '<p class="title">' + icon + ' ' + escapeHtml(payload.title || 'EQ Legends Randomizer') + '</p>' +
      '<p class="body">' + highlightMeta(payload.body || '', payload.meta) + '</p>';
    stack.appendChild(el);

    // Force a reflow so the show transition actually animates in.
    void el.offsetWidth;
    el.classList.add('show');

    var lifespan = payload.duration || 6000;
    setTimeout(function () {
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, lifespan);
  }

  window.eqlToast.onShowToast(function (payload) {
    addToast(payload);
  });
})();
