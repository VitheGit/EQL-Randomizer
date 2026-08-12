var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _lib/auth-crypto.js
var PBKDF2_ITERATIONS = 1e5;
var SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
__name(bytesToBase64, "bytesToBase64");
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(base64ToBytes, "base64ToBytes");
function timingSafeEqualB64(aB64, bB64) {
  const a = base64ToBytes(aB64);
  const b = base64ToBytes(bB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
__name(timingSafeEqualB64, "timingSafeEqualB64");
async function derive(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}
__name(derive, "derive");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await derive(password, salt);
  return { hash: bytesToBase64(hashBytes), salt: bytesToBase64(salt) };
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, saltB64, expectedHashB64) {
  const salt = base64ToBytes(saltB64);
  const hashBytes = await derive(password, salt);
  return timingSafeEqualB64(bytesToBase64(hashBytes), expectedHashB64);
}
__name(verifyPassword, "verifyPassword");
function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(generateToken, "generateToken");
async function createSession(env, username) {
  const token = generateToken();
  await env.EQL_KV.put("session:" + token, username, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}
__name(createSession, "createSession");
async function getUsernameFromRequest(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const match2 = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match2) return null;
  const token = match2[1].trim();
  if (!token) return null;
  const username = await env.EQL_KV.get("session:" + token);
  return username || null;
}
__name(getUsernameFromRequest, "getUsernameFromRequest");
async function destroySession(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const match2 = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match2) return;
  const token = match2[1].trim();
  if (token) await env.EQL_KV.delete("session:" + token);
}
__name(destroySession, "destroySession");

// api/admin/clear.js
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");
async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid request." }, 400);
  }
  const passcode = body.passcode || "";
  const target = body.target;
  if (target !== "log" && target !== "leaderboard") {
    return json({ error: "Invalid target." }, 400);
  }
  const adminRaw = await env.EQL_KV.get("admin-passcode");
  if (!adminRaw) {
    return json({ error: "Admin passcode is not configured on the server yet." }, 500);
  }
  let admin;
  try {
    admin = JSON.parse(adminRaw);
  } catch (e) {
    return json({ error: "Admin passcode is misconfigured on the server." }, 500);
  }
  const ok = await verifyPassword(passcode, admin.salt, admin.hash);
  if (!ok) {
    return json({ error: "Wrong passcode." }, 401);
  }
  if (target === "log") {
    await env.EQL_KV.put("log", JSON.stringify([]));
  } else {
    await env.EQL_KV.put("leaderboard-reset-at", (/* @__PURE__ */ new Date()).toISOString());
  }
  return json({ ok: true });
}
__name(onRequestPost, "onRequestPost");

// _lib/auth-users.js
function isValidUsername(u) {
  return typeof u === "string" && /^[A-Za-z0-9_]{3,20}$/.test(u);
}
__name(isValidUsername, "isValidUsername");
function userKey(username) {
  return "user:" + username.trim().toLowerCase();
}
__name(userKey, "userKey");
async function getUser(env, username) {
  const raw = await env.EQL_KV.get(userKey(username));
  return raw ? JSON.parse(raw) : null;
}
__name(getUser, "getUser");
async function saveUser(env, userRecord) {
  await env.EQL_KV.put(userKey(userRecord.username), JSON.stringify(userRecord));
}
__name(saveUser, "saveUser");

// api/auth/login.js
function json2(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json2, "json");
async function onRequestPost2(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json2({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json2({ error: "Invalid request." }, 400);
  }
  const username = (body.username || "").trim();
  const password = body.password || "";
  const user = await getUser(env, username);
  if (!user) {
    return json2({ error: "Incorrect username or password." }, 401);
  }
  const ok = await verifyPassword(password, user.salt, user.hash);
  if (!ok) {
    return json2({ error: "Incorrect username or password." }, 401);
  }
  const token = await createSession(env, user.username);
  return json2({ token, username: user.username, currentCharacter: user.currentCharacter || null });
}
__name(onRequestPost2, "onRequestPost");

// api/auth/logout.js
async function onRequestPost3(context) {
  const { request, env } = context;
  if (env.EQL_KV) {
    await destroySession(request, env);
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" }
  });
}
__name(onRequestPost3, "onRequestPost");

// api/auth/register.js
function json3(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json3, "json");
async function onRequestPost4(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json3({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json3({ error: "Invalid request." }, 400);
  }
  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!isValidUsername(username)) {
    return json3({ error: "Usernames must be 3-20 characters: letters, numbers, and underscores only." }, 400);
  }
  if (password.length < 6) {
    return json3({ error: "Password must be at least 6 characters." }, 400);
  }
  const existing = await getUser(env, username);
  if (existing) {
    return json3({ error: "That username is already taken." }, 409);
  }
  const { hash, salt } = await hashPassword(password);
  const userRecord = {
    username,
    hash,
    salt,
    currentCharacter: null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await saveUser(env, userRecord);
  const token = await createSession(env, userRecord.username);
  return json3({ token, username: userRecord.username, currentCharacter: null });
}
__name(onRequestPost4, "onRequestPost");

// api/kv.js
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(jsonResponse, "jsonResponse");
var ALLOWED_KEYS = ["log", "leaderboard-reset-at"];
async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) return jsonResponse({ error: "Missing key" }, 400);
  if (key === "__ping__") return jsonResponse({ ok: true });
  if (ALLOWED_KEYS.indexOf(key) === -1) {
    return jsonResponse({ error: "Not found" }, 404);
  }
  if (!env.EQL_KV) {
    return jsonResponse({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);
  }
  const value = await env.EQL_KV.get(key);
  return jsonResponse({ key, value });
}
__name(onRequestGet, "onRequestGet");

