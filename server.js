const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  transports: ['websocket'],
  pingInterval: 10000,
  pingTimeout: 5000
});

const ADMIN_CREDS = { username: 'Admin', password: '7204593508' };

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
const HAND_NAMES = { 6: 'Trio / Trail', 5: 'Pure Sequence', 4: 'Sequence', 3: 'Color / Flush', 2: 'Pair', 1: 'High Card' };

let gameState = {
  pot: 0,
  currentTurnId: null,
  turnTimer: 30,
  isExtraTime: false,
  players: {},
  adminId: null,
  statusMessage: 'Waiting for at least 2 players...',
  gameActive: false,
  bootAmount: 10,
  blindAmount: 10,
  chaalAmount: 20,
  showAmount: 20,
  isShowPhase: false,
  dealerId: null,
  winnerId: null,
  winningHandName: '',
  sideshowPending: null,
  lastBetSenderId: null
};

let timerInterval = null;

function createDeck() {
  let deck = [];
  for (let s of SUITS) {
    for (let r of RANKS) deck.push({ rank: r, suit: s });
  }
  return deck.sort(() => Math.random() - 0.5);
}

function evaluateHand(cards) {
  let vals = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  let suits = cards.map(c => c.suit);
  let isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  let isSeq = false;

  if (vals[0] - vals[1] === 1 && vals[1] - vals[2] === 1) {
    isSeq = true;
  } else if (vals[0] === 14 && vals[1] === 3 && vals[2] === 2) {
    isSeq = true;
    vals = [3, 2, 1];
  }

  let score = 1;
  if (vals[0] === vals[1] && vals[1] === vals[2]) score = 6;
  else if (isSeq && isFlush) score = 5;
  else if (isSeq) score = 4;
  else if (isFlush) score = 3;
  else if (vals[0] === vals[1] || vals[1] === vals[2] || vals[0] === vals[2]) {
    let pairVal = (vals[0] === vals[1]) ? vals[0] : (vals[1] === vals[2] ? vals[1] : vals[0]);
    let kicker = (vals[0] === vals[1]) ? vals[2] : (vals[1] === vals[2] ? vals[0] : vals[1]);
    return { score: 2, vals: [pairVal, kicker], handName: HAND_NAMES[2] };
  }

  return { score, vals, handName: HAND_NAMES[score] };
}

function compareHands(handA, handB) {
  if (handA.score !== handB.score) return handA.score - handB.score;
  for (let i = 0; i < handA.vals.length; i++) {
    if (handA.vals[i] !== handB.vals[i]) return handA.vals[i] - handB.vals[i];
  }
  return 0;
}

function getActivePlayers() {
  return Object.keys(gameState.players).filter(id => 
    gameState.players[id].status !== 'PACKED' && 
    gameState.players[id].status !== 'WAITING' && 
    gameState.players[id].status !== 'AFK'
  );
}

function getPreviousActiveSeenPlayer(currentTurnId) {
  const activePlayers = getActivePlayers();
  let idx = activePlayers.indexOf(currentTurnId);
  if (idx <= 0) idx = activePlayers.length;
  let prevId = activePlayers[idx - 1];
  if (gameState.players[prevId] && gameState.players[prevId].seen) {
    return prevId;
  }
  return null;
}

function startNewRound() {
  const eligiblePlayerIds = Object.keys(gameState.players).filter(id => !gameState.players[id].isAfk);
  if (eligiblePlayerIds.length < 2) {
    clearInterval(timerInterval);
    gameState.gameActive = false;
    gameState.currentTurnId = null;
    gameState.isShowPhase = false;
    gameState.statusMessage = 'Waiting for at least 2 active players...';
    gameState.winningHandName = '';
    broadcastState();
    return;
  }

  let deck = createDeck();
  gameState.pot = 0;
  gameState.gameActive = true;
  gameState.isShowPhase = false;
  gameState.winningHandName = '';
  gameState.sideshowPending = null;
  gameState.statusMessage = 'Dealing cards...';

  if (!gameState.dealerId || !gameState.players[gameState.dealerId] || gameState.players[gameState.dealerId].isAfk) {
    gameState.dealerId = eligiblePlayerIds[0];
    gameState.currentTurnId = eligiblePlayerIds[0];
  } else {
    let prevWinnerIndex = eligiblePlayerIds.indexOf(gameState.dealerId);
    if (prevWinnerIndex === -1) {
      gameState.currentTurnId = eligiblePlayerIds[0];
    } else {
      let nextStartIndex = (prevWinnerIndex + 1) % eligiblePlayerIds.length;
      gameState.currentTurnId = eligiblePlayerIds[nextStartIndex];
    }
  }

  eligiblePlayerIds.forEach(id => {
    let p = gameState.players[id];
    p.status = 'BLIND';
    p.cards = [deck.pop(), deck.pop(), deck.pop()];
    p.seen = false;
    p.coins = Math.max(0, p.coins - gameState.bootAmount);
    gameState.pot += gameState.bootAmount;
  });

  resetTimer();
  broadcastState();

  setTimeout(() => {
    gameState.statusMessage = 'Round Started! Place Blind (₹10) or Chaal (₹20).';
    broadcastState();
  }, 2500);
}

