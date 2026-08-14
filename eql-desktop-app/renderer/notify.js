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

  // Each entry: an Audio object plus its own volume. Keyed by
  // notification kind, so adding another sound later is just one more
  // entry here rather than a new copy-pasted block.
  var SOUNDS = {
    death: { audio: new Audio('sounds/kgb_dth.wav'), volume: 0.5 },
    aa: { audio: new Audio('sounds/aa_gained.wav'), volume: 0.65 },
    levelup: { audio: new Audio('sounds/level_up.mp3'), volume: 0.65 },
    ding: { audio: new Audio('sounds/ding_level50.mp3'), volume: 0.8 }
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

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addToast(payload) {
    var id = 'toast-' + (counter++);
    var icon = ICONS[payload.kind] || ICONS.info;

    if (payload.soundsEnabled !== false) playSoundFor(payload.kind, payload.notificationVolume);

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
