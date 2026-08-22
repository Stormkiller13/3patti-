const socket = io();

let myPlayerId = localStorage.getItem('patti_player_id');
if (!myPlayerId) {
  myPlayerId = 'usr_' + Math.random().toString(36).substring(2, 9);
  localStorage.setItem('patti_player_id', myPlayerId);
}

let myName = localStorage.getItem('patti_player_name');
if (!myName) {
  myName = 'Player_' + Math.floor(1000 + Math.random() * 9000);
  localStorage.setItem('patti_player_name', myName);
}

const currentRoomId = 'main-room';
let myCards = [];

// Join room on connection
socket.on('connect', () => {
  socket.emit('joinRoom', {
    roomId: currentRoomId,
    playerName: myName,
    playerId: myPlayerId
  });
});

socket.on('gameState', (state) => {
  const potElement = document.querySelector('.pot, #pot, [class*="pot"]');
  if (potElement) {
    potElement.innerText = `₹${state.pot}`;
  }

  const activePlayer = state.players[state.currentTurnIndex];
  if (activePlayer && activePlayer.id === myPlayerId) {
    console.log("It's your turn!");
  }
});

socket.on('dealCards', (data) => {
  myCards = data.cards;
});

socket.on('cardsRevealed', (cards) => {
  myCards = cards;
});

socket.on('message', (msg) => alert(msg));
socket.on('errorMsg', (msg) => alert(msg));
socket.on('kicked', (msg) => {
  alert(msg);
  window.location.reload();
});

function sendAction(action) {
  socket.emit('playerMove', { action });
}

function sendSideshow() {
  socket.emit('sideshow');
}

function startGame() {
  socket.emit('startGame');
}

window.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('button, .btn, [class*="button"]');
  buttons.forEach(btn => {
    const text = btn.innerText.toLowerCase();
    if (text.includes('pack')) btn.onclick = () => sendAction('pack');
    else if (text.includes('see')) btn.onclick = () => sendAction('see');
    else if (text.includes('blind') || text.includes('chaal') || text.includes('show')) btn.onclick = () => sendAction('chaal');
    else if (text.includes('side')) btn.onclick = sendSideshow;
  });
});
