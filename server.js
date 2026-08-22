const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

let gameState = {
  pot: 0,
  players: [],
  currentTurn: 0,
  gameStarted: false
};

const suits = ['♠', '♥', '♦', '♣'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

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
  if (gameState.players.length < 1) return;
  const deck = createDeck();
  gameState.pot = gameState.players.length * 2;
  gameState.gameStarted = true;
  gameState.currentTurn = 0;

  gameState.players.forEach(p => {
    p.chips -= 2;
    p.status = 'BLIND';
    p.cards = [deck.pop(), deck.pop(), deck.pop()];
    p.seeCards = false;
  });
}

io.on('connection', (socket) => {
  socket.emit('gameState', gameState);

  socket.on('joinGame', ({ name, role }) => {
    const existing = gameState.players.find(p => p.id === socket.id);
    if (!existing) {
      gameState.players.push({
        id: socket.id,
        name: name || (role === 'admin' ? 'Admin' : 'Player'),
        chips: 1000,
        status: 'BLIND',
        cards: [],
        seeCards: false,
        isAdmin: role === 'admin'
      });
    }

    if (!gameState.gameStarted && gameState.players.length >= 2) {
      startNewGame();
    }

    io.emit('gameState', gameState);
  });

  socket.on('playerAction', ({ action }) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;

    if (action === 'see') {
      player.seeCards = true;
      player.status = 'SEEN';
    } else if (action === 'pack') {
      player.status = 'PACKED';
    } else if (action === 'blind' || action === 'chaal') {
      const amount = player.status === 'BLIND' ? 10 : 20;
      player.chips -= amount;
      gameState.pot += amount;
    }

    io.emit('gameState', gameState);
  });

  socket.on('disconnect', () => {
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    if (gameState.players.length === 0) {
      gameState.gameStarted = false;
      gameState.pot = 0;
    }
    io.emit('gameState', gameState);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
