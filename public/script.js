const socket = io();

let selectedRole = 'player';

// Track Admin / Player tab clicks
document.addEventListener('click', (e) => {
  const target = e.target;
  const txt = (target.textContent || '').trim().toLowerCase();

  if (txt === 'admin') {
    selectedRole = 'admin';
    document.querySelectorAll('.tab, [class*="tab"]').forEach(t => t.classList.remove('active'));
    target.classList.add('active');
  } else if (txt === 'player') {
    selectedRole = 'player';
    document.querySelectorAll('.tab, [class*="tab"]').forEach(t => t.classList.remove('active'));
    target.classList.add('active');
  }
});

// Handle Login / Join Click
document.addEventListener('click', (e) => {
  const target = e.target;
  const txt = (target.textContent || '').trim().toUpperCase();

  if (txt.includes('LOGIN') || txt.includes('JOIN')) {
    e.preventDefault();
    
    // Find name input
    const inputs = document.querySelectorAll('input');
    let nameVal = '';
    inputs.forEach(inp => {
      if (inp.type !== 'password' && inp.value && !nameVal) {
        nameVal = inp.value.trim();
      }
    });

    socket.emit('joinGame', {
      name: nameVal || (selectedRole === 'admin' ? 'Admin' : 'Player'),
      role: selectedRole
    });

    // Hide all modal overlays completely
    const overlays = document.querySelectorAll('[class*="modal"], [id*="modal"], [class*="overlay"], [id*="overlay"], .login-box, .modal');
    overlays.forEach(el => {
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.style.zIndex = '-1';
    });
  }
});

// Render state and players on table
socket.on('gameState', (state) => {
  // Update Pot Center Display
  const potBadge = document.querySelector('[class*="pot"]') || Array.from(document.querySelectorAll('div, span, p')).find(el => el.textContent.includes('Waiting') || el.textContent.includes('POT') || el.textContent.includes('₹'));
  if (potBadge) {
    potBadge.innerHTML = state.gameStarted ? `POT<br>₹${state.pot}` : `Waiting...<br>₹${state.pot}`;
  }

  // Render Seats Container over the felt
  let seatsArea = document.getElementById('table-seats-layer');
  if (!seatsArea) {
    seatsArea = document.createElement('div');
    seatsArea.id = 'table-seats-layer';
    seatsArea.style.position = 'fixed';
    seatsArea.style.top = '0';
    seatsArea.style.left = '0';
    seatsArea.style.width = '100vw';
    seatsArea.style.height = '100vh';
    seatsArea.style.pointerEvents = 'none';
    seatsArea.style.zIndex = '50';
    document.body.appendChild(seatsArea);
  }
  seatsArea.innerHTML = '';

  state.players.forEach((p, idx) => {
    const seat = document.createElement('div');
    seat.className = 'player-card-seat';
    seat.style.position = 'absolute';
    seat.style.pointerEvents = 'auto';
    seat.style.transform = 'translate(-50%, -50%)';

    const isMe = p.id === socket.id;

    // Position seats around table
    if (isMe) {
      seat.style.bottom = '12%';
      seat.style.left = '50%';
    } else if (idx === 0) {
      seat.style.top = '25%';
      seat.style.left = '50%';
    } else if (idx === 1) {
      seat.style.top = '50%';
      seat.style.left = '20%';
    } else {
      seat.style.top = '50%';
      seat.style.left = '80%';
    }

    // Build Cards
    let cardsHTML = '';
    if (p.cards && p.cards.length > 0) {
      cardsHTML = p.cards.map(c => {
        const isRed = c.suit === '♥' || c.suit === '♦';
        const showCard = p.seeCards || isMe;
        return `<div style="display:inline-block; width:28px; height:38px; background:${showCard?'#ffffff':'#1e40af'}; color:${isRed?'#dc2626':'#000'}; border:1px solid #93c5fd; border-radius:4px; margin:2px; line-height:38px; text-align:center; font-weight:bold; font-size:12px; box-shadow:0 2px 4px rgba(0,0,0,0.4);">
          ${showCard ? c.value + c.suit : '🂠'}
        </div>`;
      }).join('');
    }

    seat.innerHTML = `
      <div style="background:rgba(15,23,42,0.92); border:2px solid ${isMe?'#22c55e':'#3b82f6'}; border-radius:12px; padding:8px 12px; color:#fff; text-align:center; min-width:110px; box-shadow:0 4px 15px rgba(0,0,0,0.5);">
        <div style="font-size:18px; margin-bottom:2px;">${p.avatar || '👤'} <span style="font-size:13px; font-weight:bold; color:#f8fafc;">${p.name} ${isMe ? '(You)' : ''}</span></div>
        <div style="color:#facc15; font-size:12px; font-weight:bold;">₹${p.chips}</div>
        <div style="color:#4ade80; font-size:10px; font-weight:bold; text-transform:uppercase; margin:2px 0;">${p.status}</div>
        <div style="display:flex; justify-content:center; align-items:center; margin-top:4px;">${cardsHTML}</div>
      </div>
    `;

    seatsArea.appendChild(seat);
  });
});

// Action Buttons Event
document.addEventListener('click', (e) => {
  const txt = (e.target.textContent || '').toUpperCase();
  if (txt.includes('PACK')) socket.emit('playerAction', { action: 'pack' });
  if (txt.includes('SEE')) socket.emit('playerAction', { action: 'see' });
  if (txt.includes('BLIND')) socket.emit('playerAction', { action: 'blind' });
  if (txt.includes('CHAAL')) socket.emit('playerAction', { action: 'chaal' });
});
