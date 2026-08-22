// Ember Foundry — public leaderboard backend
// A tiny Express API backed by a JSON file. Good enough for a class project;
// swap DATA_FILE storage for a real database if this ever needs to scale.

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'leaderboard.json');
const MAX_STORED = 200;   // keep at most this many entries on disk
const MAX_RETURNED = 20;  // send at most this many to the client
const MAX_NAME_LEN = 16;

// Set this in Render's Environment settings (Settings -> Environment -> Add
// Environment Variable, key ADMIN_KEY). Protects the reset endpoint so random
// visitors can't wipe the leaderboard.
const ADMIN_KEY = process.env.ADMIN_KEY || '';

app.use(cors());              // allow the game page (any origin) to call this API
app.use(express.json());

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

// Health check — useful when confirming a deploy worked
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'ember-foundry-leaderboard' });
});

// GET top scores, highest gold/sec first
app.get('/api/leaderboard', (req, res) => {
  const scores = readScores();
  scores.sort((a, b) => b.score - a.score);
  res.json(scores.slice(0, MAX_RETURNED));
});

// POST a score. Same name submitted again only overwrites if the new score is higher.
app.post('/api/leaderboard', (req, res) => {
  const { name, score } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (typeof score !== 'number' || !isFinite(score) || score < 0) {
    return res.status(400).json({ error: 'score must be a non-negative number' });
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
    scores.push({ name: cleanName, score, updatedAt: Date.now() });
  }

  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, MAX_STORED);
  writeScores(scores);

  res.json({ ok: true, rank: scores.findIndex(s => s.name === cleanName) + 1 });
});

// Visit this URL in a browser to wipe the whole leaderboard, e.g.:
// https://your-app.onrender.com/api/leaderboard/reset?key=YOUR_SECRET_KEY
app.get('/api/leaderboard/reset', (req, res) => {
  const key = req.query.key || '';
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not set on the server — set it in Render\'s Environment settings first' });
  }
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'invalid key' });
  }
  writeScores([]);
  res.json({ ok: true, message: 'Leaderboard reset' });
});

app.listen(PORT, () => {
  console.log(`Ember Foundry leaderboard server listening on port ${PORT}`);
});
