// Ember Foundry backend
// - Keeps the existing leaderboard endpoints working exactly as before.
// - Adds a one-way "announcement" channel over WebSocket:
//     * Only someone who knows ADMIN_KEY can broadcast a message.
//     * Every connected player receives it instantly (no polling delay).
//     * New players who connect get the current/most recent message right away.
//     * This is completely separate from player save data — it can never
//       reset or touch anyone's progress.

const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- Leaderboard (name now protected per-player) ----------------
// In-memory store. Swap for a real database later if you want it to
// survive server restarts on Render's free tier.
// Each entry now tracks an ownerId (a random ID generated once per browser,
// stored in that player's localStorage) so a name can't be taken over by
// someone else — only the original owner of a name can update its score.
let leaderboard = []; // { name, score, ownerId }

app.get("/api/leaderboard", (req, res) => {
  const top = [...leaderboard]
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(({ name, score }) => ({ name, score })); // never expose ownerId
  res.json(top);
});

app.post("/api/leaderboard", (req, res) => {
  const { name, score, playerId } = req.body || {};
  if (typeof name !== "string" || !name.trim() || typeof score !== "number" || typeof playerId !== "string" || !playerId.trim()) {
    return res.status(400).json({ error: "name (string), score (number), and playerId (string) required" });
  }
  const cleanName = name.trim().slice(0, 16);
  const cleanOwnerId = playerId.trim().slice(0, 64);

  const nameTakenByOther = leaderboard.find(
    (e) => e.name.toLowerCase() === cleanName.toLowerCase() && e.ownerId !== cleanOwnerId
  );
  if (nameTakenByOther) {
    return res.status(409).json({ error: "That name is already taken by another player." });
  }

  const existingForThisPlayer = leaderboard.find((e) => e.ownerId === cleanOwnerId);
  if (existingForThisPlayer) {
    existingForThisPlayer.name = cleanName;
    if (score > existingForThisPlayer.score) existingForThisPlayer.score = score;
  } else {
    leaderboard.push({ name: cleanName, score, ownerId: cleanOwnerId });
  }
  res.json({ ok: true });
});

// ---------------- Admin events (new) ----------------
// A generic broadcast channel for owner-triggered events. Only requests
// carrying the correct ADMIN_KEY can trigger one. Set ADMIN_KEY as an
// environment variable on Render — never hardcode it in a public repo.
//
// Supported event types (eventType):
//   "announcement"       — payload: { message }
//                            Shows a banner for 15s. Purely visual.
//   "gold_rain"           — payload: { amount }
//                            Every connected player's client adds `amount`
//                            gold to their own save. No server-side wallet;
//                            each player's own game applies it locally, so
//                            it can never desync or reset anyone else.
//   "global_boost"        — payload: { mult, durationMs }
//                            Every connected player gets a free temporary
//                            output multiplier, same shape as the existing
//                            in-game Boosts, but free and owner-triggered.
//   "overheat_immunity"   — payload: { durationMs }
//                            Temporarily disables the anvil's overheat
//                            cooldown for every connected player.
const ADMIN_KEY = process.env.ADMIN_KEY || "";

let lastEvent = null; // most recent event, so newly-connected clients catch up

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

// Kept in sync with the station/upgrade ids in the game's index.html.
const VALID_STATION_IDS = new Set([
  "apprentice","bellows","smelter","press","forgemaster",
  "foundry","ironworks","blast","automaton","dragon"
]);
const VALID_UPGRADE_IDS = new Set([
  "hammer1","bellows2","apprentice2","hammer2","smelter2","allrate1",
  "forgemaster2","press2","ledger1","hammer3","foundry2","allrate2",
  "ironworks2","clickscale","hammer4","blast2","allrate3","automaton2",
  "allrate4","dragon2","hammer5"
]);

