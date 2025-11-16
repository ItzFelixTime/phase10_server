// server.js
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log("WebSocket Server läuft auf Port", PORT);

let nextPlayerId = 1;

// rooms[roomId] = { hostId, started, players: { playerId: {id,name,avatar,phase,score,ws} } }
const rooms = {};
// socketInfo: ws -> { roomId, playerId }
const socketInfo = new Map();

function generateRoomId() {
  let id;
  do {
    id = Math.floor(10000 + Math.random() * 90000).toString(); // 5-stellig
  } while (rooms[id]);
  return id;
}

function publicPlayers(room) {
  const out = {};
  for (const [id, p] of Object.entries(room.players)) {
    out[id] = {
      name: p.name,
      avatar: p.avatar,
      phase: p.phase,
      score: p.score,
    };
  }
  return out;
}

function broadcastRoom(roomId, msg) {
  const room = rooms[roomId];
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const p of Object.values(room.players)) {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  }
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // ---------- Raum erstellen ----------
    if (msg.type === "createRoom") {
      if (socketInfo.has(ws)) return; // schon in einem Raum

      const name = (msg.name || "Spieler").toString().slice(0, 32);
      const avatar = (msg.avatar || "😄").toString().slice(0, 4);

      const roomId = generateRoomId();
      const playerId = "p" + nextPlayerId++;

      const room = {
        hostId: playerId,
        started: false,
        players: {},
      };
      rooms[roomId] = room;

      room.players[playerId] = {
        id: playerId,
        name,
        avatar,
        phase: 1,
        score: 0,
        ws,
      };

      socketInfo.set(ws, { roomId, playerId });
      console.log(`Room ${roomId} erstellt von ${playerId}`);

      ws.send(
        JSON.stringify({
          type: "roomCreated",
          roomId,
          playerId,
          hostId: room.hostId,
          players: publicPlayers(room),
        })
      );

      broadcastRoom(roomId, {
        type: "players",
        hostId: room.hostId,
        players: publicPlayers(room),
      });

      return;
    }

    // ---------- Raum beitreten ----------
    if (msg.type === "joinRoom") {
      if (socketInfo.has(ws)) return;

      const roomId = (msg.roomId || "").toString().trim();
      const room = rooms[roomId];
      if (!room) {
        ws.send(
          JSON.stringify({
            type: "roomError",
            message: "Raum nicht gefunden.",
          })
        );
        return;
      }
      if (room.started) {
        ws.send(
          JSON.stringify({
            type: "roomError",
            message: "In diesem Raum läuft bereits ein Spiel.",
          })
        );
        return;
      }

      const name = (msg.name || "Spieler").toString().slice(0, 32);
      const avatar = (msg.avatar || "😄").toString().slice(0, 4);
      const playerId = "p" + nextPlayerId++;

      room.players[playerId] = {
        id: playerId,
        name,
        avatar,
        phase: 1,
        score: 0,
        ws,
      };
      socketInfo.set(ws, { roomId, playerId });

      console.log(`Player ${playerId} joined room ${roomId}`);

      ws.send(
        JSON.stringify({
          type: "roomJoined",
          roomId,
          playerId,
          hostId: room.hostId,
          players: publicPlayers(room),
        })
      );

      broadcastRoom(roomId, {
        type: "players",
        hostId: room.hostId,
        players: publicPlayers(room),
      });
      return;
    }

    // Ab hier: Aktionen, die eine Mitgliedschaft voraussetzen
    const info = socketInfo.get(ws);
    if (!info) return;
    const room = rooms[info.roomId];
    if (!room) return;
    const player = room.players[info.playerId];
    if (!player) return;

    // ---------- Name ändern ----------
    if (msg.type === "setName") {
      player.name = (msg.value || "Spieler").toString().slice(0, 32);
      broadcastRoom(info.roomId, {
        type: "players",
        hostId: room.hostId,
        players: publicPlayers(room),
      });
      return;
    }

    // ---------- Phase ändern ----------
    if (msg.type === "setPhase") {
      const v = Number(msg.value) || 1;
      player.phase = Math.max(1, Math.min(10, v));
      broadcastRoom(info.roomId, {
        type: "players",
        hostId: room.hostId,
        players: publicPlayers(room),
      });
      return;
    }

    // ---------- Spiel starten (nur Host) ----------
    if (msg.type === "startGame") {
      if (room.hostId !== info.playerId) return;
      room.started = true;
      broadcastRoom(info.roomId, { type: "roomStart" });
      broadcastRoom(info.roomId, {
        type: "players",
        hostId: room.hostId,
        players: publicPlayers(room),
      });
      return;
    }

    // ---------- Phase beendet ----------
    if (msg.type === "phaseDone") {
      broadcastRoom(info.roomId, {
        type: "roundStart",
        finisher: info.playerId,
        name: player.name,
      });
      return;
    }

    // ---------- Punkte abgeben ----------
    if (msg.type === "scoreSubmit") {
      const pts = Number(msg.points) || 0;
      player.score += pts;
      broadcastRoom(info.roomId, {
        type: "scoreUpdate",
        id: info.playerId,
        points: pts,
        total: player.score,
      });
      broadcastRoom(info.roomId, {
        type: "players",
        hostId: room.hostId,
        players: publicPlayers(room),
      });
      return;
    }

    // ---------- Chat ----------
    if (msg.type === "chat") {
      const text = (msg.text || "").toString().slice(0, 300);
      if (!text) return;
      broadcastRoom(info.roomId, {
        type: "chat",
        id: info.playerId,
        text,
      });
      return;
    }
  });

  ws.on("close", () => {
    const info = socketInfo.get(ws);
    if (!info) return;

    const { roomId, playerId } = info;
    socketInfo.delete(ws);
    const room = rooms[roomId];
    if (!room) return;

    delete room.players[playerId];
    console.log(`Player ${playerId} left room ${roomId}`);

    const remaining = Object.keys(room.players).length;
    if (remaining === 0) {
      delete rooms[roomId];
      console.log(`Room ${roomId} deleted (leer).`);
      return;
    }

    if (room.hostId === playerId) {
      room.hostId = Object.keys(room.players)[0]; // ersten Spieler zum Host machen
      console.log(`Room ${roomId}: Host gewechselt zu ${room.hostId}`);
    }

    broadcastRoom(roomId, {
      type: "players",
      hostId: room.hostId,
      players: publicPlayers(room),
    });
  });
});

console.log("Ready.");