function resetTimer() {
  if (timerInterval) clearInterval(timerInterval);

  const activePlayers = getActivePlayers();
  if (activePlayers.length < 2) {
    if (activePlayers.length === 1 && gameState.gameActive) {
      declareWinner(activePlayers[0]);
    }
    return;
  }

  gameState.turnTimer = 30;
  gameState.isExtraTime = false;

  timerInterval = setInterval(() => {
    if (!gameState.gameActive || !gameState.currentTurnId) {
      clearInterval(timerInterval);
      return;
    }

    gameState.turnTimer--;

    if (gameState.turnTimer <= 0) {
      if (!gameState.isExtraTime) {
        gameState.isExtraTime = true;
        gameState.turnTimer = 10;
      } else {
        clearInterval(timerInterval);
        autoPackCurrentPlayer();
        return;
      }
    }
    io.emit('timerUpdate', { timer: gameState.turnTimer, isExtraTime: gameState.isExtraTime });
  }, 1000);
}

function autoPackCurrentPlayer() {
  const currentId = gameState.currentTurnId;
  if (currentId && gameState.players[currentId]) {
    const p = gameState.players[currentId];
    p.status = 'PACKED';
    p.consecutiveTimeouts = (p.consecutiveTimeouts || 0) + 1;
    
    if (p.consecutiveTimeouts >= 2) {
      p.isAfk = true;
      p.status = 'AFK';
      gameState.statusMessage = `${p.name} marked AFK due to inactivity.`;
    }

    nextTurn();
  }
}

function nextTurn() {
  const activePlayers = getActivePlayers();
  if (activePlayers.length <= 1) {
    if (activePlayers.length === 1) declareWinner(activePlayers[0]);
    return;
  }
  let currentIndex = activePlayers.indexOf(gameState.currentTurnId);
  let nextIndex = (currentIndex + 1) % activePlayers.length;
  gameState.currentTurnId = activePlayers[nextIndex];
  resetTimer();
  broadcastState();
}

function declareWinner(winnerId, isShow = false) {
  if (timerInterval) clearInterval(timerInterval);

  const winner = gameState.players[winnerId];
  if (winner) {
    winner.coins += gameState.pot;
    const handEval = evaluateHand(winner.cards);
    gameState.winningHandName = handEval.handName;
    gameState.statusMessage = `🏆 ${winner.name} Won ₹${gameState.pot}! (${gameState.winningHandName}) 🏆`;
    gameState.dealerId = winnerId;
    gameState.winnerId = winnerId;
  }

  gameState.gameActive = false;
  gameState.currentTurnId = null;
  gameState.isShowPhase = isShow;

  broadcastState(isShow);

  const waitTime = isShow ? 5000 : 3500;
  setTimeout(() => {
    gameState.isShowPhase = false;
    gameState.winnerId = null;
    gameState.winningHandName = '';
    startNewRound();
  }, waitTime);
}

function sanitizeState(revealAllCards = false) {
  let copy = JSON.parse(JSON.stringify(gameState));
  for (let id in copy.players) {
    if (!revealAllCards) {
      copy.players[id].cards = [null, null, null];
    }
  }
  return copy;
}

function broadcastState(revealAllCards = false) {
  io.emit('stateUpdate', sanitizeState(revealAllCards));
}

