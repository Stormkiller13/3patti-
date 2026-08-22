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
const valueRank = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
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

function evaluateHand(cards) {
  if (!cards || cards.length !== 3) return 0;
  
  let vals = cards.map(c => valueRank[c.value]).sort((a, b) => a - b);
  let v1 = vals[0], v2 = vals[1], v3 = vals[2];
  let isFlush = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
  
  let isSeq = (v1 + 1 === v2 && v2 + 1 === v3) || (v1 === 2 && v2 === 3 && v3 === 14);
  let isTrail = (v1 === v2 && v2 === v3);
  let isPair = (v1 === v2 || v2 === v3 || v1 === v3);

  let seqScore = (v1 === 2 && v3 === 14) ? 13.5 : v3;

  if (isTrail) return 6000000 + v1;
  if (isFlush && isSeq) return 5000000 + seqScore;
  if (isSeq) return 4000000 + seqScore;
  if (isFlush) return 3000000 + v3 * 400 + v2 * 20 + v1;
  if (isPair) {
    let pairVal = (v1 === v2) ? v1 : ((v2 === v3) ? v2 : v1);
    let kicker = (v1 === v2) ? v3 : ((v2 === v3) ? v1 : v2);
    return 2000000 + pairVal * 100 + kicker;
  }
  return 1000000 + v3 * 400 + v2 * 20 + v1;
}

function ensureValidTurn() {
  if (gameState.players.length === 0) return;
  let count = 0;
  while (
    (gameState.players[gameState.currentTurn].status === 'PACKED' ||
     gameState.players[gameState.currentTurn].status === 'OUT' ||
     gameState.players[gameState.currentTurn].status === 'WAITING') &&
    count < gameState.players.length
  ) {
    gameState.currentTurn = (gameState.currentTurn + 1) % gameState.players.length;
    count++;
  }
}

function startNewGame() {
  const eligible = gameState.players.filter(p => p.chips >= gameState.bootAmount);
  if (eligible.length < 2) {
    gameState.gameStarted = false;
    return;
  }

  const deck = createDeck();
  gameState.pot = eligible.length * gameState.bootAmount;
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

  ensureValidTurn();
}

function nextTurn() {
  if (gameState.players.length === 0) return;
  gameState.currentTurn = (gameState.currentTurn + 1) % gameState.players.length;
  ensureValidTurn();
}

function checkRemainingPlayers() {
  const active = gameState.players.filter(p => p.status !== 'PACKED' && p.status !== 'OUT' && p.status !== 'WAITING');
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

    if (existingIndex !== -1) {
      // Preserve existing player state on reconnect/re-login
      gameState.players[existingIndex].name = name || gameState.players[existingIndex].name;
      gameState.players[existingIndex].isAdmin = isAdmin;
      gameState.players[existingIndex].avatar = avatar;
    } else {
      const playerObj = {
        id: socket.id,
        name: name || (isAdmin ? 'Admin' : 'Player ' + (gameState.players.length + 1)),
        chips: 1000,
        status: gameState.gameStarted ? 'WAITING' : 'BLIND',
        cards: [],
        seeCards: false,
        isAdmin: isAdmin,
        avatar: avatar
      };
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
      // Allow card viewing only if player is actively BLIND
      if (player.status === 'BLIND') {
        player.seeCards = true;
        player.status = 'SEEN';
        io.emit('gameState', gameState);
      }
      return;
    }

    if (gameState.gameStarted && gameState.currentTurn !== playerIndex && !player.isAdmin) {
      return;
    }

    if (action === 'pack') {
      player.status = 'PACKED';
      nextTurn();
      checkRemainingPlayers();
    } else if (action === 'blind' || action === 'chaal') {
      const requiredAmount = player.status === 'SEEN' ? 20 : 10;
      
      if (player.chips >= requiredAmount) {
        player.chips -= requiredAmount;
        gameState.pot += requiredAmount;
        nextTurn();
      } else {
        player.status = 'PACKED';
        nextTurn();
        checkRemainingPlayers();
      }
    } else if (action === 'show') {
      const active = gameState.players.filter(p => p.status !== 'PACKED' && p.status !== 'OUT' && p.status !== 'WAITING');
      
      if (active.length === 2) {
        const requiredAmount = player.status === 'SEEN' ? 20 : 10;
        
        if (player.chips < requiredAmount) {
          player.status = 'PACKED';
          nextTurn();
          checkRemainingPlayers();
          io.emit('gameState', gameState);
          return;
        }

        player.chips -= requiredAmount;
        gameState.pot += requiredAmount;

        let bestScore = -1;
        let winner = active[0];

        active.forEach(p => {
          let score = evaluateHand(p.cards);
          if (score > bestScore) {
            bestScore = score;
            winner = p;
          }
        });

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
      ensureValidTurn();
      checkRemainingPlayers();
    }
    io.emit('gameState', gameState);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('3Patti Server active on port ' + PORT));
