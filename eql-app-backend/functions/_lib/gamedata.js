// Authoritative race/class/eligibility data, duplicated from the client so
// the server can compute the actual roll itself — the client can no longer
// dictate what it "rolled" by crafting a request.

export const RACES = [
  "Barbarian", "Dark Elf", "Dwarf", "Erudite", "Froglok",
  "Gnome", "Half-Elf", "Halfling", "High Elf", "Human",
  "Iksar", "Kerran", "Ogre", "Troll", "Wood Elf"
];

export const CLASSES = [
  "Enchanter", "Magician", "Necromancer", "Wizard", "Bard",
  "Beastlord", "Paladin", "Ranger", "Shadow Knight", "Cleric",
  "Druid", "Shaman", "Berserker", "Monk", "Rogue", "Warrior"
];

export const SERVERS = [
  "Qeynos", "Freeport", "Oggok", "Neriak", "Rivervale", "Halas", "Paineel"
];

export const ELIGIBILITY = {
  "Beastlord": ["Barbarian","Iksar","Kerran","Ogre","Troll"],
  "Berserker": ["Barbarian","Dwarf","Kerran","Ogre","Troll"],
  "Rogue": ["Barbarian","Dark Elf","Dwarf","Froglok","Gnome","Half-Elf","Halfling","Human","Kerran","Wood Elf"],
  "Shaman": ["Barbarian","Froglok","Iksar","Kerran","Ogre","Troll"],
  "Warrior": ["Barbarian","Dark Elf","Dwarf","Froglok","Gnome","Half-Elf","Halfling","Human","Iksar","Kerran","Ogre","Troll","Wood Elf"],
  "Cleric": ["Dark Elf","Dwarf","Erudite","Froglok","Gnome","Halfling","High Elf","Human"],
  "Enchanter": ["Dark Elf","Erudite","Gnome","High Elf","Human"],
  "Magician": ["Dark Elf","Erudite","Gnome","High Elf","Human"],
  "Necromancer": ["Dark Elf","Erudite","Froglok","Gnome","Human","Iksar"],
  "Wizard": ["Dark Elf","Erudite","Froglok","Gnome","High Elf","Human"],
  "Paladin": ["Dwarf","Erudite","Froglok","Gnome","Half-Elf","Halfling","High Elf","Human"],
  "Shadow Knight": ["Dark Elf","Erudite","Froglok","Gnome","Human","Iksar","Ogre","Troll"],
  "Monk": ["Froglok","Human","Iksar"],
  "Bard": ["Half-Elf","Human","Kerran","Wood Elf"],
  "Druid": ["Half-Elf","Halfling","Human","Kerran","Wood Elf"],
  "Ranger": ["Half-Elf","Halfling","Human","Wood Elf"]
};

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickTwoDistinctExcluding(arr, exclude) {
  const pool = arr.filter(function (x) { return x !== exclude; });
  const picked = [];
  for (let i = 0; i < 2 && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

export function drawCharacter() {
  const primary = pickOne(CLASSES);
  const eligibleForPrimary = ELIGIBILITY[primary] || [];
  let pool = RACES.filter(function (r) { return eligibleForPrimary.indexOf(r) !== -1; });
  let fellBack = false;
  if (pool.length === 0) {
    pool = RACES;
    fellBack = true;
  }
  const race = pickOne(pool);
  const rest = pickTwoDistinctExcluding(CLASSES, primary);
  return {
    primary: primary,
    race: race,
    secondary: rest[0] || primary,
    tertiary: rest[1] || primary,
    fellBack: fellBack
  };
}

// Random Leveling Path — one zone chosen per level bracket. The 1-10
// bracket has no zone pool; it's just an open note.
export const LEVEL_BRACKETS = [
  { range: "1-10", zones: null, note: "Level where you want, path starts at 10+" },
  { range: "10-20", zones: ["Blackburrow", "Runnyeye", "Upper Guk", "Befallen", "Najena", "The Warrens", "Unrest", "Crushbone", "Qeynos Aqueducts", "Everfrost Peaks", "West Karana", "North Karana", "East Karana", "Lake Rathetear", "Gorge of King Xorbb", "South Ro", "Oasis of Marr", "Ocean of Tears", "West Commonlands", "Lavastorm Mountains", "Dagnor's Cauldron", "Lesser Faydark"] },
  { range: "20-30", zones: ["Splitpaw", "Temple of Cazic-Thule", "Upper Guk", "Najena", "Solusek's Eye (SolA)", "Castle Mistmoore", "Permafrost", "South Karana", "Runnyeye", "Highpass Hold", "High Keep", "Ocean of Tears", "Stonebrunt Mountains", "Unrest"] },
  { range: "30-40", zones: ["Splitpaw", "Lower Guk", "Nagafen's Lair (Sol B)", "Ocean of Tears", "Kedge Keep"] },
  { range: "40-46", zones: ["The Hole", "Nagafen's Lair (Sol B)", "Lower Guk", "Permafrost (Bears/Spiders)", "Kedge Keep"] },
  { range: "46-50", zones: ["Plane of Fear", "Plane of Hate", "Plane of Sky"] }
];

export function generateLevelingPath() {
  return LEVEL_BRACKETS.map(function (bracket) {
    if (!bracket.zones) {
      return { range: bracket.range, zone: null, note: bracket.note };
    }
    return { range: bracket.range, zone: pickOne(bracket.zones), note: null };
  });
}

// Used to validate manually-chosen (not randomly drawn) characters —
// never trust the client's claim that a race/class combo is legal.
export function isEligible(race, primaryClass) {
  var elig = ELIGIBILITY[primaryClass];
  return !!elig && elig.indexOf(race) !== -1;
}