app.post("/api/admin-event", (req, res) => {
  const providedKey = req.header("x-admin-key");
  if (!ADMIN_KEY || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { eventType, payload } = req.body || {};
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: "invalid eventType" });
  }

  let cleanPayload = {};
  if (eventType === "announcement") {
    const message = (payload && payload.message ? String(payload.message) : "").trim();
    if (!message) return res.status(400).json({ error: "message required" });
    cleanPayload = { message: message.slice(0, 500) };
  } else if (eventType === "gold_rain") {
    const amount = Number(payload && payload.amount);
    if (!isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });
    cleanPayload = { amount };
  } else if (eventType === "global_boost") {
    const mult = Number(payload && payload.mult);
    const durationMs = Number(payload && payload.durationMs);
    if (!isFinite(mult) || mult <= 1) return res.status(400).json({ error: "mult must be a number greater than 1" });
    if (!isFinite(durationMs) || durationMs <= 0) return res.status(400).json({ error: "durationMs must be a positive number" });
    cleanPayload = { mult, durationMs };
  } else if (eventType === "overheat_immunity") {
    const durationMs = Number(payload && payload.durationMs);
    if (!isFinite(durationMs) || durationMs <= 0) return res.status(400).json({ error: "durationMs must be a positive number" });
    cleanPayload = { durationMs };
  } else if (eventType === "auto_click") {
    const durationMs = Number(payload && payload.durationMs);
    const clicksPerSecond = Number(payload && payload.clicksPerSecond) || 3;
    if (!isFinite(durationMs) || durationMs <= 0) return res.status(400).json({ error: "durationMs must be a positive number" });
    if (!isFinite(clicksPerSecond) || clicksPerSecond <= 0) return res.status(400).json({ error: "clicksPerSecond must be a positive number" });
    cleanPayload = { durationMs, clicksPerSecond };
  } else if (eventType === "free_station") {
    const stationId = payload && payload.stationId;
    const amount = Number(payload && payload.amount) || 1;
    if (!VALID_STATION_IDS.has(stationId)) return res.status(400).json({ error: "invalid stationId" });
    if (!isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });
    cleanPayload = { stationId, amount };
  } else if (eventType === "free_upgrade") {
    const upgradeId = payload && payload.upgradeId;
    if (!VALID_UPGRADE_IDS.has(upgradeId)) return res.status(400).json({ error: "invalid upgradeId" });
    cleanPayload = { upgradeId };
  } else if (eventType === "shard_gift") {
    const amount = Number(payload && payload.amount);
    if (!isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });
    cleanPayload = { amount };
  } else if (eventType === "confetti") {
    cleanPayload = {}; // purely visual, no data needed
  } else if (eventType === "reset_cooldowns") {
    cleanPayload = {}; // tells clients to clear their local boost cooldown timers
  } else if (eventType === "mystery_box") {
    // Resolve into a random real reward server-side, then broadcast that
    // resolved event (flagged as mysteryBox) so every player gets the
    // same surprise reward from a single button press.
    const stationIds = [...VALID_STATION_IDS];
    const options = [
      () => ({ eventType: "gold_rain", payload: { amount: 500 + Math.floor(Math.random() * 4500) } }),
      () => ({ eventType: "shard_gift", payload: { amount: 1 + Math.floor(Math.random() * 3) } }),
      () => ({ eventType: "free_station", payload: { stationId: stationIds[Math.floor(Math.random() * stationIds.length)], amount: 1 } })
    ];
    const resolved = options[Math.floor(Math.random() * options.length)]();
    // Overwrite eventType/cleanPayload with the resolved reward, but keep
    // a flag so the client shows "Mystery Box" flavor text instead of the
    // plain reward text.
    req.body.eventType = resolved.eventType; // for logging/consistency only
    cleanPayload = { ...resolved.payload, mysteryBox: true };
    // Re-run through the same broadcast path but under the resolved type.
    const adminName = (payload && payload.adminName ? String(payload.adminName) : "Owner").trim().slice(0, 20) || "Owner";
    cleanPayload.adminName = adminName;
    lastEvent = { eventType: resolved.eventType, payload: cleanPayload, sentAt: Date.now() };
    broadcastEvent(lastEvent);
    return res.json({ ok: true, resolved: resolved.eventType });
  }

  // Attach the sender's display name (defaults to "Owner") to every event
  // type, so the game can show who sent it — purely cosmetic, no effect
  // on validation or game logic above.
  const adminName = (payload && payload.adminName ? String(payload.adminName) : "Owner").trim().slice(0, 20) || "Owner";
  cleanPayload.adminName = adminName;

  lastEvent = { eventType, payload: cleanPayload, sentAt: Date.now() };
  broadcastEvent(lastEvent);
  res.json({ ok: true });
});

