// Group-scoped storage key helpers.
//
// A blank/unset group means "private to just this account" — implemented
// as an implicit per-user group (keyed by username) so it can never
// collide with anyone else's blank-group data. Group name matching is
// case-insensitive (so "Nightfall" and "nightfall" are the same group),
// though the user's own typed casing is preserved for display purposes
// on their account record.

export function normalizeGroup(raw) {
  const g = (raw || '').toString().trim();
  return g.slice(0, 60); // sanity cap, well within KV's key size limits
}

function groupKeyFor(user) {
  const g = normalizeGroup(user.group);
  return g ? ('group:' + g.toLowerCase()) : ('solo:' + user.username.toLowerCase());
}

export function logKeyFor(user) {
  return 'log:' + groupKeyFor(user);
}

export function resetKeyFor(user) {
  return 'leaderboard-reset-at:' + groupKeyFor(user);
}
