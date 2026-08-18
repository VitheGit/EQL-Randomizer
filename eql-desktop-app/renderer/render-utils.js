// Shared rendering helpers, loaded by every window that displays chat or
// notification text (the main window, the chat overlay, and the toast
// window). Previously each of these carried its own copy, which meant a
// change had to be made in three places and missing one silently broke
// that window.
(function () {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Wraps known substrings of a notification message so each can be
  // styled — player names (in their own chosen colour), the NPC name, and
  // the "Difficulty N" tag.
  //
  // Ranges are collected against the ESCAPED text and applied in order,
  // so inserting markup for one can't shift the offsets of another. The
  // caller supplies the class names, since the main window prefixes them
  // ("chat-npc") while the overlay and toast don't ("npc").
  function highlightMeta(text, meta, classes) {
    var safe = escapeHtml(text);
    if (!meta) return safe;

    var cls = classes || {};
    var playerClass = cls.player || 'player';
    var npcClass = cls.npc || 'npc';
    var diffClass = cls.diff || 'diff';

    var ranges = [];
    function addRange(needleRaw, className, inlineColor) {
      if (!needleRaw) return;
      var needle = escapeHtml(needleRaw);
      var idx = safe.indexOf(needle);
      if (idx === -1) return;
      ranges.push({ start: idx, end: idx + needle.length, cls: className, color: inlineColor || null });
    }

    // A kill can credit several players, so colour each name with that
    // person's own choice. Single-player events still use meta.player.
    if (meta.players && meta.players.length) {
      meta.players.forEach(function (name) {
        addRange(name, playerClass, (meta.playerColors || {})[name] || null);
      });
    } else {
      addRange(meta.player, playerClass, meta.playerColor);
    }

    addRange(meta.npc, npcClass);
    if (typeof meta.difficulty === 'number') {
      addRange('Difficulty ' + meta.difficulty, diffClass + ' ' + diffClass + '-' + meta.difficulty);
    }
    if (!ranges.length) return safe;

    ranges.sort(function (a, b) { return a.start - b.start; });
    var out = '';
    var cursor = 0;
    ranges.forEach(function (r) {
      if (r.start < cursor) return; // overlapping — skip rather than corrupt the markup
      var style = r.color ? ' style="color:' + escapeHtml(r.color) + ';"' : '';
      out += safe.slice(cursor, r.start) +
        '<span class="' + r.cls + '"' + style + '>' + safe.slice(r.start, r.end) + '</span>';
      cursor = r.end;
    });
    return out + safe.slice(cursor);
  }

  // Short clock time (e.g. "7:05 PM") for chat lines.
  function formatClockTime(iso) {
    try {
      var d = new Date(iso);
      var h = d.getHours();
      var m = d.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12;
      return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    } catch (e) {
      return '';
    }
  }

  window.EQL_RENDER = {
    escapeHtml: escapeHtml,
    highlightMeta: highlightMeta,
    formatClockTime: formatClockTime
  };
})();
