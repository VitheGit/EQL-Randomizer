(function () {
  var messagesEl = document.getElementById('messages');
  var onlineEl = document.getElementById('online');
  var inputEl = document.getElementById('msg');
  var sendBtn = document.getElementById('send');
  var closeBtn = document.getElementById('close');

  // Shared with the main and toast windows — see render-utils.js.
  var escapeHtml = window.EQL_RENDER.escapeHtml;
  var formatTime = window.EQL_RENDER.formatClockTime;
  function highlightMeta(text, meta) {
    return window.EQL_RENDER.highlightMeta(text, meta);
  }

  var messages = [];
  var MAX = 200;
  var myUsername = '';

  // The name-color palette was picked to read against the light parchment
  // of the main window. Several of those colors (Ink especially) all but
  // vanish on this dark panel, so each one is lifted to a minimum
  // lightness — and slightly desaturated at the top end so it doesn't
  // glow — while keeping its hue. Someone's blue still reads as blue,
  // just a lighter blue than they see in the main window.
  var MIN_LIGHTNESS = 0.62;

  function lightenForDark(hex) {
    if (!hex || typeof hex !== 'string') return null;
    var m = hex.replace('#', '').trim();
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;

    var r = parseInt(m.slice(0, 2), 16) / 255;
    var g = parseInt(m.slice(2, 4), 16) / 255;
    var b = parseInt(m.slice(4, 6), 16) / 255;

    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }

    if (l >= MIN_LIGHTNESS) return hex; // already bright enough
    l = MIN_LIGHTNESS;
    s = Math.min(s, 0.7);

    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    var rr = s === 0 ? l : hue2rgb(p, q, h + 1 / 3);
    var gg = s === 0 ? l : hue2rgb(p, q, h);
    var bb = s === 0 ? l : hue2rgb(p, q, h - 1 / 3);

    function toHex(v) {
      var n = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
      return n.length === 1 ? '0' + n : n;
    }
    return '#' + toHex(rr) + toHex(gg) + toHex(bb);
  }

  function render() {
    if (!messages.length) {
      messagesEl.innerHTML = '<p class="empty">No messages yet.</p>';
      return;
    }
    // Pin to the newest message unless the user has scrolled up to read
    // back — yanking them to the bottom mid-read would be obnoxious.
    var nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;

    messagesEl.innerHTML = messages.map(function (m) {
      var t = '<span class="time">' + escapeHtml(formatTime(m.time)) + '</span>';
      if (m.system) {
        var sysClass = 'line system' + (m.kind === 'achievement' ? ' achievement'
          : m.kind === 'notable' ? ' notable' : '');
        return '<div class="' + sysClass + '">' + t + '<span class="text">' + highlightMeta(m.text, m.meta) + '</span></div>';
      }
      // Use the sender's chosen color, lifted to stay readable here.
      // Falls back to the old neutral tints when no color is known.
      var lifted = lightenForDark(m.color);
      var fallback = m.from === myUsername ? '#E8A87C' : '#C9B98F';
      var nameStyle = ' style="color:' + escapeHtml(lifted || fallback) + ';"';
      return '<div class="line">' + t +
        '<span class="from"' + nameStyle + '>' + escapeHtml(m.from) + ':</span>' +
        '<span class="text">' + escapeHtml(m.text) + '</span></div>';
    }).join('');

    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function push(m) {
    messages.push(m);
    if (messages.length > MAX) messages = messages.slice(-MAX);
    render();
  }

  function renderOnline(payload) {
    var online = Array.isArray(payload) ? payload : ((payload && payload.users) || []);
    var offline = (payload && !Array.isArray(payload) && payload.offline) || [];
    var parts = [];
    parts.push('<span class="on">Online (' + online.length + ')' + (online.length ? ': ' + escapeHtml(online.join(', ')) : '') + '</span>');
    if (offline.length) {
      parts.push('<span class="off">Offline (' + offline.length + '): ' + escapeHtml(offline.join(', ')) + '</span>');
    }
    onlineEl.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }

  function send() {
    var text = (inputEl.value || '').trim();
    if (!text) return;
    text = window.EQL_EMOJI.expand(text);
    inputEl.value = '';
    emojiPanel.classList.remove('open');
    window.eqlOverlay.sendChat(text).then(function (res) {
      if (res && res.ok === false) {
        push({ system: true, text: 'Could not send — not connected.', time: new Date().toISOString() });
      }
    });
    inputEl.focus();
  }

  // Emoji picker — built once, since the overlay isn't re-rendered.
  var emojiBtn = document.getElementById('emojiBtn');
  var emojiPanel = document.getElementById('emojiPanel');
  window.EQL_EMOJI.list.forEach(function (e) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = e.c;
    b.title = e.c + '  :' + e.s + ':';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var start = inputEl.selectionStart == null ? inputEl.value.length : inputEl.selectionStart;
      var end = inputEl.selectionEnd == null ? inputEl.value.length : inputEl.selectionEnd;
      inputEl.value = inputEl.value.slice(0, start) + e.c + inputEl.value.slice(end);
      var caret = start + e.c.length;
      inputEl.focus();
      inputEl.setSelectionRange(caret, caret);
    });
    emojiPanel.appendChild(b);
  });
  emojiBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    emojiPanel.classList.toggle('open');
  });
  emojiPanel.addEventListener('click', function (ev) { ev.stopPropagation(); });
  document.addEventListener('click', function () { emojiPanel.classList.remove('open'); });

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
  closeBtn.addEventListener('click', function () { window.eqlOverlay.close(); });

  window.eqlOverlay.onHistory(function (payload) {
    myUsername = payload.username || '';
    messages = (payload.messages || []).slice(-MAX);
    render();
    renderOnline(payload.presence);
  });

  window.eqlOverlay.onChatMessage(function (msg) {
    push({ from: msg.from, text: msg.text, time: msg.time, color: msg.color });
  });

  window.eqlOverlay.onChatSystem(function (payload) {
    push({ system: true, text: payload.title + (payload.body ? ' — ' + payload.body : ''), time: payload.time, kind: payload.kind, meta: payload.meta });
  });

  window.eqlOverlay.onChatPresence(function (payload) {
    renderOnline(payload);
  });
})();
