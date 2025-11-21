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
    if (statusEl) statusEl.textContent = e.detail;
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

  // Auto-join the room when the client connects on the game page.
  // This ensures the server maps the active WebSocket connection to the player id.
  let _hasAutoJoined = false;
  client.addEventListener('status', (e) => {
    if (e.detail === 'connected') {
      try {
        const r = getRoomFromQuery();
        const pid = playerId;
        const name = playerName;
        if (!_hasAutoJoined) {
          console.debug('Auto-joining room on game page', r, pid);
          client.send({ action: 'join', room: r, player_id: pid, name });
          _hasAutoJoined = true;
        }
      } catch (err) { console.debug('Auto-join failed', err); }
    } else if (e.detail === 'closed' || e.detail === 'error') {
      // allow re-join after reconnect
      _hasAutoJoined = false;
    }
  });

  // Keep last fingerprint of our hand to avoid re-triggering deal animation
  let _prevYourHandFingerprint = null;

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
    if (roomEl) roomEl.textContent = state.room || getRoomFromQuery();
    // deck counts
    const wcountEl = document.getElementById('g_deck_white_count');
    const bcountEl = document.getElementById('g_deck_black_count');
    if (wcountEl) wcountEl.textContent = String(state.white_deck_count || 0);
    if (bcountEl) bcountEl.textContent = String(state.black_deck_count || (state.black_card_text ? 1 : 0));
    const players = state.players || [];
    if (playersEl) {
      playersEl.innerHTML = '';
      players.forEach(p => {
        const li = document.createElement('li');
        const readyList = state.ready || [];
        const isReady = readyList.includes(p.id);
        li.textContent = `${p.name || p.id} (${p.hand_count || 0})`;
        if (isReady) {
          const badge = document.createElement('span');
          badge.textContent = ' READY';
          badge.style.color = '#6ee7b7';
          badge.style.fontWeight = '700';
          badge.style.marginLeft = '8px';
          li.appendChild(badge);
        }
        playersEl.appendChild(li);
      });
    }
    if (playersCountEl) playersCountEl.textContent = players.length;

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
    const handContainer = document.createElement('div');
    handContainer.className = 'hand-cards';
    // prefer explicit card texts for this player if provided by server
    const myHandTexts = state.your_hand || [];

    // compute a fingerprint for our hand so we only animate when it changes
    const yourHand = state.your_hand || [];
    const fingerprint = yourHand.join('||') + '::' + yourHand.length;
    const shouldAnimateDeal = _prevYourHandFingerprint !== fingerprint;

    for (let i = 0; i < handCount; i++) {
      const card = document.createElement('div');
      card.className = 'card white dealt';
      const content = document.createElement('div');
      content.className = 'content';
      content.textContent = (myHandTexts[i] !== undefined) ? myHandTexts[i] : `Card ${i+1}`;
      card.appendChild(content);
      // flipping animation when submitting
      card.addEventListener('pointerup', () => {
        if (card.classList.contains('submitting')) return;
        card.classList.add('flipping');
        card.classList.add('submitting');
        setTimeout(() => {
          client.send({ action: 'submit', room: state.room, player_id: playerId, card_index: i });
          // after submit hide/mark card
          card.style.opacity = '0.5';
          card.classList.remove('flipping');
        }, 380);
      });
      if (shouldAnimateDeal) {
        // only add deal animation when the hand actually changed
        card.classList.add('dealt')
      }
      handContainer.appendChild(card);
    }
    _prevYourHandFingerprint = fingerprint;
    handEl.appendChild(handContainer);

    // canvas area: show decks and large black card
    canvasEl.innerHTML = '';
    // table surface
    const tableSurface = document.createElement('div');
    tableSurface.className = 'table-surface';
    canvasEl.appendChild(tableSurface);
    // decks container inside canvas
    const decksWrap = document.createElement('div');
    decksWrap.className = 'canvas-decks';
    const whiteDeck = document.createElement('div');
    whiteDeck.className = 'deck white-deck';
    const whiteCount = document.createElement('div');
    whiteCount.className = 'deck-count';
    whiteCount.id = 'g_deck_white_count';
    whiteCount.textContent = String(state.white_deck_count || 0);
    const whiteLabel = document.createElement('div');
    whiteLabel.className = 'deck-label';
    whiteLabel.textContent = 'White';
    whiteDeck.appendChild(whiteCount);
    whiteDeck.appendChild(whiteLabel);
    // small preview of next white cards (texts)
    if (Array.isArray(state.white_top) && state.white_top.length > 0) {
      const wp = document.createElement('div');
      wp.className = 'deck-preview white-preview';
      // show up to 3 previews
      state.white_top.slice(0, 3).forEach((txt, idx) => {
        const t = document.createElement('div');
        t.className = 'preview-line';
        t.textContent = txt;
        wp.appendChild(t);
      });
      whiteDeck.appendChild(wp);
    }

    const blackDeck = document.createElement('div');
    blackDeck.className = 'deck black-deck';
    const blackCount = document.createElement('div');
    blackCount.className = 'deck-count';
    blackCount.id = 'g_deck_black_count';
    blackCount.textContent = String(state.black_deck_count || (state.black_card_text ? 1 : 0));
    const blackLabel = document.createElement('div');
    blackLabel.className = 'deck-label';
    blackLabel.textContent = 'Black';
    blackDeck.appendChild(blackCount);
    blackDeck.appendChild(blackLabel);
    // small preview of next black card prompt
    if (state.black_top) {
      const bp = document.createElement('div');
      bp.className = 'deck-preview black-preview';
      bp.textContent = state.black_top;
      blackDeck.appendChild(bp);
    }

    decksWrap.appendChild(whiteDeck);
    decksWrap.appendChild(blackDeck);
    canvasEl.appendChild(decksWrap);

    // seats around the table (Poker-style)
    let seatsWrap = document.getElementById('table_seats');
    if (!seatsWrap) {
      seatsWrap = document.createElement('div');
      seatsWrap.id = 'table_seats';
      canvasEl.appendChild(seatsWrap);
    } else {
      seatsWrap.innerHTML = '';
    }
    // layout players evenly around a circle
    const total = players.length || 0;
    const rect = canvasEl.getBoundingClientRect();
    const cx = rect.width / 2; // center x inside canvas
    const cy = rect.height / 2; // center y
    // radius: a bit smaller than half width/height
    const radius = Math.min(rect.width, rect.height) * 0.36;
    // rotate seats so that the current player is always at the bottom
    const myIndex = players.findIndex(pp => pp.id === playerId);
    players.forEach((p, idx) => {
      const seat = document.createElement('div');
      seat.className = 'table-seat';
      if (p.id === playerId) seat.classList.add('you');
      // avatar circle with initials
      const avatar = document.createElement('div');
      avatar.className = 'seat-avatar';
      const initials = (p.name || p.id).split(' ').map(s=>s[0]).join('').toUpperCase().slice(0,2);
      avatar.textContent = initials || p.id.slice(0,2).toUpperCase();
      // name and stack
      const label = document.createElement('div');
      label.className = 'seat-label';
      const nameEl = document.createElement('div'); nameEl.className = 'seat-name'; nameEl.textContent = p.name || p.id;
      label.appendChild(nameEl);
      seat.appendChild(avatar);
      seat.appendChild(label);

      // compute position around circle; rotate so myIndex is at bottom (PI/2)
      const relIdx = (idx - (myIndex >= 0 ? myIndex : 0));
      const angle = Math.PI/2 + (total>0 ? (relIdx * (2*Math.PI/total)) : 0); // bottom anchor
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      // position seat absolutely relative to canvasEl
      seat.style.left = `${x}px`;
      seat.style.top = `${y}px`;
      seatsWrap.appendChild(seat);
    });

    // render a large black card in the canvas with centered text
    const blackCard = document.createElement('div');
    blackCard.className = 'black-card-large';
    // try to use server-provided black text if available
    const blackText = state.black_card_text || (state.voting_open ? 'Vote for the best submission' : 'Aguardando os jogadores');
    blackCard.textContent = blackText;
    canvasEl.appendChild(blackCard);

    // also show small info under canvas
    const info = document.createElement('div');
    info.style.marginTop = '12px';
    info.style.color = 'var(--muted)';
    info.textContent = `Round: ${state.current_round || 0}  Voting: ${state.voting_open ? 'yes' : 'no'}`;
    canvasEl.appendChild(info);
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

  // Request an initial state when the socket becomes connected, rather than polling.
  client.addEventListener('status', (e) => {
    try {
      if (e.detail === 'connected') {
        const r = getRoomFromQuery();
        console.debug('Requesting initial state for room', r);
        client.send({ action: 'state', room: r });
      }
    } catch (err) { console.debug('state request on connect failed', err); }
  });
});
