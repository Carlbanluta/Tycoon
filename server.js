const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.use(express.json());

const DATA_FILE = path.join(__dirname, "leaderboard.json");

let leaderboard = {};

try {
    if (fs.existsSync(DATA_FILE)) {
        leaderboard = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (error) {
    console.log("Could not load leaderboard:", error.message);
    leaderboard = {};
}

function saveLeaderboard() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(leaderboard, null, 2)
        );
    } catch (error) {
        console.log("Could not save leaderboard:", error.message);
    }
}

function cleanName(name) {
    return String(name || "Player")
        .replace(/[<>]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 20) || "Player";
}

function cleanMessage(message) {
    return String(message || "")
        .replace(/[<>]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 200);
}

/*
    Health check
*/
app.get("/", (req, res) => {
    res.json({
        status: "online",
        players: wss.clients.size,
        game: "Ember Foundry"
    });
});

app.get("/leaderboard", (req, res) => {
    const result = Object.entries(leaderboard)
        .map(([name, gold]) => ({
            name,
            gold: Number(gold) || 0
        }))
        .sort((a, b) => b.gold - a.gold)
        .slice(0, 50);

    res.json(result);
});

/*
    WebSocket server
*/
const wss = new WebSocket.Server({ server });

const players = new Map();

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(data) {
    const message = JSON.stringify(data);

    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

function broadcastPlayerCount() {
    broadcast({
        type: "playerCount",
        count: wss.clients.size
    });
}

wss.on("connection", (ws) => {
    const player = {
        name: "Player",
        gold: 0,
        lastChat: 0,
        lastGoldUpdate: Date.now()
    };

    players.set(ws, player);

    send(ws, {
        type: "connected",
        gold: player.gold
    });

    broadcast({
        type: "system",
        message: "A player joined the server."
    });

    broadcastPlayerCount();

    ws.on("message", (raw) => {
        let data;

        try {
            data = JSON.parse(raw.toString());
        } catch {
            return;
        }

        /*
            SET NAME
        */
        if (data.type === "setName") {
            player.name = cleanName(data.name);

            if (!leaderboard[player.name]) {
                leaderboard[player.name] = 0;
            }

            send(ws, {
                type: "nameSet",
                name: player.name,
                gold: player.gold
            });

            broadcast({
                type: "system",
                message: `${player.name} joined the game.`
            });

            return;
        }

        /*
            CLAIM GOLD
            Server controls the amount so the browser
            cannot simply send "give me 999999999 gold".
        */
        if (data.type === "claimGold") {
            const now = Date.now();

            // One gold claim approximately every second.
            if (now - player.lastGoldUpdate < 900) {
                return;
            }

            player.lastGoldUpdate = now;

            player.gold += 10;

            leaderboard[player.name] = player.gold;

            saveLeaderboard();

            send(ws, {
                type: "gold",
                gold: player.gold
            });

            return;
        }

        /*
            CHAT
        */
        if (data.type === "chat") {
            const now = Date.now();

            // Anti-spam: one message every 700ms.
            if (now - player.lastChat < 700) {
                send(ws, {
                    type: "chatError",
                    message: "Please slow down."
                });
                return;
            }

            player.lastChat = now;

            const message = cleanMessage(data.message);

            if (!message) {
                return;
            }

            broadcast({
                type: "chat",
                name: player.name,
                message,
                time: Date.now()
            });

            return;
        }

        /*
            Request leaderboard
        */
        if (data.type === "getLeaderboard") {
            const result = Object.entries(leaderboard)
                .map(([name, gold]) => ({
                    name,
                    gold: Number(gold) || 0
                }))
                .sort((a, b) => b.gold - a.gold)
                .slice(0, 50);

            send(ws, {
                type: "leaderboard",
                data: result
            });
        }
    });

    ws.on("close", () => {
        const name = player.name;

        players.delete(ws);

        if (name !== "Player") {
            broadcast({
                type: "system",
                message: `${name} left the game.`
            });
        }

        broadcastPlayerCount();
    });

    ws.on("error", () => {
        players.delete(ws);
    });
});

server.listen(PORT, () => {
    console.log(`Ember Foundry server running on port ${PORT}`);
});
