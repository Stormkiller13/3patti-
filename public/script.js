
// --- SIDESHOW LOGIC ---
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'sideshow-btn') {
        socket.emit('playerAction', { action: 'SIDESHOW_REQUEST' });
    } else if (e.target && e.target.id === 'accept-sideshow') {
        socket.emit('sideshowResponse', { accept: true });
        document.getElementById('sideshow-modal').style.display = 'none';
    } else if (e.target && e.target.id === 'decline-sideshow') {
        socket.emit('sideshowResponse', { accept: false });
        document.getElementById('sideshow-modal').style.display = 'none';
    }
});

socket.on('sideshowIncoming', (data) => {
    const requesterElem = document.getElementById('sideshow-requester');
    const modalElem = document.getElementById('sideshow-modal');
    if (requesterElem && modalElem) {
        requesterElem.innerText = data.requesterName;
        modalElem.style.display = 'block';
    }
});

socket.on('stateUpdate', (state) => {
    const ssBtn = document.getElementById('sideshow-btn');
    if (!ssBtn || !state.players || !state.players[socket.id]) return;
    
    const myPlayer = state.players[socket.id];
    // The button will only appear if it is your turn AND you have seen your cards
    if (myPlayer.seen && state.currentTurnId === socket.id) {
        ssBtn.style.display = 'inline-block';
    } else {
        ssBtn.style.display = 'none';
    }
});

