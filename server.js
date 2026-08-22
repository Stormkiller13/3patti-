const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Helper: Card Deck & Evaluation
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let s of suits) {
    for (let v of values) {
      deck.push({ suit: s, value: v, rank: values.indexOf(v) + 2 });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function evaluateHand(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  const isSequence = (ranks[0] - ranks[1] === 1 && ranks[1] - ranks[2] === 1) ||
                     (ranks[0] === 14 && ranks[1] === 3 && ranks[2] === 2);
  const isTrail = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  const isPair = ranks[0] === ranks[1] || ranks[1] === ranks[2] || ranks[0] === ranks[2];

  if (isTrail) return 6000000 + ranks[0];
  if (isSequence && isFlush) return 5000000 + ranks[0];
  if (isSequence) return 4000000 + ranks[0];
  if (isFlush) return 3000000 + ranks[0] * 100 + ranks[1] * 10 + ranks[2];
  if (isPair) {
    const pairRank = ranks[0] === ranks[1] ? ranks[0] : ranks[1] === ranks[2] ? ranks[1] : ranks[2];
    const kicker = ranks.find(r => r !== pairRank);
    return 2000000 + pairRank * 10 + kicker;
  }
  return 1000000 + ranks[0] * 100 + ranks[1] * 10 + ranks[2];
}

function getActivePlayers(room) {
  return room.players.filter(p => !p.isPacked && !p.disconnected);
}

function advanceTurn(room) {
  let active = getActivePlayers(room);
  if (active.length <= 1) {
    endGame(room, active[0]);
    return;
  }
  do {
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
  } while (room.players[room.currentTurnIndex].isPacked || room.players[room.currentTurnIndex].disconnected);
  
  broadcastState(room);
}

function endGame(room, winner) {
  room.gameStarted = false;
  if (winner) {
    winner.chips += room.pot;
    room.lastWinner = winner.name;
  }
  room.pot = 0;
  broadcastState(room);
}

function broadcastState(room) {
  io.to(room.id).emit('gameState', {
    roomId: room.id,
    adminId: room.adminId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      isBlind: p.isBlind,
      isPacked: p.isPacked,
      blindCountAfterSeen: p.blindCountAfterSeen,
      disconnected: p.disconnected,
      cardCount: p.cards ? p.cards.length : 0
    })),
    currentTurnIndex: room.currentTurnIndex,
    pot: room.pot,
    currentBet: room.currentBet,
    gameStarted: room.gameStarted,
    lastWinner: room.lastWinner
  });
}

