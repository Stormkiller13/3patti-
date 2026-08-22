const socket = io();

let currentRole = 'player';

const tabPlayer = document.getElementById('tab-player');
const tabAdmin = document.getElementById('tab-admin');
const passwordInput = document.getElementById('password-input');
const usernameInput = document.getElementById('username-input');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const loginModal = document.getElementById('login-modal');
const errorMsg = document.getElementById('error-msg');

tabPlayer.addEventListener('click', () => {
  currentRole = 'player';
  tabPlayer.classList.add('active');
  tabAdmin.classList.remove('active');
  passwordInput.classList.add('hidden');
  loginSubmitBtn.textContent = 'JOIN TABLE';
  errorMsg.textContent = '';
});

tabAdmin.addEventListener('click', () => {
  currentRole = 'admin';
  tabAdmin.classList.add('active');
  tabPlayer.classList.remove('active');
  passwordInput.classList.remove('hidden');
  loginSubmitBtn.textContent = 'ADMIN LOGIN';
  errorMsg.textContent = '';
});

loginSubmitBtn.addEventListener('click', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim() || (currentRole === 'admin' ? 'Admin' : 'Player');
  const password = passwordInput.value.trim();

  socket.emit('joinGame', { name, role: currentRole, password });
});

socket.on('authError', (msg) => {
  errorMsg.textContent = msg;
});

socket.on('joinedSuccess', () => {
  loginModal.style.display = 'none';
});

socket.on('gameState', (state) => {
  const potStatus = document.getElementById('pot-status');
  const potAmount = document.getElementById('pot-amount');

  if (state.lastWinner) {
    potStatus.textContent = state.lastWinner;
    potAmount.textContent = '';
  } else if (state.gameStarted) {
    potStatus.textContent = 'POT';
    potAmount.textContent = '₹' + state.pot;
  } else {
    potStatus.textContent = 'Waiting for players...';
    potAmount.textContent = '₹' + state.pot;
  }

  const seatsContainer = document.getElementById('seats-container');
  seatsContainer.innerHTML = '';

  const totalPlayers = state.players.length;

  state.players.forEach((p, idx) => {
    const seat = document.createElement('div');
    seat.className = 'player-seat-node';

    const isMe = p.id === socket.id;
    const isCurrentTurn = state.gameStarted && state.currentTurn === idx;

    const angle = (idx / totalPlayers) * (2 * Math.PI) + (Math.PI / 2);
    const rx = 38;
    const ry = 32;
    const leftPos = 50 + rx * Math.cos(angle);
    const topPos = 50 + ry * Math.sin(angle);

    seat.style.left = leftPos + '%';
    seat.style.top = topPos + '%';

    let cardsHTML = '';
    if (p.cards && p.cards.length > 0) {
      cardsHTML = p.cards.map(c => {
        const isRed = c.suit === '♥' || c.suit === '♦';
        const canSeeThisCard = (isMe && p.seeCards) || state.showAllCards;

        if (canSeeThisCard) {
          return `<div class="card-item ${isRed ? 'red' : ''}">${c.value}${c.suit}</div>`;
        } else {
          return `<div class="card-item back">🂠</div>`;
        }
      }).join('');
    }

    seat.innerHTML = `
      <div class="seat-box ${isMe ? 'me' : ''} ${isCurrentTurn ? 'active-turn' : ''}">
        <div class="player-avatar">${p.avatar || '👤'} <span class="player-name">${p.name} ${isMe ? '(You)' : ''}</span></div>
        <div class="player-chips">₹${p.chips}</div>
        <div class="player-status">${p.status}</div>
        <div class="card-row">${cardsHTML}</div>
      </div>
    `;

    seatsContainer.appendChild(seat);
  });
});

document.querySelectorAll('.bottom-action-bar .btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.getAttribute('data-action');
    if (action) {
      socket.emit('playerAction', { action: action });
    }
  });
});
