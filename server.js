import { WebSocketServer } from "ws";

// Spieler-Datenbank
let players = {}; // id -> {name, phase, score}
let nextPlayerId = 1;

// WebSocket-Server starten
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log("WebSocket Server läuft auf Port", PORT);

// Nachricht an alle Spieler senden
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

// Verbindung hergestellt
wss.on("connection", (ws) => {
  const id = "p" + nextPlayerId++;
  players[id] = {
    name: "Spieler",
    phase: 1,
    score: 0,
  };

  console.log("Spieler beigetreten:", id);

  // Initiale Begrüßung + gesamte Spielerliste
  ws.send(
    JSON.stringify({
      type: "welcome",
      id,
      players,
    })
  );

  // Nachrichten vom Client
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    // Name geändert
    if (msg.type === "setName") {
      players[id].name = msg.value;
      broadcast({ type: "players", players });
    }

    // Chat
if (msg.type === "chat") {
  broadcast({
    type: "chat",
    id,
    text: msg.text
  });
}

    // Phase geändert
    if (msg.type === "setPhase") {
      players[id].phase = msg.value;
      broadcast({ type: "players", players });
    }

    // Jemand hat seine Phase beendet → neue Runde
    if (msg.type === "phaseDone") {
      broadcast({
        type: "roundStart",
        finisher: id,
        name: players[id].name,
      });
    }

    // Punkte eines Spielers nach der Runde
    if (msg.type === "scoreSubmit") {
      players[id].score += msg.points;

      broadcast({
        type: "scoreUpdate",
        id,
        points: msg.points,
        total: players[id].score,
      });

      broadcast({ type: "players", players });
    }
  });

  // Verbindung getrennt
  ws.on("close", () => {
    console.log("Spieler verlassen:", id);
    delete players[id];
    broadcast({ type: "players", players });
  });
});
