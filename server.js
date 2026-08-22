// Ember Foundry — leaderboard + secure admin announcements

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "leaderboard.json");

const MAX_STORED = 200;
const MAX_RETURNED = 20;
const MAX_NAME_LEN = 16;

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";

app.use(cors());
app.use(express.json({ limit: "10kb" }));

/* ---------------- Health ---------------- */

app.get("/", function(req, res) {
  res.json({
    ok: true,
    service: "ember-foundry-leaderboard"
  });
});

/* ---------------- Leaderboard ---------------- */

function readScores() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function writeScores(scores) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(scores, null, 2));
}

app.get("/api/leaderboard", function(req, res) {
  const scores = readScores();

  scores.sort(function(a, b) {
    return b.score - a.score;
  });

  res.json(scores.slice(0, MAX_RETURNED));
});

app.post("/api/leaderboard", function(req, res) {
  const body = req.body || {};
  const name = body.name;
  const score = body.score;

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({
      error: "name is required"
    });
  }

  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0
  ) {
    return res.status(400).json({
      error: "invalid score"
    });
  }

  const cleanName = name.trim().slice(0, MAX_NAME_LEN);

  let scores = readScores();

  const existing = scores.find(function(entry) {
    return entry.name === cleanName;
  });

  if (existing) {
    if (score > existing.score) {
      existing.score = score;
      existing.updatedAt = Date.now();
    }
  } else {
    scores.push({
      name: cleanName,
      score: score,
      updatedAt: Date.now()
    });
  }

  scores.sort(function(a, b) {
    return b.score - a.score;
  });

  scores = scores.slice(0, MAX_STORED);

  writeScores(scores);

  const rank = scores.findIndex(function(entry) {
    return entry.name === cleanName;
  }) + 1;

  res.json({
    ok: true,
    rank: rank
  });
});

/* ---------------- Admin authentication ---------------- */

function validAdmin(req) {
  if (!ADMIN_KEY) return false;

  const suppliedKey = req.headers["x-admin-key"];

  return (
    typeof suppliedKey === "string" &&
    suppliedKey === ADMIN_KEY
  );
}

/* ---------------- WebSocket ---------------- */

const wss = new WebSocketServer({
  server: server,
  path: "/ws"
});

wss.on("connection", function(socket) {
  console.log("Player connected");

  socket.send(JSON.stringify({
    type: "connected"
  }));

  socket.on("error", function() {
    // Ignore individual socket errors.
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);

  let count = 0;

  wss.clients.forEach(function(client) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        count++;
      } catch (e) {
        // Ignore failed individual clients.
      }
    }
  });

  return count;
}

/* ---------------- Admin announcement ---------------- */

app.post("/api/announce", function(req, res) {

  if (!validAdmin(req)) {
    return res.status(403).json({
      error: "Invalid admin key"
    });
  }

  const body = req.body || {};
  const message = body.message;

  if (typeof message !== "string") {
    return res.status(400).json({
      error: "message must be text"
    });
  }

  const cleanMessage = message.trim().slice(0, 500);

  if (!cleanMessage) {
    return res.status(400).json({
      error: "message is empty"
    });
  }

  const players = broadcast({
    type: "announcement",
    message: cleanMessage,
    adminName: ADMIN_NAME,
    isAdmin: true,
    timestamp: Date.now()
  });

  console.log(
    "ADMIN:",
    ADMIN_NAME,
    "|",
    cleanMessage,
    "| players:",
    players
  );

  res.json({
    ok: true,
    players: players
  });
});

/* ---------------- Admin leaderboard reset ---------------- */

app.post("/api/leaderboard/reset", function(req, res) {

  if (!validAdmin(req)) {
    return res.status(403).json({
      error: "Invalid admin key"
    });
  }

  writeScores([]);

  res.json({
    ok: true,
    message: "Leaderboard reset"
  });
});

/* ---------------- Start ---------------- */

server.listen(PORT, function() {
  console.log(
    "Ember Foundry server running on port " + PORT
  );
});
