{\rtf1\ansi\ansicpg1252\cocoartf2867
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 import \{ WebSocketServer \} from "ws";\
\
// Spieler-Datenbank\
let players = \{\}; // id -> \{name, phase, score\}\
let nextPlayerId = 1;\
\
// WebSocket-Server starten\
const PORT = process.env.PORT || 8080;\
const wss = new WebSocketServer(\{ port: PORT \});\
\
console.log("WebSocket Server l\'e4uft auf Port", PORT);\
\
// Nachricht an alle Spieler senden\
function broadcast(msg) \{\
  const data = JSON.stringify(msg);\
  for (const client of wss.clients) \{\
    if (client.readyState === 1) \{\
      client.send(data);\
    \}\
  \}\
\}\
\
// Verbindung hergestellt\
wss.on("connection", (ws) => \{\
  const id = "p" + nextPlayerId++;\
  players[id] = \{\
    name: "Spieler",\
    phase: 1,\
    score: 0,\
  \};\
\
  console.log("Spieler beigetreten:", id);\
\
  // Initiale Begr\'fc\'dfung + gesamte Spielerliste\
  ws.send(\
    JSON.stringify(\{\
      type: "welcome",\
      id,\
      players,\
    \})\
  );\
\
  // Nachrichten vom Client\
  ws.on("message", (raw) => \{\
    let msg;\
    try \{\
      msg = JSON.parse(raw);\
    \} catch (e) \{\
      return;\
    \}\
\
    // Name ge\'e4ndert\
    if (msg.type === "setName") \{\
      players[id].name = msg.value;\
      broadcast(\{ type: "players", players \});\
    \}\
\
    // Phase ge\'e4ndert\
    if (msg.type === "setPhase") \{\
      players[id].phase = msg.value;\
      broadcast(\{ type: "players", players \});\
    \}\
\
    // Jemand hat seine Phase beendet \uc0\u8594  neue Runde\
    if (msg.type === "phaseDone") \{\
      broadcast(\{\
        type: "roundStart",\
        finisher: id,\
        name: players[id].name,\
      \});\
    \}\
\
    // Punkte eines Spielers nach der Runde\
    if (msg.type === "scoreSubmit") \{\
      players[id].score += msg.points;\
\
      broadcast(\{\
        type: "scoreUpdate",\
        id,\
        points: msg.points,\
        total: players[id].score,\
      \});\
\
      broadcast(\{ type: "players", players \});\
    \}\
  \});\
\
  // Verbindung getrennt\
  ws.on("close", () => \{\
    console.log("Spieler verlassen:", id);\
    delete players[id];\
    broadcast(\{ type: "players", players \});\
  \});\
\});}