(function () {
  var messagesEl = document.getElementById('messages');
  var onlineEl = document.getElementById('online');
  var inputEl = document.getElementById('msg');
  var sendBtn = document.getElementById('send');
  var closeBtn = document.getElementById('close');

  var messages = [];
  var MAX = 200;
  var myUsername = '';

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatTime(iso) {
    try {
      var d = new Date(iso);
      var h = d.getHours(), m = d.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    } catch (e) { return ''; }
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
        var sysClass = 'line system' + (m.kind === 'achievement' ? ' achievement' : '');
        return '<div class="' + sysClass + '">' + t + '<span class="text">' + escapeHtml(m.text) + '</span></div>';
      }
      // Colors chosen for the light main window can be too dark against
      // this dark panel, so names render in a consistently readable tint
      // rather than the sender's exact palette color.
      var nameStyle = m.from === myUsername ? ' style="color:#E8A87C;"' : ' style="color:#C9B98F;"';
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
    push({ system: true, text: payload.title + (payload.body ? ' — ' + payload.body : ''), time: payload.time, kind: payload.kind });
  });

  window.eqlOverlay.onChatPresence(function (payload) {
    renderOnline(payload);
  });
})();
