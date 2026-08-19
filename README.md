# Ember Foundry

An idle forge tycoon game, plus an optional backend for a public leaderboard.

```
ember-foundry/
├── index.html          ← the game itself, open this in a browser to play
└── backend/
    ├── server.js        ← the leaderboard API
    ├── package.json
    ├── leaderboard.json ← where scores get saved
    └── README.md        ← how to run/deploy the backend
```

## Play it

Just open `index.html` in a browser. No build step, no install — it's a single
self-contained file.

## Put it on GitHub

If you don't have Git installed yet, grab it from https://git-scm.com/downloads.
Then, from inside this folder:

```bash
git init
git add .
git commit -m "Ember Foundry tycoon game"
```

Now create the repo on GitHub itself:

1. Go to https://github.com/new
2. Name it (e.g. `ember-foundry`), leave it empty (no README/license — you already have files), click **Create repository**.
3. GitHub will show you commands like these — run them:

```bash
git remote add origin https://github.com/YOUR-USERNAME/ember-foundry.git
git branch -M main
git push -u origin main
```

Refresh the GitHub page and your files should be there.

## Make the leaderboard public

The game works fine with no backend — it just keeps scores locally in each
player's browser. To make the leaderboard actually shared between players,
follow `backend/README.md` to deploy the `backend` folder (e.g. to Render.com,
free), then paste your deployed URL into `index.html`:

```js
var API_BASE_URL = "https://your-app-name.onrender.com";
```

Commit and push that change too:

```bash
git add index.html
git commit -m "Connect game to public leaderboard"
git push
```

## Free hosting for the game page itself (optional)

Once it's on GitHub, you can also host `index.html` for free with **GitHub Pages**:

1. On GitHub, go to your repo → **Settings** → **Pages**.
2. Under "Build and deployment", set Source to **Deploy from a branch**, branch
   `main`, folder `/ (root)`. Save.
3. GitHub gives you a live URL like `https://YOUR-USERNAME.github.io/ember-foundry/`
   after a minute or two — that's a shareable link to the game, no download needed.