io.on('connection', (socket) => {
  broadcastState();

  socket.on('joinAdmin', (data) => {
    if (data.username === ADMIN_CREDS.username && data.password === ADMIN_CREDS.password) {
      gameState.adminId = socket.id;
      gameState.players[socket.id] = { id: socket.id, name: 'Admin', coins: 10000, status: 'WAITING', cards: [], consecutiveTimeouts: 0, isAfk: false };
      socket.emit('adminAuthSuccess');
      if (!gameState.gameActive) startNewRound();
      broadcastState();
    } else {
      socket.emit('adminAuthFailed', 'Invalid Admin Credentials');
    }
  });

  socket.on('joinPlayer', (data) => {
    if (!data.name) return;
    gameState.players[socket.id] = { id: socket.id, name: data.name, coins: 1000, status: 'WAITING', cards: [], consecutiveTimeouts: 0, isAfk: false };
    if (!gameState.gameActive) startNewRound();
    broadcastState();
  });

  socket.on('rejoinAfk', () => {
    const player = gameState.players[socket.id];
    if (player) {
      player.isAfk = false;
      player.consecutiveTimeouts = 0;
      player.status = 'WAITING';
      gameState.statusMessage = `${player.name} returned to the game.`;
      if (!gameState.gameActive) startNewRound();
      broadcastState();
    }
  });

  socket.on('playerAction', (data) => {
    const player = gameState.players[socket.id];
    if (!player) return;

    if (data.action === 'SEE') {
      player.seen = true;
      player.status = 'SEEN';
      socket.emit('yourCards', player.cards);
      broadcastState();
      return;
    }

    if (socket.id !== gameState.currentTurnId) return;

    player.consecutiveTimeouts = 0;

    if (data.action === 'BLIND') {
      if (!player.seen && player.coins >= gameState.blindAmount) {
        player.coins -= gameState.blindAmount;
        gameState.pot += gameState.blindAmount;
        io.emit('animateBet', { fromId: socket.id });
        nextTurn();
      }
    } else if (data.action === 'CHAAL') {
      if (player.coins >= gameState.chaalAmount) {
        player.coins -= gameState.chaalAmount;
        gameState.pot += gameState.chaalAmount;
        io.emit('animateBet', { fromId: socket.id });
        nextTurn();
      }
    } else if (data.action === 'PACK') {
      player.status = 'PACKED';
      nextTurn();
    } else if (data.action === 'SHOW') {
      const activePlayers = getActivePlayers();
      if (activePlayers.length === 2 && player.coins >= gameState.showAmount) {
        player.coins -= gameState.showAmount;
        gameState.pot += gameState.showAmount;
        io.emit('animateBet', { fromId: socket.id });
        let p1 = gameState.players[activePlayers[0]];
        let p2 = gameState.players[activePlayers[1]];
        let eval1 = evaluateHand(p1.cards);
        let eval2 = evaluateHand(p2.cards);
        let res = compareHands(eval1, eval2);
        let winnerId = res >= 0 ? p1.id : p2.id;
        declareWinner(winnerId, true);
      }
    } else if (data.action === 'SIDESHOW_REQUEST') {
      const prevTargetId = getPreviousActiveSeenPlayer(socket.id);
      if (prevTargetId && player.seen && player.coins >= gameState.chaalAmount) {
        player.coins -= gameState.chaalAmount;
        gameState.pot += gameState.chaalAmount;
        io.emit('animateBet', { fromId: socket.id });
        gameState.sideshowPending = { requesterId: socket.id, targetId: prevTargetId };
        io.to(prevTargetId).emit('sideshowIncoming', { requesterName: player.name, requesterId: socket.id });
        gameState.statusMessage = `${player.name} requested Side Show with ${gameState.players[prevTargetId].name}...`;
        broadcastState();
      }
    }
  });

  socket.on('sideshowResponse', (data) => {
    if (!gameState.sideshowPending || gameState.sideshowPending.targetId !== socket.id) return;
    
    const requester = gameState.players[gameState.sideshowPending.requesterId];
    const target = gameState.players[socket.id];

    if (data.accept && requester && target) {
      let eval1 = evaluateHand(requester.cards);
      let eval2 = evaluateHand(target.cards);
      let res = compareHands(eval1, eval2);

      let loser = (res < 0) ? requester : target;
      loser.status = 'PACKED';
      gameState.statusMessage = `Side Show: ${loser.name} lost and packed!`;
      gameState.sideshowPending = null;
      nextTurn();
    } else {
      gameState.statusMessage = `Side Show denied by ${target ? target.name : 'Player'}. Play continues.`;
      gameState.sideshowPending = null;
      broadcastState();
    }
  });

  socket.on('adminManageCoins', (data) => {
    if (socket.id !== gameState.adminId) return;
    const { targetSocketId, actionType, amount } = data;
    const player = gameState.players[targetSocketId];
    const val = parseInt(amount, 10);

    if (player && !isNaN(val)) {
      if (actionType === 'ADD') player.coins += val;
      if (actionType === 'REMOVE') player.coins = Math.max(0, player.coins - val);
      if (actionType === 'SET') player.coins = val;
      broadcastState();
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === gameState.adminId) gameState.adminId = null;

    const wasCurrentTurn = (socket.id === gameState.currentTurnId);
    delete gameState.players[socket.id];

    const activePlayers = getActivePlayers();
    if (activePlayers.length <= 1) {
      if (activePlayers.length === 1 && gameState.gameActive) {
        declareWinner(activePlayers[0]);
      } else {
        gameState.gameActive = false;
        gameState.currentTurnId = null;
        if (timerInterval) clearInterval(timerInterval);
        gameState.statusMessage = 'Waiting for at least 2 players...';
        broadcastState();
      }
    } else if (wasCurrentTurn) {
      nextTurn();
    } else {
      broadcastState();
    }
  });
});

server.listen(3000, '0.0.0.0', () => console.log('3 Patti Server running on port 3000'));
