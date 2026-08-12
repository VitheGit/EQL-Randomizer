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
    aa: '&#128142;'
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addToast(payload) {
    var id = 'toast-' + (counter++);
    var icon = ICONS[payload.kind] || ICONS.info;

    var el = document.createElement('div');
    el.className = 'toast';
    el.id = id;
    el.innerHTML =
      '<p class="title">' + icon + ' ' + escapeHtml(payload.title || 'EQ Legends Randomizer') + '</p>' +
      '<p class="body">' + escapeHtml(payload.body || '') + '</p>';
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
