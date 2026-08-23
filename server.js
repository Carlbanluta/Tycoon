// Ember Foundry backend
// Owner: Carl [👑 OWNER]

const http = require("http");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================================================
   OWNER
========================================================= */

const OWNER_NAME = "Carl";
const OWNER_TITLE = "OWNER";
const OWNER_BADGE = "👑 OWNER";

/* =========================================================
   PERSISTENT LEADERBOARD + RESET VERSION
========================================================= */

const DATA_FILE = path.join(__dirname, "leaderboard.json");
const RESET_VERSION_FILE = path.join(__dirname, "reset-version.json");

let leaderboard = [];
let resetVersion = 0;

function loadLeaderboard() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const data = JSON.parse(raw);

      if (Array.isArray(data)) {
        leaderboard = data;
      }
    }
  } catch (err) {
    console.error("Failed to load leaderboard:", err);
    leaderboard = [];
  }
}

function saveLeaderboard() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(leaderboard, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Failed to save leaderboard:", err);
  }
}

function loadResetVersion() {
  try {
    if (fs.existsSync(RESET_VERSION_FILE)) {
      const raw = fs.readFileSync(RESET_VERSION_FILE, "utf8");
      const data = JSON.parse(raw);
      resetVersion = Number(data.version) || 0;
    }
  } catch (err) {
    console.error("Failed to load reset version:", err);
    resetVersion = 0;
  }
}

