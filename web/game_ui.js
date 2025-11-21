// Minimal game UI that connects to the WebSocket server and renders state
// Build SERVER_URL dynamically so remote players can connect using the server IP.
function _getServerHostFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    const srv = params.get('server') || params.get('host') || params.get('ws');
    if (srv) return srv;
  } catch (e) {}
  if (window.location && window.location.host) return window.location.host;
  return 'localhost';
}
const SERVER_URL = (() => {
  const host = _getServerHostFromQuery();
  const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
  return `${proto}://${host}/ws`;
})();

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('g_status');
  const roomEl = document.getElementById('g_room');
  // Players sidebar removed; we still read players from state for seats/logic
  const playersEl = null;
  const playersCountEl = null;
  // `g_submissions` panel removed from DOM; submissions are rendered on the table
  const submissionsEl = null;
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
  // guarda localmente em qual submissão eu votei (player id da submissão)
  let myVotedFor = null;
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
    // when a vote is cast, ensure we refresh state (some servers may omit full state)
    if (msg.event === 'vote_cast') {
      if (msg.state) renderState(msg.state);
      else try { client.send({ action: 'state', room: msg.room }); } catch (e) { console.debug('state request failed', e); }
    }
    // if the server reports a winner, explicitly request state to ensure UI updates
    if (msg.winner) {
      console.debug('vote winner reported', msg.winner);
      try { client.send({ action: 'state', room: msg.room }); } catch (e) { console.debug('state request failed', e); }
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

    // submissions list in sidebar removed — voting is handled by clicking table cards

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
    // decks container inside canvas (show only counts; previews/labels are hidden by CSS)
    const decksWrap = document.createElement('div');
    decksWrap.className = 'canvas-decks';
    const whiteDeck = document.createElement('div');
    whiteDeck.className = 'deck white-deck';
    const whiteCount = document.createElement('div');
    whiteCount.className = 'deck-count';
    whiteCount.id = 'g_deck_white_count';
    whiteCount.textContent = String(state.white_deck_count || 0);
    whiteDeck.appendChild(whiteCount);

    const blackDeck = document.createElement('div');
    blackDeck.className = 'deck black-deck';
    const blackCount = document.createElement('div');
    blackCount.className = 'deck-count';
    blackCount.id = 'g_deck_black_count';
    blackCount.textContent = String(state.black_deck_count || (state.black_card_text ? 1 : 0));
    blackDeck.appendChild(blackCount);

    decksWrap.appendChild(whiteDeck);
    decksWrap.appendChild(blackDeck);
    canvasEl.appendChild(decksWrap);

    // render table cards (played submissions) with visible text and clickable to vote
    const tableCardsWrap = document.createElement('div');
    tableCardsWrap.className = 'table-cards';
    const submissionTexts = state.submission_texts || {};
    const submissions = state.submissions || [];
    // if there are no submissions (round finished), clear local voted mark
    if (!submissions || submissions.length === 0) {
      myVotedFor = null;
    }
    // separate current player's submission from others so we can position it near the table
    let mySubmission = null;
    submissions.forEach((sid, idx) => {
      if (sid === playerId) {
        mySubmission = { sid, idx };
        return;
      }
      const tcard = document.createElement('div');
      tcard.className = 'card table-card white';
      tcard.dataset.sid = sid;
      const content = document.createElement('div');
      content.className = 'content';
      content.textContent = submissionTexts[sid] || `Submission ${idx+1}`;
      tcard.appendChild(content);

      if (state.voting_open) {
        tcard.style.pointerEvents = 'auto';
        tcard.style.cursor = 'pointer';
        tcard.addEventListener('click', () => {
          try {
            client.send({ action: 'vote', room: state.room, voter_id: playerId, voted_player_id: sid });
            // destacar localmente a carta votada e evitar múltiplos cliques
            myVotedFor = sid;
            // desabilita cliques nas cartas da mesa até a atualização do estado
            const all = tableCardsWrap.querySelectorAll('.card.table-card');
            all.forEach(a=>{ a.style.pointerEvents = 'none'; });
            // aplica destaque (escurecer)
            applyVoteHighlight();
          } catch (e) { console.debug('vote send failed', e); }
        });
      } else {
        tcard.style.pointerEvents = 'none';
      }

      tableCardsWrap.appendChild(tcard);
    });

    // função que aplica o destaque de voto localmente
    function applyVoteHighlight() {
      const all = tableCardsWrap.querySelectorAll('.card.table-card');
      all.forEach(el => {
        if (myVotedFor && el.dataset && el.dataset.sid === myVotedFor) {
          el.classList.add('voted');
          el.style.pointerEvents = 'none';
        } else {
          el.classList.remove('voted');
          // restaurar pointer-events dependendo de voting_open
          if (state.voting_open) {
            el.style.pointerEvents = 'auto';
          } else {
            el.style.pointerEvents = 'none';
          }
        }
      });
    }

    // aplicar destaque a cada render
    applyVoteHighlight();

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
    // increase radius so seats sit further out and avoid overlapping the central black card
    const radius = Math.min(rect.width, rect.height) * 0.46;
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
      // allow the current player's seat to be slightly closer to the table
      let seatRadius = radius;
      if (p.id === playerId) {
        seatRadius = radius * 0.78; // pull the 'you' seat inward (~22%)
      }
      const x = cx + Math.cos(angle) * seatRadius;
      const y = cy + Math.sin(angle) * seatRadius;
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

    // append table cards after the black card so they appear above it
    canvasEl.appendChild(tableCardsWrap);

    // if the current player submitted, render their submitted card near the table
    if (mySubmission) {
      const sid = mySubmission.sid;
      const yourWrap = document.createElement('div');
      yourWrap.className = 'your-submission';
      const ycard = document.createElement('div');
      ycard.className = 'card white';
      const ycontent = document.createElement('div');
      ycontent.className = 'content';
      ycontent.textContent = submissionTexts[sid] || 'Your submission';
      ycard.appendChild(ycontent);
      // do not make it clickable for voting by default (voting handled via table cards)
      ycard.style.pointerEvents = 'none';
      yourWrap.appendChild(ycard);
      canvasEl.appendChild(yourWrap);
    }

    // small info removed from layout (handled by higher-level UI or server logs)
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

  // debug helper removed

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
