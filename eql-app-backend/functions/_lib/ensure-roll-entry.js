// Rebuilds a character's "roll" log entry if it's gone missing.
//
// Why this is needed: an active character's presence on the leaderboard
// (as an in-progress row) and its run duration both depend entirely on
// its original roll entry. Clearing the log wipes that entry, or a
// leaderboard reset filters it out by timestamp — either way the
// character silently vanishes from view even though it's still very
// much active, and its eventual death/ding would show no duration.
//
// Rather than blocking clears or special-casing them, this restores the
// entry from the character record (which survives untouched) the next
// time that character generates ANY log activity — a level-up, an AA
// gain, or its final death/ding.

export function ensureRollEntry(log, username, character) {
  if (!character) return log;

  // Does a roll entry for this character already exist?
  //
  // Matched on a small time WINDOW rather than exact equality. Characters
  // rolled before the timestamps were unified have a roll entry whose
  // time differs from rolledAt by a few milliseconds; an exact match
  // would miss it and insert a duplicate on every milestone.
  //
  // The window is deliberately tiny (5s) so a PREVIOUS character's roll
  // entry still can't be mistaken for this one's.
  const rolledMs = character.rolledAt ? new Date(character.rolledAt).getTime() : null;
  const hasRoll = log.some(function (e) {
    if (!e || e.type !== 'roll' || e.name !== username) return false;
    if (rolledMs === null) return true; // no reference point — assume the newest roll is this one
    const entryMs = new Date(e.time).getTime();
    if (isNaN(entryMs)) return false;
    return Math.abs(entryMs - rolledMs) < 5000;
  });
  if (hasRoll) return log;

  const rebuilt = buildRollEntry(username, character);

  // Insert in timestamp order so the log stays chronological — the
  // rebuilt entry belongs back where the original was, not at the end.
  const idx = log.findIndex(function (e) {
    return e && e.time && new Date(e.time) > new Date(rebuilt.time);
  });
  if (idx === -1) {
    log.push(rebuilt);
  } else {
    log.splice(idx, 0, rebuilt);
  }
  return log;
}

// Builds the roll entry for a character. Exported so the append path can
// hand a ready-made entry to the Durable Object, which does the
// existence check under its lock without needing to know the shape of a
// character record.
export function buildRollEntry(username, character) {
  return {
    type: 'roll',
    // Falling back to "now" only affects characters rolled before
    // rolledAt was recorded; their duration will read as near-zero
    // rather than being wrong in a more confusing way.
    time: character.rolledAt || new Date().toISOString(),
    name: username,
    primary: character.primary,
    secondary: character.secondary,
    tertiary: character.tertiary,
    race: character.race,
    hardcore: !!character.hardcore,
    pathMode: !!character.pathMode,
    path: character.path || null,
    manualBuild: !!character.manualBuild,
    ssf: !!character.ssf,
    server: character.server || null,
    d4: !!character.d4,
    // Flags this as restored rather than original, purely for clarity if
    // anyone inspects the raw data later.
    reconstructed: true
  };
}