function saveResetVersion() {
  try {
    fs.writeFileSync(
      RESET_VERSION_FILE,
      JSON.stringify({ version: resetVersion }, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Failed to save reset version:", err);
  }
}

loadLeaderboard();
loadResetVersion();

/* =========================================================
   LEADERBOARD
========================================================= */

app.get("/api/leaderboard", (req, res) => {
  const top = [...leaderboard]
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(({ name, score }) => ({
      name,
      score
    }));

  res.json(top);
});

app.post("/api/leaderboard", (req, res) => {
  const { name, score, playerId } = req.body || {};

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof score !== "number" ||
    typeof playerId !== "string" ||
    !playerId.trim()
  ) {
    return res.status(400).json({
      error: "name (string), score (number), and playerId (string) required"
    });
  }

  const cleanName = name.trim().slice(0, 16);
  const cleanOwnerId = playerId.trim().slice(0, 64);

  const nameTakenByOther = leaderboard.find(
    (e) =>
      e.name.toLowerCase() === cleanName.toLowerCase() &&
      e.ownerId !== cleanOwnerId
  );

  if (nameTakenByOther) {
    return res.status(409).json({
      error: "That name is already taken by another player."
    });
  }

  const existing = leaderboard.find((e) => e.ownerId === cleanOwnerId);

  if (existing) {
    existing.name = cleanName;
    if (score > existing.score) {
      existing.score = score;
    }
  } else {
    leaderboard.push({
      name: cleanName,
      score,
      ownerId: cleanOwnerId
    });
  }

  saveLeaderboard();

  res.json({ ok: true });
});

/* =========================================================
   RESET VERSION (used by clients to clear localStorage)
========================================================= */

app.get("/api/reset-version", (req, res) => {
  res.json({ version: resetVersion });
});

/* =========================================================
   RESET ALL PLAYER PROGRESS
========================================================= */

function requireAdmin(req, res) {
  const providedKey = req.header("x-admin-key");

  if (!ADMIN_KEY || providedKey !== ADMIN_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }

  return true;
}

app.post("/api/admin-reset-all", (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  // 1. Clear server leaderboard
  leaderboard = [];
  saveLeaderboard();

  // 2. Bump reset version so every client clears localStorage
  resetVersion += 1;
  saveResetVersion();

  // 3. Optional: clear chat + private messages for a clean season
  globalChat = [];
  playerMessages = [];

  // 4. Tell connected players immediately
  broadcastEvent({
    eventType: "reset_all_progress",
    payload: {
      adminName: OWNER_NAME,
      adminTitle: OWNER_TITLE,
      adminBadge: OWNER_BADGE,
      version: resetVersion
    },
    sentAt: Date.now()
  });

  res.json({
    ok: true,
    message: "All player leaderboard progress has been reset.",
    version: resetVersion,
    owner: OWNER_NAME,
    title: OWNER_TITLE
  });
});

/* =========================================================
   ADMIN EVENTS
========================================================= */

const ADMIN_KEY = process.env.ADMIN_KEY || "";

let lastEvent = null;

const ALLOWED_EVENT_TYPES = new Set([
  "announcement",
  "gold_rain",
  "global_boost",
  "overheat_immunity",
  "auto_click",
  "free_station",
  "free_upgrade",
  "shard_gift",
  "confetti",
  "reset_cooldowns",
  "mystery_box"
]);

const VALID_STATION_IDS = new Set([
  "apprentice",
  "bellows",
  "smelter",
  "press",
  "forgemaster",
  "foundry",
  "ironworks",
  "blast",
  "automaton",
  "dragon"
]);

const VALID_UPGRADE_IDS = new Set([
  "hammer1",
  "bellows2",
  "apprentice2",
  "hammer2",
  "smelter2",
  "allrate1",
  "forgemaster2",
  "press2",
  "ledger1",
  "hammer3",
  "foundry2",
  "allrate2",
  "ironworks2",
  "clickscale",
  "hammer4",
  "blast2",
  "allrate3",
  "automaton2",
  "allrate4",
  "dragon2",
  "hammer5"
]);

app.post("/api/admin-event", (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  let { eventType, payload } = req.body || {};

  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: "invalid eventType" });
  }

  let cleanPayload = {};

  /* -----------------------------------------
     ANNOUNCEMENT
  ----------------------------------------- */

  if (eventType === "announcement") {
    const message =
      payload && payload.message ? String(payload.message) : "";

    if (!message.trim()) {
      return res.status(400).json({ error: "message required" });
    }

    cleanPayload = {
      message: message.trim().slice(0, 500)
    };
  }

  /* -----------------------------------------
     GOLD RAIN
  ----------------------------------------- */
  else if (eventType === "gold_rain") {
    const amount = Number(payload && payload.amount);

    if (!isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount must be a positive number"
      });
    }

    cleanPayload = { amount };
  }

  /* -----------------------------------------
     GLOBAL BOOST
  ----------------------------------------- */
  else if (eventType === "global_boost") {
    const mult = Number(payload && payload.mult);
    const durationMs = Number(payload && payload.durationMs);

    if (!isFinite(mult) || mult <= 1) {
      return res.status(400).json({
        error: "mult must be greater than 1"
      });
    }

    if (!isFinite(durationMs) || durationMs <= 0) {
      return res.status(400).json({
        error: "durationMs must be positive"
      });
    }

    cleanPayload = { mult, durationMs };
  }

  /* -----------------------------------------
     OVERHEAT IMMUNITY
  ----------------------------------------- */
  else if (eventType === "overheat_immunity") {
    const durationMs = Number(payload && payload.durationMs);

    if (!isFinite(durationMs) || durationMs <= 0) {
      return res.status(400).json({
        error: "durationMs must be positive"
      });
    }

    cleanPayload = { durationMs };
  }

  /* -----------------------------------------
     AUTO CLICK
  ----------------------------------------- */
  else if (eventType === "auto_click") {
    const durationMs = Number(payload && payload.durationMs);
    const clicksPerSecond =
      Number(payload && payload.clicksPerSecond) || 3;

    if (!isFinite(durationMs) || durationMs <= 0) {
      return res.status(400).json({
        error: "durationMs must be positive"
      });
    }

    if (!isFinite(clicksPerSecond) || clicksPerSecond <= 0) {
      return res.status(400).json({
        error: "clicksPerSecond must be positive"
      });
    }

    cleanPayload = { durationMs, clicksPerSecond };
  }

  /* -----------------------------------------
     FREE STATION
  ----------------------------------------- */
  else if (eventType === "free_station") {
    const stationId = payload && payload.stationId;
    const amount = Number(payload && payload.amount) || 1;

    if (!VALID_STATION_IDS.has(stationId)) {
      return res.status(400).json({ error: "invalid stationId" });
    }

    if (!isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount must be positive"
      });
    }

    cleanPayload = { stationId, amount };
  }

  /* -----------------------------------------
     FREE UPGRADE
  ----------------------------------------- */
  else if (eventType === "free_upgrade") {
    const upgradeId = payload && payload.upgradeId;

    if (!VALID_UPGRADE_IDS.has(upgradeId)) {
      return res.status(400).json({ error: "invalid upgradeId" });
    }

    cleanPayload = { upgradeId };
  }

  /* -----------------------------------------
     SHARD GIFT
  ----------------------------------------- */
  else if (eventType === "shard_gift") {
    const amount = Number(payload && payload.amount);

    if (!isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount must be positive"
      });
    }

    cleanPayload = { amount };
  }

  /* -----------------------------------------
     VISUAL EVENTS
  ----------------------------------------- */
  else if (eventType === "confetti") {
    cleanPayload = {};
  } else if (eventType === "reset_cooldowns") {
    cleanPayload = {};
  }

  /* -----------------------------------------
     MYSTERY BOX
  ----------------------------------------- */
  else if (eventType === "mystery_box") {
    const stationIds = [...VALID_STATION_IDS];

    const options = [
      () => ({
        eventType: "gold_rain",
        payload: {
          amount: 500 + Math.floor(Math.random() * 4500)
        }
      }),
      () => ({
        eventType: "shard_gift",
        payload: {
          amount: 1 + Math.floor(Math.random() * 3)
        }
      }),
      () => ({
        eventType: "free_station",
        payload: {
          stationId:
            stationIds[Math.floor(Math.random() * stationIds.length)],
          amount: 1
        }
      })
    ];

    const resolved =
      options[Math.floor(Math.random() * options.length)]();

    eventType = resolved.eventType;
    cleanPayload = {
      ...resolved.payload,
      mysteryBox: true
    };
  }

  /* -----------------------------------------
     PERMANENT OWNER IDENTITY
  ----------------------------------------- */

  cleanPayload.adminName = OWNER_NAME;
  cleanPayload.adminTitle = OWNER_TITLE;
  cleanPayload.adminBadge = OWNER_BADGE;

  lastEvent = {
    eventType,
    payload: cleanPayload,
    sentAt: Date.now()
  };

  broadcastEvent(lastEvent);

  res.json({
    ok: true,
    owner: {
      name: OWNER_NAME,
      title: OWNER_TITLE,
      badge: OWNER_BADGE
    }
  });
});

