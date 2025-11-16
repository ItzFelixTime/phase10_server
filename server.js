import { WebSocketServer } from "ws";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ==== Datenstrukturen ====

let rooms = {}; 
// rooms[roomId] = { hostId, players: { id: {...} } }

let connections = {}; 
// connections[id] = ws

function makeRoomCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function broadcastRoom(roomId, msg) {
  const room = rooms[roomId];
  if (!room) return;

  const data = JSON.stringify(msg);

  for (const pid of Object.keys(room.players)) {
    const ws = connections[pid];
    if (ws && ws.readyState === 1) {
      ws.send(data);
    }
  }
}

// ==== WebSocket Server ====

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

wss.on("connection", (ws) => {
  const playerId = "p" + Math.random().toString(36).slice(2,10);
  connections[playerId] = ws;

  let currentRoom = null;

  ws.send(JSON.stringify({
    type: "welcome",
    playerId
  }));

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ============= ROOM ERSTELLEN =================
    if (msg.type === "createRoom") {
      let code;
      do {
        code = makeRoomCode();
      } while (rooms[code]);

      rooms[code] = {
        hostId: playerId,
        players: {}
      };

      // Spieler eintragen
      rooms[code].players[playerId] = {
        id: playerId,
        name: msg.name || "Spieler",
        avatarUrl: msg.avatarUrl || null,
        phase: 1,
        score: 0
      };

      currentRoom = code;

      ws.send(JSON.stringify({
        type: "roomCreated",
        roomId: code,
        hostId: playerId,
        players: rooms[code].players
      }));
      return;
    }

    // ============= ROOM BEITRETEN =================
    if (msg.type === "joinRoom") {
      const roomId = msg.roomId;
      const room = rooms[roomId];

      if (!room) {
        ws.send(JSON.stringify({ type: "joinError", message: "Raum nicht gefunden." }));
        return;
      }

      room.players[playerId] = {
        id: playerId,
        name: msg.name || "Spieler",
        avatarUrl: msg.avatarUrl || null,
        phase: 1,
        score: 0
      };

      currentRoom = roomId;

      // Spieler bekommt aktuellen Zustand
      ws.send(JSON.stringify({
        type: "roomJoined",
        roomId,
        hostId: room.hostId,
        players: room.players
      }));

      // an alle broadcasten
      broadcastRoom(roomId, {
        type: "playersUpdated",
        players: room.players
      });

      return;
    }

    // ============= KI AVATAR GENERIEREN =================
    if (msg.type === "generateAvatar") {
      if (!currentRoom) return;

      const prompt = msg.prompt.trim().slice(0,400);

      try {
        const res = await openai.images.generate({
          model: "image-mini-1.0",
          prompt: prompt + " – round cute avatar icon, centered face portrait, 128x128",
          size: "128x128"
        });

        const url = res.data[0].url;

        rooms[currentRoom].players[playerId].avatarUrl = url;

        broadcastRoom(currentRoom, {
          type: "avatarUpdated",
          id: playerId,
          avatarUrl: url
        });

      } catch (e) {
        ws.send(JSON.stringify({
          type: "avatarError",
          message: "Avatar konnte nicht generiert werden."
        }));
      }
      return;
    }

    // ============= SPIEL STARTEN =================
    if (msg.type === "startGame") {
      if (!currentRoom) return;

      const room = rooms[currentRoom];
      if (playerId !== room.hostId) return;

      broadcastRoom(currentRoom, { type: "gameStarted" });
      return;
    }

    // ============= NAME ÄNDERN =================
    if (msg.type === "setName") {
      if (!currentRoom) return;
      rooms[currentRoom].players[playerId].name = msg.value;

      broadcastRoom(currentRoom, {
        type: "playersUpdated",
        players: rooms[currentRoom].players
      });
      return;
    }

    // ============= PHASE ÄNDERN =================
    if (msg.type === "setPhase") {
      if (!currentRoom) return;
      rooms[currentRoom].players[playerId].phase = msg.value;

      broadcastRoom(currentRoom, {
        type: "playersUpdated",
        players: rooms[currentRoom].players
      });
      return;
    }

    // ============= PHASE BEENDET =================
    if (msg.type === "phaseDone") {
      if (!currentRoom) return;
      broadcastRoom(currentRoom, {
        type: "phaseDone",
        id: playerId,
        name: rooms[currentRoom].players[playerId].name
      });
      return;
    }

    // ============= SCORE EINGEREICHT =================
    if (msg.type === "scoreSubmit") {
      if (!currentRoom) return;

      const pts = msg.points || 0;
      rooms[currentRoom].players[playerId].score += pts;

      broadcastRoom(currentRoom, {
        type: "playersUpdated",
        players: rooms[currentRoom].players
      });

      return;
    }

    // ============= CHAT =================
    if (msg.type === "chat") {
      if (!currentRoom) return;

      broadcastRoom(currentRoom, {
        type: "chat",
        id: playerId,
        text: msg.text,
        name: rooms[currentRoom].players[playerId].name
      });
      return;
    }
  });

  ws.on("close", () => {
    delete connections[playerId];

    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].players[playerId];

      broadcastRoom(currentRoom, {
        type: "playersUpdated",
        players: rooms[currentRoom].players
      });

      // Raum löschen wenn leer
      if (Object.keys(rooms[currentRoom].players).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

console.log("Server läuft…");
