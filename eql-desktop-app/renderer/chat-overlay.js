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
        return '<div class="line system">' + t + '<span class="text">' + escapeHtml(m.text) + '</span></div>';
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

  function renderOnline(users) {
    users = users || [];
    onlineEl.textContent = users.length
      ? 'Online (' + users.length + '): ' + users.join(', ')
      : 'Online: nobody else';
  }

  function send() {
    var text = (inputEl.value || '').trim();
    if (!text) return;
    inputEl.value = '';
    window.eqlOverlay.sendChat(text).then(function (res) {
      if (res && res.ok === false) {
        push({ system: true, text: 'Could not send — not connected.', time: new Date().toISOString() });
      }
    });
    inputEl.focus();
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
  closeBtn.addEventListener('click', function () { window.eqlOverlay.close(); });

  window.eqlOverlay.onHistory(function (payload) {
    myUsername = payload.username || '';
    messages = (payload.messages || []).slice(-MAX);
    render();
    renderOnline(payload.users);
  });

  window.eqlOverlay.onChatMessage(function (msg) {
    push({ from: msg.from, text: msg.text, time: msg.time, color: msg.color });
  });

  window.eqlOverlay.onChatSystem(function (payload) {
    push({ system: true, text: payload.title + (payload.body ? ' — ' + payload.body : ''), time: payload.time });
  });

  window.eqlOverlay.onChatPresence(function (users) {
    renderOnline(users);
  });
})();