/* =========================================================
   HTTP + WEBSOCKET
========================================================= */

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/ws"
});

function sendSocket(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastEvent(evt) {
  const data = {
    type: "admin_event",
    eventType: evt.eventType,
    payload: evt.payload,
    sentAt: evt.sentAt
  };

  wss.clients.forEach((client) => {
    sendSocket(client, data);
  });
}

/* =========================================================
   GLOBAL CHAT
========================================================= */

const MAX_CHAT_MESSAGES = 200;
let globalChat = [];

function broadcastGlobalChat(message) {
  const data = {
    type: "global_chat",
    message
  };

  wss.clients.forEach((client) => {
    sendSocket(client, data);
  });
}

app.get("/api/global-chat", (req, res) => {
  res.json(globalChat.slice(-100));
});

app.post("/api/global-chat", (req, res) => {
  const { name, message, playerId } = req.body || {};

  const cleanName =
    typeof name === "string" && name.trim()
      ? name.trim().slice(0, 20)
      : "Anonymous";

  const cleanMessage =
    typeof message === "string" ? message.trim().slice(0, 300) : "";

  if (!cleanMessage) {
    return res.status(400).json({ error: "message required" });
  }

  const entry = {
    name: cleanName,
    message: cleanMessage,
    playerId:
      typeof playerId === "string" ? playerId.slice(0, 64) : "",
    sentAt: Date.now(),
    owner: false
  };

  globalChat.push(entry);

  if (globalChat.length > MAX_CHAT_MESSAGES) {
    globalChat = globalChat.slice(-MAX_CHAT_MESSAGES);
  }

  broadcastGlobalChat(entry);

  res.json({ ok: true });
});

/* =========================================================
   OWNER GLOBAL CHAT
========================================================= */

app.post("/api/admin-global-chat", (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  const message =
    req.body && req.body.message
      ? String(req.body.message).trim().slice(0, 300)
      : "";

  if (!message) {
    return res.status(400).json({ error: "message required" });
  }

  const entry = {
    name: OWNER_NAME,
    message,
    playerId: "OWNER",
    sentAt: Date.now(),
    owner: true,
    title: OWNER_TITLE,
    badge: OWNER_BADGE
  };

  globalChat.push(entry);

  if (globalChat.length > MAX_CHAT_MESSAGES) {
    globalChat = globalChat.slice(-MAX_CHAT_MESSAGES);
  }

  broadcastGlobalChat(entry);

  res.json({
    ok: true,
    owner: {
      name: OWNER_NAME,
      title: OWNER_TITLE,
      badge: OWNER_BADGE
    }
  });
});

/* =========================================================
   PLAYER → OWNER MESSAGES
========================================================= */

const MAX_STORED_MESSAGES = 200;
let playerMessages = [];

function broadcastToAdmins(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.isAdmin) {
      client.send(data);
    }
  });
}