// api/me.js
function json4(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json4, "json");
async function onRequestGet2(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json4({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);
  const username = await getUsernameFromRequest(request, env);
  if (!username) return json4({ error: "Not logged in" }, 401);
  const user = await getUser(env, username);
  if (!user) return json4({ error: "Account no longer exists" }, 401);
  return json4({ username: user.username, currentCharacter: user.currentCharacter || null });
}
__name(onRequestGet2, "onRequestGet");

// api/resolve.js
function json5(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json5, "json");
async function onRequestPost5(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json5({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);
  const username = await getUsernameFromRequest(request, env);
  if (!username) return json5({ error: "Not logged in" }, 401);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json5({ error: "Invalid request." }, 400);
  }
  const type = body.type;
  if (type !== "died" && type !== "ding" && type !== "retired") {
    return json5({ error: "Invalid resolution type." }, 400);
  }
  const user = await getUser(env, username);
  if (!user || !user.currentCharacter || !user.currentCharacter.locked) {
    return json5({ error: "You do not have a locked character to resolve." }, 409);
  }
  const character = user.currentCharacter;
  if (type === "retired" && character.hardcore) {
    return json5({ error: 'Hardcore characters must be resolved with "I Died" or "Ding! Level 50!".' }, 400);
  }
  let level = null;
  if (type === "died") {
    level = Number(body.level);
    if (!Number.isFinite(level) || level < 1 || level > 125) {
      return json5({ error: "Enter a valid level (1 or higher)." }, 400);
    }
  }
  const entry = {
    type,
    time: (/* @__PURE__ */ new Date()).toISOString(),
    name: username,
    primary: character.primary,
    secondary: character.secondary,
    tertiary: character.tertiary,
    race: character.race,
    hardcore: !!character.hardcore,
    pathMode: !!character.pathMode,
    path: character.path || null
  };
  if (type === "died") entry.level = level;
  const logRaw = await env.EQL_KV.get("log");
  const log = logRaw ? JSON.parse(logRaw) : [];
  log.push(entry);
  await env.EQL_KV.put("log", JSON.stringify(log));
  user.currentCharacter = null;
  await saveUser(env, user);
  return json5({ ok: true });
}
__name(onRequestPost5, "onRequestPost");

// _lib/gamedata.js
var RACES = [
  "Barbarian",
  "Dark Elf",
  "Dwarf",
  "Erudite",
  "Froglok",
  "Gnome",
  "Half-Elf",
  "Halfling",
  "High Elf",
  "Human",
  "Iksar",
  "Kerran",
  "Ogre",
  "Troll",
  "Wood Elf"
];
var CLASSES = [
  "Enchanter",
  "Magician",
  "Necromancer",
  "Wizard",
  "Bard",
  "Beastlord",
  "Paladin",
  "Ranger",
  "Shadow Knight",
  "Cleric",
  "Druid",
  "Shaman",
  "Berserker",
  "Monk",
  "Rogue",
  "Warrior"
];
var ELIGIBILITY = {
  "Beastlord": ["Barbarian", "Iksar", "Kerran", "Ogre", "Troll"],
  "Berserker": ["Barbarian", "Dwarf", "Kerran", "Ogre", "Troll"],
  "Rogue": ["Barbarian", "Dark Elf", "Dwarf", "Froglok", "Gnome", "Half-Elf", "Halfling", "Human", "Kerran", "Wood Elf"],
  "Shaman": ["Barbarian", "Froglok", "Iksar", "Kerran", "Ogre", "Troll"],
  "Warrior": ["Barbarian", "Dark Elf", "Dwarf", "Froglok", "Gnome", "Half-Elf", "Halfling", "Human", "Iksar", "Kerran", "Ogre", "Troll", "Wood Elf"],
  "Cleric": ["Dark Elf", "Dwarf", "Erudite", "Froglok", "Gnome", "Halfling", "High Elf", "Human"],
  "Enchanter": ["Dark Elf", "Erudite", "Gnome", "High Elf", "Human"],
  "Magician": ["Dark Elf", "Erudite", "Gnome", "High Elf", "Human"],
  "Necromancer": ["Dark Elf", "Erudite", "Froglok", "Gnome", "Human", "Iksar"],
  "Wizard": ["Dark Elf", "Erudite", "Froglok", "Gnome", "High Elf", "Human"],
  "Paladin": ["Dwarf", "Erudite", "Froglok", "Gnome", "Half-Elf", "Halfling", "High Elf", "Human"],
  "Shadow Knight": ["Dark Elf", "Erudite", "Froglok", "Gnome", "Human", "Iksar", "Ogre", "Troll"],
  "Monk": ["Froglok", "Human", "Iksar"],
  "Bard": ["Half-Elf", "Human", "Kerran", "Wood Elf"],
  "Druid": ["Half-Elf", "Halfling", "Human", "Kerran", "Wood Elf"],
  "Ranger": ["Half-Elf", "Halfling", "Human", "Wood Elf"]
};
function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
__name(pickOne, "pickOne");
function pickTwoDistinctExcluding(arr, exclude) {
  const pool = arr.filter(function(x) {
    return x !== exclude;
  });
  const picked = [];
  for (let i = 0; i < 2 && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}
__name(pickTwoDistinctExcluding, "pickTwoDistinctExcluding");
function drawCharacter() {
  const primary = pickOne(CLASSES);
  const eligibleForPrimary = ELIGIBILITY[primary] || [];
  let pool = RACES.filter(function(r) {
    return eligibleForPrimary.indexOf(r) !== -1;
  });
  let fellBack = false;
  if (pool.length === 0) {
    pool = RACES;
    fellBack = true;
  }
  const race = pickOne(pool);
  const rest = pickTwoDistinctExcluding(CLASSES, primary);
  return {
    primary,
    race,
    secondary: rest[0] || primary,
    tertiary: rest[1] || primary,
    fellBack
  };
}
__name(drawCharacter, "drawCharacter");
var LEVEL_BRACKETS = [
  { range: "1-10", zones: null, note: "Level where you want \u2014 path starts at 10+" },
  { range: "10-20", zones: ["Blackburrow", "Runnyeye", "Upper Guk", "Befallen", "Najena", "The Warrens", "Unrest", "Crushbone"] },
  { range: "20-30", zones: ["Splitpaw", "Temple of Cazic-Thule", "Upper Guk", "Najena", "Solusek's Eye (Sol A)", "Castle Mistmoore", "Permafrost"] },
  { range: "30-40", zones: ["Splitpaw", "Lower Guk", "Nagafen's Lair (Sol B)"] },
  { range: "40-46", zones: ["The Hole", "Nagafen's Lair (Sol B)", "Lower Guk", "Permafrost (Bears/Spiders)"] },
  { range: "46-50", zones: ["Plane of Fear", "Plane of Hate", "Plane of Air"] }
];
function generateLevelingPath() {
  return LEVEL_BRACKETS.map(function(bracket) {
    if (!bracket.zones) {
      return { range: bracket.range, zone: null, note: bracket.note };
    }
    return { range: bracket.range, zone: pickOne(bracket.zones), note: null };
  });
}
__name(generateLevelingPath, "generateLevelingPath");

// api/roll.js
function json6(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json6, "json");
async function onRequestPost6(context) {
  const { request, env } = context;
  if (!env.EQL_KV) return json6({ error: 'KV binding "EQL_KV" is not configured on this Pages project.' }, 500);
  const username = await getUsernameFromRequest(request, env);
  if (!username) return json6({ error: "Not logged in" }, 401);
  const user = await getUser(env, username);
  if (!user) return json6({ error: "Account no longer exists" }, 401);
  if (user.currentCharacter && user.currentCharacter.locked) {
    return json6({ error: "You already have a locked character. Resolve it before rolling again." }, 409);
  }
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const hardcore = !!body.hardcore;
  const pathMode = !!body.pathMode;
  const drawn = drawCharacter();
  const character = {
    primary: drawn.primary,
    secondary: drawn.secondary,
    tertiary: drawn.tertiary,
    race: drawn.race,
    fellBack: drawn.fellBack,
    hardcore,
    pathMode,
    path: pathMode ? generateLevelingPath() : null,
    locked: true
  };
  user.currentCharacter = character;
  await saveUser(env, user);
  const logRaw = await env.EQL_KV.get("log");
  const log = logRaw ? JSON.parse(logRaw) : [];
  log.push({
    type: "roll",
    time: (/* @__PURE__ */ new Date()).toISOString(),
    name: username,
    primary: character.primary,
    secondary: character.secondary,
    tertiary: character.tertiary,
    race: character.race,
    hardcore,
    pathMode,
    path: character.path
  });
  await env.EQL_KV.put("log", JSON.stringify(log));
  return json6({ character });
}
__name(onRequestPost6, "onRequestPost");

// api/_middleware.js
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
async function onRequest(context) {
  const { request, next } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const response = await next();
  const headers = new Headers(response.headers);
  const ch = corsHeaders();
  Object.keys(ch).forEach(function(key) {
    headers.set(key, ch[key]);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(onRequest, "onRequest");

// ../.wrangler/tmp/pages-yPeMo9/functionsRoutes-0.5975554280105024.mjs
var routes = [
  {
    routePath: "/api/admin/clear",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/auth/login",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/auth/logout",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/auth/register",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/kv",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/me",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/resolve",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/roll",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api",
    mountPath: "/api",
    method: "",
    middlewares: [onRequest],
    modules: []
  }
];

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
