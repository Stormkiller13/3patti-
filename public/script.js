const socket = io();

let currentRole = 'player';

// Handle Role Switching Tabs
document.querySelectorAll('.tab, [class*="tab"]').forEach(tab => {
  tab.addEventListener('click', (e) => {
    const text = e.target.textContent.toLowerCase();
    if (text.includes('admin')) {
      currentRole = 'admin';
    } else {
      currentRole = 'player';
    }
  });
});

// Join / Admin Login Handler
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON' && (e.target.textContent.includes('LOGIN') || e.target.textContent.includes('JOIN'))) {
    e.preventDefault();
    const inputs = document.querySelectorAll('input');
    const name = inputs[0] ? inputs[0].value : 'Player';
    
    socket.emit('joinGame', { name: name || 'User', role: currentRole });

    // Hide Modal Overlay
    const modal = e.target.closest('div[class*="modal"]') || e.target.parentElement;
    if (modal) modal.style.display = 'none';
  }
});

// Sync State & Render Players
socket.on('gameState', (state) => {
  // Update Pot
  const potText = Array.from(document.querySelectorAll('*')).find(el => el.textContent.includes('₹') || el.textContent.includes('Waiting'));
  if (potText) {
    potText.innerHTML = state.gameStarted ? `POT<br>₹${state.pot}` : `Waiting...<br>₹${state.pot}`;
  }

  // Render Seats around Table
  let seatsContainer = document.getElementById('seats-container');
  if (!seatsContainer) {
    seatsContainer = document.createElement('div');
    seatsContainer.id = 'seats-container';
    document.body.appendChild(seatsContainer);
  }
  seatsContainer.innerHTML = '';

  state.players.forEach((p, index) => {
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    seat.style.position = 'absolute';
    
    // Position seats around table
    if (index === 0) { seat.style.bottom = '20%'; seat.style.left = '40%'; }
    else if (index === 1) { seat.style.left = '10%'; seat.style.top = '40%'; }
    else if (index === 2) { seat.style.top = '15%'; seat.style.left = '40%'; }
    else { seat.style.right = '10%'; seat.style.top = '40%'; }

    const isMe = p.id === socket.id;
    const cardsHTML = p.cards.length > 0 ? p.cards.map(c => 
      `<span style="background:#fff; color:${(c.suit==='♥'||c.suit==='♦')?'red':'black'}; padding:2px 4px; border-radius:3px; margin:1px; font-weight:bold;">
        ${p.seeCards || isMe ? c.value + c.suit : '🂠'}
      </span>`
    ).join('') : '';

    seat.innerHTML = `
      <div style="background:rgba(15,23,42,0.9); border:2px solid ${isMe?'#22c55e':'#3b82f6'}; padding:8px; border-radius:8px; color:white; text-align:center; min-width:90px;">
        <div style="font-weight:bold;">${p.name} ${isMe ? '(You)' : ''}</div>
        <div style="color:#eab308; font-size:12px;">₹${p.chips}</div>
        <div style="color:#22c55e; font-size:10px; margin-top:2px;">${p.status}</div>
        <div style="margin-top:4px;">${cardsHTML}</div>
      </div>
    `;
    seatsContainer.appendChild(seat);
  });
});

// Action Buttons
document.addEventListener('click', (e) => {
  const txt = e.target.textContent.toUpperCase();
  if (txt.includes('PACK')) socket.emit('playerAction', { action: 'pack' });
  if (txt.includes('SEE')) socket.emit('playerAction', { action: 'see' });
  if (txt.includes('BLIND')) socket.emit('playerAction', { action: 'blind' });
  if (txt.includes('CHAAL')) socket.emit('playerAction', { action: 'chaal' });
});