app.post("/api/player-message", (req, res) => {
  const { name, message, playerId } = req.body || {};

  const cleanMessage =
    typeof message === "string" ? message.trim().slice(0, 300) : "";

  if (!cleanMessage) {
    return res.status(400).json({ error: "message required" });
  }

  const cleanName =
    typeof name === "string" && name.trim()
      ? name.trim().slice(0, 20)
      : "Anonymous player";

  const entry = {
    name: cleanName,
    message: cleanMessage,
    sentAt: Date.now()
  };

  playerMessages.push(entry);

  if (playerMessages.length > MAX_STORED_MESSAGES) {
    playerMessages = playerMessages.slice(-MAX_STORED_MESSAGES);
  }

  broadcastToAdmins(
    JSON.stringify({
      type: "player_message",
      ...entry
    })
  );

  res.json({ ok: true });
});

app.get("/api/player-messages", (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  res.json(playerMessages.slice(-100));
});

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on("connection", (ws, req) => {
  let requestedAdminKey = null;

  try {
    const url = new URL(req.url, "http://localhost");
    requestedAdminKey = url.searchParams.get("adminKey");
  } catch (e) {}

  ws.isAdmin = !!ADMIN_KEY && requestedAdminKey === ADMIN_KEY;

  // Send recent admin event
  if (lastEvent) {
    const age = Date.now() - lastEvent.sentAt;
    const isAnnouncement = lastEvent.eventType === "announcement";

    if (isAnnouncement || age < 10000) {
      sendSocket(ws, {
        type: "admin_event",
        eventType: lastEvent.eventType,
        payload: lastEvent.payload,
        sentAt: lastEvent.sentAt
      });
    }
  }

  // Send global chat history
  if (globalChat.length) {
    globalChat.slice(-50).forEach((message) => {
      sendSocket(ws, {
        type: "global_chat",
        message
      });
    });
  }

  ws.on("error", () => {});
});

/* =========================================================
   PLAYER COUNT
========================================================= */

app.get("/api/player-count", (req, res) => {
  res.json({
    count: wss.clients.size
  });
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    game: "Ember Foundry",
    owner: {
      name: OWNER_NAME,
      title: OWNER_TITLE,
      badge: OWNER_BADGE
    },
    leaderboardPlayers: leaderboard.length,
    chatMessages: globalChat.length,
    resetVersion
  });
});

/* =========================================================
   START SERVER
========================================================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🔥 Ember Foundry server listening on port " + PORT);
  console.log("👑 Owner: " + OWNER_NAME + " [" + OWNER_BADGE + "]");
  console.log("🔄 Current reset version: " + resetVersion);

  if (!ADMIN_KEY) {
    console.warn("⚠️ ADMIN_KEY is not set!");
  }
});
