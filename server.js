const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const ADMIN_PASSWORD = 'admin';

let gameState = {
  pot: 0,
  players: [],
  currentTurn: 0,
  gameStarted: false,
  bootAmount: 2,
  lastWinner: '',
  showAllCards: false
};

const suits = ['♠', '♥', '♦', '♣'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const avatars = ['👑', '🤠', '😎', '🦊', '🦁', '🤖', '🃏'];

function createDeck() {
  let deck = [];
  for (let s of suits) {
    for (let v of values) {
      deck.push({ suit: s, value: v });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function startNewGame() {
  const activePlayers = gameState.players.filter(p => p.chips >= gameState.bootAmount);
  if (activePlayers.length < 2) {
    gameState.gameStarted = false;
    return;
  }

  const deck = createDeck();
  gameState.pot = activePlayers.length * gameState.bootAmount;
  gameState.gameStarted = true;
  gameState.currentTurn = 0;
  gameState.showAllCards = false;
  gameState.lastWinner = '';

  gameState.players.forEach(p => {
    if (p.chips >= gameState.bootAmount) {
      p.chips -= gameState.bootAmount;
      p.status = 'BLIND';
      p.cards = [deck.pop(), deck.pop(), deck.pop()];
      p.seeCards = false;
    } else {
      p.status = 'OUT';
      p.cards = [];
    }
  });
}

function nextTurn() {
  if (gameState.players.length === 0) return;
  let count = 0;
  do {
    gameState.currentTurn = (gameState.currentTurn + 1) % gameState.players.length;
    count++;
  } while (
    (gameState.players[gameState.currentTurn].status === 'PACKED' ||
     gameState.players[gameState.currentTurn].status === 'OUT') &&
    count < gameState.players.length
  );
}

function checkRemainingPlayers() {
  const active = gameState.players.filter(p => p.status !== 'PACKED' && p.status !== 'OUT');
  if (active.length <= 1 && gameState.gameStarted) {
    const winner = active[0] || gameState.players[0];
    if (winner) {
      winner.chips += gameState.pot;
      gameState.lastWinner = winner.name + ' won ₹' + gameState.pot;
    }
    gameState.showAllCards = true;
    gameState.gameStarted = false;
    setTimeout(() => {
      startNewGame();
      io.emit('gameState', gameState);
    }, 4000);
  }
}

io.on('connection', (socket) => {
  socket.emit('gameState', gameState);

  socket.on('joinGame', ({ name, role, password }) => {
    let isAdmin = false;
    if (role === 'admin') {
      if (password === ADMIN_PASSWORD) {
        isAdmin = true;
      } else {
        socket.emit('authError', 'Invalid Admin Password!');
        return;
      }
    }

    const existingIndex = gameState.players.findIndex(p => p.id === socket.id);
    const avatar = isAdmin ? '👑' : avatars[gameState.players.length % avatars.length];

    const playerObj = {
      id: socket.id,
      name: name || (isAdmin ? 'Admin' : 'Player ' + (gameState.players.length + 1)),
      chips: 1000,
      status: 'BLIND',
      cards: [],
      seeCards: false,
      isAdmin: isAdmin,
      avatar: avatar
    };

    if (existingIndex !== -1) {
      gameState.players[existingIndex] = playerObj;
    } else {
      gameState.players.push(playerObj);
    }

    if (!gameState.gameStarted && gameState.players.length >= 2) {
      startNewGame();
    }

    socket.emit('joinedSuccess', { isAdmin });
    io.emit('gameState', gameState);
  });

  socket.on('playerAction', ({ action }) => {
    const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;
    const player = gameState.players[playerIndex];

    if (action === 'see') {
      player.seeCards = true;
      player.status = 'SEEN';
      io.emit('gameState', gameState);
      return;
    }

    if (gameState.gameStarted && gameState.currentTurn !== playerIndex && !player.isAdmin) {
      return;
    }

    if (action === 'pack') {
      player.status = 'PACKED';
      nextTurn();
      checkRemainingPlayers();
    } else if (action === 'blind') {
      const amt = 10;
      if (player.chips >= amt) {
        player.chips -= amt;
        gameState.pot += amt;
        nextTurn();
      }
    } else if (action === 'chaal') {
      const amt = player.status === 'BLIND' ? 10 : 20;
      if (player.chips >= amt) {
        player.chips -= amt;
        gameState.pot += amt;
        nextTurn();
      }
    } else if (action === 'show') {
      const active = gameState.players.filter(p => p.status !== 'PACKED' && p.status !== 'OUT');
      if (active.length >= 2) {
        const winner = active[Math.floor(Math.random() * active.length)];
        winner.chips += gameState.pot;
        gameState.lastWinner = winner.name + ' won Show (₹' + gameState.pot + ')';
        gameState.showAllCards = true;
        gameState.gameStarted = false;
        setTimeout(() => {
          startNewGame();
          io.emit('gameState', gameState);
        }, 4000);
      }
    } else if (action === 'resetGame' && player.isAdmin) {
      startNewGame();
    }

    io.emit('gameState', gameState);
  });

  socket.on('disconnect', () => {
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    if (gameState.players.length < 2) {
      gameState.gameStarted = false;
      gameState.currentTurn = 0;
    } else {
      if (gameState.currentTurn >= gameState.players.length) {
        gameState.currentTurn = 0;
      }
      checkRemainingPlayers();
    }
    io.emit('gameState', gameState);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('3Patti Server active on port ' + PORT));