// ---------------- HTTP + WebSocket server ----------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcastEvent(evt) {
  const data = JSON.stringify({ type: "admin_event", eventType: evt.eventType, payload: evt.payload, sentAt: evt.sentAt });
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(data);
    }
  });
}

// ---------------- Player → Owner chat (one-way, admin-only visibility) ----------------
// Players can send a short message to the owner. Only the admin page (which
// authenticates its WebSocket connection with ADMIN_KEY) receives these —
// regular players never see anyone else's messages, including their own
// after sending, beyond a local "sent" confirmation in their own browser.
const MAX_STORED_MESSAGES = 200;
let playerMessages = []; // { name, message, sentAt }

function broadcastToAdmins(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.isAdmin) {
      client.send(data);
    }
  });
}

app.post("/api/player-message", (req, res) => {
  const { name, message, playerId } = req.body || {};
  const cleanMessage = (typeof message === "string" ? message : "").trim().slice(0, 300);
  if (!cleanMessage) {
    return res.status(400).json({ error: "message required" });
  }
  const cleanName = (typeof name === "string" && name.trim() ? name.trim().slice(0, 20) : "Anonymous player");

  const entry = { name: cleanName, message: cleanMessage, sentAt: Date.now() };
  playerMessages.push(entry);
  if (playerMessages.length > MAX_STORED_MESSAGES) {
    playerMessages = playerMessages.slice(-MAX_STORED_MESSAGES);
  }

  broadcastToAdmins(JSON.stringify({ type: "player_message", ...entry }));
  res.json({ ok: true });
});

// Only the admin page can read message history — requires ADMIN_KEY.
app.get("/api/player-messages", (req, res) => {
  const providedKey = req.header("x-admin-key");
  if (!ADMIN_KEY || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  res.json(playerMessages.slice(-100));
});

wss.on("connection", (ws, req) => {
  // Admin page connects with ?adminKey=... in the WebSocket URL so it can
  // be flagged to receive player chat messages. Regular players never send
  // this parameter, so they're never marked as admin sockets.
  let requestedAdminKey = null;
  try {
    const url = new URL(req.url, "http://localhost");
    requestedAdminKey = url.searchParams.get("adminKey");
  } catch (e) {}
  ws.isAdmin = !!ADMIN_KEY && requestedAdminKey === ADMIN_KEY;

  // Send the most recent event immediately so new/reopened pages aren't
  // stuck waiting for the next broadcast. Note: this only replays the
  // announcement type usefully (a stale gold_rain/boost from minutes ago
  // shouldn't retrigger) — so only forward it if it's an announcement or
  // very recent.
  if (lastEvent) {
    const age = Date.now() - lastEvent.sentAt;
    const isAnnouncement = lastEvent.eventType === "announcement";
    if (isAnnouncement || age < 10000) {
      ws.send(JSON.stringify({ type: "admin_event", eventType: lastEvent.eventType, payload: lastEvent.payload, sentAt: lastEvent.sentAt }));
    }
  }
  ws.on("error", () => {});
});

// ---------------- Live player count ----------------
// Every player's game keeps a WebSocket connection open (the same one used
// for admin events), so the number of open connections is a reasonable
// live count of people with the game open right now. This is read-only —
// no admin key required — since it reveals nothing about any individual
// player's save data, only a headcount.
app.get("/api/player-count", (req, res) => {
  res.json({ count: wss.clients.size });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server listening on port " + PORT);
  if (!ADMIN_KEY) {
    console.warn("WARNING: ADMIN_KEY is not set — /api/announce is disabled until you set it.");
  }
});
