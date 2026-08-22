// Ember Foundry — leaderboard + admin announcement backend

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'leaderboard.json');

const MAX_STORED = 200;
const MAX_RETURNED = 20;
const MAX_NAME_LEN = 16;

const ADMIN_KEY = process.env.ADMIN_KEY || '';

app.use(cors());
app.use(express.json());

/* ---------------- Leaderboard ---------------- */

function readScores() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function writeScores(scores) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(scores, null, 2));
}

// Health check
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'ember-foundry-leaderboard'
  });
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  const scores = readScores();

  scores.sort((a, b) => b.score - a.score);

  res.json(scores.slice(0, MAX_RETURNED));
});

// Submit leaderboard score
app.post('/api/leaderboard', (req, res) => {
  const { name, score } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({
      error: 'name is required'
    });
  }

  if (typeof score !== 'number' || !isFinite(score) || score < 0) {
    return res.status(400).json({
      error: 'score must be a non-negative number'
    });
  }

  const cleanName = name.trim().slice(0, MAX_NAME_LEN);

  let scores = readScores();

  const existing = scores.find(s => s.name === cleanName);

  if (existing) {
    if (score > existing.score) {
      existing.score = score;
      existing.updatedAt = Date.now();
    }
  } else {
    scores.push({
      name: cleanName,
      score,
      updatedAt: Date.now()
    });
  }

  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, MAX_STORED);

  writeScores(scores);

  res.json({
    ok: true,
    rank: scores.findIndex(s => s.name === cleanName) + 1
  });
});

/* ---------------- Reset leaderboard ---------------- */

app.get('/api/leaderboard/reset', (req, res) => {
  const key = req.query.key || '';

  if (!ADMIN_KEY) {
    return res.status(500).json({
      error: 'ADMIN_KEY is not set on the server'
    });
  }

  if (key !== ADMIN_KEY) {
    return res.status(403).json({
      error: 'invalid key'
    });
  }

  writeScores([]);

  res.json({
    ok: true,
    message: 'Leaderboard reset'
  });
});

/* ---------------- WebSocket announcements ---------------- */

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: '/ws'
});

wss.on('connection', function(socket) {
  console.log('Player connected to announcement system');

  socket.send(JSON.stringify({
    type: 'connected'
  }));

  socket.on('close', function() {
    console.log('Player disconnected');
  });
});

// Send announcement to every connected player
function broadcastAnnouncement(message) {
  const data = JSON.stringify({
    type: 'announcement',
    message: message
  });

  let sent = 0;

  wss.clients.forEach(function(client) {
    if (client.readyState === 1) {
      client.send(data);
      sent++;
    }
  });

  return sent;
}

/* ---------------- Admin announcement ---------------- */

app.post('/api/announce', (req, res) => {
  const key = req.headers['x-admin-key'];
  const message = req.body && req.body.message;

  if (!ADMIN_KEY) {
    return res.status(500).json({
      error: 'ADMIN_KEY is not set on the server'
    });
  }

  if (key !== ADMIN_KEY) {
    return res.status(403).json({
      error: 'invalid admin key'
    });
  }

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      error: 'message is required'
    });
  }

  const cleanMessage = message.trim().slice(0, 500);

  const players = broadcastAnnouncement(cleanMessage);

  console.log(
    'ADMIN ANNOUNCEMENT:',
    cleanMessage,
    '| players reached:',
    players
  );

  res.json({
    ok: true,
    message: cleanMessage,
    players: players
  });
});

/* ---------------- Start server ---------------- */

server.listen(PORT, () => {
  console.log(
    `Ember Foundry server listening on port ${PORT}`
  );
});