io.on('connection', (socket) => {

  socket.on('joinRoom', ({ roomId, playerName, playerId }) => {
    let room = rooms[roomId];
    if (!room) {
      room = {
        id: roomId,
        adminId: socket.id,
        players: [],
        currentTurnIndex: 0,
        pot: 0,
        currentBet: 2,
        gameStarted: false,
        deck: []
      };
      rooms[roomId] = room;
    }

    socket.join(roomId);
    socket.roomId = roomId;

    let existingPlayer = room.players.find(p => p.id === playerId);
    if (existingPlayer) {
      existingPlayer.socketId = socket.id;
      existingPlayer.disconnected = false;
      if (existingPlayer.disconnectTimer) clearTimeout(existingPlayer.disconnectTimer);
      socket.emit('reconnected', { player: existingPlayer, cards: existingPlayer.cards });
    } else {
      const newPlayer = {
        id: playerId || socket.id,
        socketId: socket.id,
        name: playerName || `Player_${socket.id.substring(0, 4)}`,
        chips: 1000,
        cards: [],
        isBlind: true,
        isPacked: false,
        blindCountAfterSeen: 0,
        disconnected: false
      };
      room.players.push(newPlayer);
    }

    if (!room.adminId || !room.players.some(p => p.socketId === room.adminId)) {
      room.adminId = socket.id;
    }

    broadcastState(room);
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomId];
    if (!room || room.adminId !== socket.id) return;

    room.deck = createDeck();
    room.pot = 0;
    room.currentBet = 2;
    room.gameStarted = true;

    room.players.forEach(p => {
      if (!p.disconnected) {
        p.cards = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
        p.isBlind = true;
        p.isPacked = false;
        p.blindCountAfterSeen = 0;
        p.chips -= room.currentBet;
        room.pot += room.currentBet;
      }
    });

    room.currentTurnIndex = 0;
    broadcastState(room);

    room.players.forEach(p => {
      io.to(p.socketId).emit('dealCards', { cards: p.cards });
    });
  });

  socket.on('playerMove', ({ action }) => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;

    const player = room.players[room.currentTurnIndex];
    if (player.socketId !== socket.id) return;

    if (action === 'see') {
      player.isBlind = false;
      socket.emit('cardsRevealed', player.cards);
      broadcastState(room);
      return;
    }

    if (action === 'pack') {
      player.isPacked = true;
      advanceTurn(room);
      return;
    }

    const hasSeenPlayerOnTable = room.players.some(p => !p.isPacked && !p.disconnected && !p.isBlind);

    if (player.isBlind) {
      if (hasSeenPlayerOnTable) {
        player.blindCountAfterSeen += 1;
        if (player.blindCountAfterSeen >= 3) {
          player.isBlind = false;
          socket.emit('cardsRevealed', player.cards);
          socket.emit('message', '3 Blind rounds limit reached. You are now playing SEEN.');
        }
      }
    }

    let betAmount = player.isBlind ? room.currentBet : room.currentBet * 2;
    player.chips -= betAmount;
    room.pot += betAmount;

    advanceTurn(room);
  });

  socket.on('sideshow', () => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;

    const player = room.players[room.currentTurnIndex];
    if (player.socketId !== socket.id) return;

    const isAnyPlayerBlind = room.players.some(p => !p.isPacked && !p.disconnected && p.isBlind);
    if (isAnyPlayerBlind) {
      return socket.emit('errorMsg', 'Sideshow unavailable: All active players on table must be SEEN.');
    }

    let prevIndex = (room.currentTurnIndex - 1 + room.players.length) % room.players.length;
    while (room.players[prevIndex].isPacked || room.players[prevIndex].disconnected) {
      prevIndex = (prevIndex - 1 + room.players.length) % room.players.length;
    }
    const targetPlayer = room.players[prevIndex];

    const val1 = evaluateHand(player.cards);
    const val2 = evaluateHand(targetPlayer.cards);

    if (val1 > val2) {
      targetPlayer.isPacked = true;
      io.to(room.id).emit('message', `${player.name} won sideshow against ${targetPlayer.name}.`);
    } else {
      player.isPacked = true;
      io.to(room.id).emit('message', `${targetPlayer.name} won sideshow against ${player.name}.`);
    }

    advanceTurn(room);
  });

  socket.on('kickPlayer', (targetPlayerId) => {
    const room = rooms[socket.roomId];
    if (!room || room.adminId !== socket.id) return;

    const targetIndex = room.players.findIndex(p => p.id === targetPlayerId);
    if (targetIndex !== -1) {
      const target = room.players[targetIndex];
      io.to(target.socketId).emit('kicked', 'You were removed by the room admin.');
      room.players.splice(targetIndex, 1);

      if (room.gameStarted && room.currentTurnIndex === targetIndex) {
        advanceTurn(room);
      } else {
        broadcastState(room);
      }
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      player.disconnected = true;
      broadcastState(room);

      player.disconnectTimer = setTimeout(() => {
        const index = room.players.indexOf(player);
        if (index !== -1 && player.disconnected) {
          room.players.splice(index, 1);
          if (room.players.length === 0) {
            delete rooms[room.id];
          } else {
            if (room.adminId === socket.id) room.adminId = room.players[0].socketId;
            broadcastState(room);
          }
        }
      }, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
