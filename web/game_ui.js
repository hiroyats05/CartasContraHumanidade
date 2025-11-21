// Minimal game UI that connects to ws://localhost:6789 and renders state
const SERVER_URL = 'ws://localhost:6789';

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('g_status');
  const roomEl = document.getElementById('g_room');
  const playersEl = document.getElementById('g_players');
  const playersCountEl = document.getElementById('g_players_count');
  const submissionsEl = document.getElementById('g_submissions');
  const handEl = document.getElementById('g_hand');
  const canvasEl = document.getElementById('g_canvas');
  const readyBtn = document.getElementById('g_btn_ready');

  // generate or reuse a short player id
  if (!localStorage.getItem('playerId')) {
    localStorage.setItem('playerId', 'p' + Math.random().toString(36).substring(2,8));
  }
  const playerId = localStorage.getItem('playerId');
  const playerName = localStorage.getItem('playerName') || 'Player';

  // create client and connect
  const client = new WSClient(SERVER_URL);
  client.addEventListener('status', (e) => {
    statusEl.textContent = e.detail;
  });
  client.addEventListener('message', (ev) => {
    const msg = ev.detail;
    if (msg.state) renderState(msg.state);
    // handle ready notifications
    if (msg.event === 'player_ready') {
      // we already update via state, but could flash a message
      console.debug('player_ready event', msg.player, msg.ready);
    }
  });
  client.connect();

  // prefer room from query string, fallback to state.room or modal input
  function getRoomFromQuery() {
    try {
      const params = new URLSearchParams(window.location.search);
      const r = params.get('room');
      if (r) return r;
    } catch (e) {}
    const modalRoomEl = document.getElementById('modal_room');
    if (modalRoomEl && modalRoomEl.value) return modalRoomEl.value;
    return 'room1';
  }

  function renderState(state) {
    roomEl.textContent = state.room || getRoomFromQuery();
    const players = state.players || [];
    playersEl.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      const readyList = state.ready || [];
      const isReady = readyList.includes(p.id);
      li.textContent = `${p.name || p.id} (${p.hand_count || 0}) ${isReady ? '[READY]' : ''}`;
      playersEl.appendChild(li);
    });
    playersCountEl.textContent = players.length;

    // submissions
    submissionsEl.innerHTML = '';
    (state.submissions || []).forEach(sid => {
      const btn = document.createElement('button');
      btn.textContent = `Vote ${sid}`;
      btn.addEventListener('click', () => {
        client.send({ action: 'vote', room: state.room, voter_id: playerId, voted_player_id: sid });
      });
      submissionsEl.appendChild(btn);
    });

    // hand (count only) - render index buttons
    handEl.innerHTML = '';
    const me = players.find(p => p.id === playerId) || null;
    const handCount = me ? me.hand_count || 0 : 0;
    for (let i = 0; i < handCount; i++) {
      const c = document.createElement('button');
      c.textContent = `Card ${i}`;
      c.addEventListener('click', () => {
        client.send({ action: 'submit', room: state.room, player_id: playerId, card_index: i });
      });
      handEl.appendChild(c);
    }

    // canvas info
    canvasEl.textContent = `Round: ${state.current_round || 0}  Voting: ${state.voting_open ? 'yes' : 'no'}`;
  }

  // UI buttons
  const joinBtn = document.getElementById('g_btn_join');
  if (joinBtn) {
    joinBtn.addEventListener('click', () => {
      const r = getRoomFromQuery();
      client.send({ action: 'join', room: r, player_id: playerId, name: playerName });
    });
  }

  // ready button toggles ready state (only if present)
  if (readyBtn) {
    let amReady = false;
    readyBtn.addEventListener('click', () => {
      const r = getRoomFromQuery();
      amReady = !amReady;
      client.send({ action: 'ready', room: r, player_id: playerId, ready: amReady });
      readyBtn.textContent = amReady ? 'Unready' : 'Ready';
    });
  }

  const startBtn = document.getElementById('g_btn_start');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      const r = getRoomFromQuery();
      client.send({ action: 'start', room: r });
    });
  }

  // simple heartbeat: request state every 2s using the room from query or modal
  setInterval(() => {
    const r = getRoomFromQuery();
    client.send({ action: 'state', room: r });
  }, 2000);
});
