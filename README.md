# Ember Foundry — Leaderboard Backend

A tiny API with two routes:

- `GET  /api/leaderboard` → top 20 scores, highest first
- `POST /api/leaderboard` with JSON body `{ "name": "...", "score": 123 }` → submits/updates a score

Scores are saved to `leaderboard.json` on disk. Good enough for a class project;
not meant for heavy traffic.

## 1. Run it locally (to test)

You need [Node.js](https://nodejs.org) installed (v18+).

```
cd backend
npm install
npm start
```

It'll print `listening on port 3000`. Visit `http://localhost:3000` in a browser —
you should see `{"ok":true,...}`.

To test from the game, you'd set `API_BASE_URL = "http://localhost:3000"` in the
game's HTML — but that only works on your own computer. For your classmate to see
it too, you need to deploy it somewhere public (next step).

## 2. Deploy it for free (so it has a public URL)

Easiest option: **Render.com** — and since this is now inside a GitHub repo, it's a
direct connection, no separate upload needed:

1. Push this whole project to GitHub first (see the root `README.md` for those steps).
2. Go to https://render.com → sign up (free) → **New +** → **Web Service**.
3. Click **Connect** next to your GitHub account, then pick this repo.
4. Render will ask for a **Root Directory** — set it to `backend` (important: the
   server files live in that subfolder, not the repo root).
5. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
6. Click **Create Web Service**. Render gives you a URL like
   `https://ember-foundry-leaderboard.onrender.com`.

Other free options that work the same way once it's on GitHub: **Railway.app**,
**Cyclic.sh**, **Fly.io**. (Glitch/Replit instead prefer importing straight from
a GitHub URL, same idea.)

Note: most free tiers "sleep" after inactivity and take a few seconds to wake up
on the next request — that's normal, not a bug. Also, free tiers often use a
throwaway filesystem, so `leaderboard.json` may reset on redeploy — fine for a
class project, but worth knowing.

## 3. Point the game at your deployed URL

In `ember-foundry.html`, find this line near the top of the `<script>`:

```js
var API_BASE_URL = "";
```

Set it to your deployed URL, no trailing slash:

```js
var API_BASE_URL = "https://ember-foundry-leaderboard.onrender.com";
```

Save the file and re-share it. Now everyone who opens that HTML file and submits
a score is hitting the same server, so the leaderboard is genuinely shared.

If `API_BASE_URL` is left blank, the game quietly falls back to a local-only
leaderboard (same as before) so it still works without a backend.
