// Shared by the main chat and the overlay so the two can't drift apart.
// Loaded as a plain script before each window's own script, exposing
// EQL_EMOJI on window.
(function () {
  var EMOJI = [
    // Reactions
    { c: '😄', s: 'smile' },      { c: '😁', s: 'grin' },
    { c: '😂', s: 'joy' },        { c: '😉', s: 'wink' },
    { c: '😎', s: 'cool' },       { c: '🤔', s: 'thinking' },
    { c: '😅', s: 'sweat' },      { c: '😢', s: 'cry' },
    { c: '😡', s: 'rage' },       { c: '😱', s: 'scream' },
    { c: '🤷', s: 'shrug' },      { c: '💀', s: 'skull' },
    // Gestures
    { c: '👋', s: 'wave' },       { c: '👍', s: 'thumbsup' },
    { c: '👎', s: 'thumbsdown' }, { c: '👌', s: 'ok' },
    { c: '👏', s: 'clap' },       { c: '🙏', s: 'pray' },
    { c: '💪', s: 'muscle' },     { c: '👀', s: 'eyes' },
    // Emphasis
    { c: '🔥', s: 'fire' },       { c: '⭐', s: 'star' },
    { c: '✨', s: 'sparkles' },   { c: '⚡', s: 'zap' },
    { c: '💥', s: 'boom' },       { c: '🎉', s: 'tada' },
    { c: '❤️', s: 'heart' },      { c: '💔', s: 'brokenheart' },
    { c: '⚠️', s: 'warning' },    { c: '✅', s: 'check' },
    { c: '❌', s: 'x' },          { c: '❓', s: 'question' },
    // Loot & progression
    { c: '🏆', s: 'trophy' },     { c: '🏅', s: 'medal' },
    { c: '👑', s: 'crown' },      { c: '💎', s: 'gem' },
    { c: '💰', s: 'money' },      { c: '📜', s: 'scroll' },
    { c: '🗺️', s: 'map' },        { c: '🔑', s: 'key' },
    // Gear & combat
    { c: '⚔️', s: 'sword' },      { c: '🛡️', s: 'shield' },
    { c: '🏹', s: 'bow' },        { c: '🪄', s: 'wand' },
    { c: '🧪', s: 'potion' },     { c: '🧠', s: 'brain' },
    // Creatures
    { c: '🐉', s: 'dragon' },     { c: '🐺', s: 'wolf' },
    { c: '🐻', s: 'bear' },       { c: '🐀', s: 'rat' },
    { c: '🕷️', s: 'spider' },     { c: '🐍', s: 'snake' },
    { c: '👻', s: 'ghost' },      { c: '💩', s: 'poop' },
    // Misc
    { c: '🍺', s: 'beer' },       { c: '🍕', s: 'pizza' },
    { c: '☕', s: 'coffee' },     { c: '💤', s: 'zzz' },
    { c: '🏃', s: 'run' },        { c: '⏳', s: 'hourglass' },
    { c: '🔔', s: 'bell' },       { c: '🚀', s: 'rocket' }
  ];

  var BY_SHORTCODE = {};
  EMOJI.forEach(function (e) { BY_SHORTCODE[e.s] = e.c; });

  // Turns :beer: into 🍺. Runs on the sender's side, so what goes over
  // the wire is already the emoji itself — no other client or the worker
  // needs to know shortcodes exist.
  function expandShortcodes(text) {
    if (!text || text.indexOf(':') === -1) return text;
    return text.replace(/:([a-z0-9_+-]+):/gi, function (whole, name) {
      var hit = BY_SHORTCODE[String(name).toLowerCase()];
      return hit || whole; // unknown codes are left exactly as typed
    });
  }

  window.EQL_EMOJI = {
    list: EMOJI,
    expand: expandShortcodes
  };
})();
