// Phaser 3 minimal client to interact with the cardgame websocket server
// Build SERVER_URL dynamically so remote players can connect using the server IP.
function _getServerHostFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    const srv = params.get('server') || params.get('host') || params.get('ws');
    if (srv) return srv;
  } catch (e) {}
  try {
    // In Electron the page is often loaded via file:// so location.host is empty.
    // Default to localhost:8000 when running from file protocol so WS client connects
    // to the bundled Python server started by Electron.
    if (window.location && window.location.protocol === 'file:') return 'localhost:8000';
    if (window.location && window.location.host) return window.location.host;
  } catch (e) {}
  return 'localhost';
}
const SERVER_URL = (() => {
  const host = _getServerHostFromQuery();
  const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
  // connect to websocket endpoint at /ws on the chosen host
  return `${proto}://${host}/ws`;
})();

window.addEventListener('load', () => {
  const nameInput = document.getElementById('player_name');
  // legacy server input may not exist on the updated UI; prefer join modal fields
  const serverInput = document.getElementById('server_addr');
  const joinServerIpInput = document.getElementById('join_server_ip');
  const joinServerPortInput = document.getElementById('join_server_port');

  // generate a short random player id (hidden from UI) used automatically
  function generatePlayerId() {
    return 'p' + Math.random().toString(36).substring(2, 8);
  }
  if (!window.playerId) window.playerId = generatePlayerId();
  // try to prefill player name from localStorage
  try {
    const saved = localStorage.getItem('playerName');
    if (saved && nameInput) nameInput.value = saved;
    const savedServer = localStorage.getItem('serverAddr');
    if (savedServer && serverInput) serverInput.value = savedServer;
  } catch (e) {}
  const status = document.getElementById('status');
  const btnCreateEl = document.getElementById('btnCreate');
  const btnJoinEl = document.getElementById('btnJoin');
  const btnStartEl = document.getElementById('btnStart');

  const client = new WSClient(SERVER_URL);
  // disable UI until connected
  function setUIEnabled(enabled) {
    if (btnCreateEl) btnCreateEl.disabled = !enabled;
    if (btnJoinEl) btnJoinEl.disabled = !enabled;
    if (btnStartEl) btnStartEl.disabled = !enabled;
  }
  setUIEnabled(false);

  client.addEventListener('status', (e) => {
    const s = e.detail;
    status.textContent = 'Status: ' + s;
    if (s === 'connected') setUIEnabled(true);
    else setUIEnabled(false);
  });
  // start the connection (reconnect logic is internal)
  client.connect();
  
  // Global message logger to help debugging
  client.addEventListener('message', (e) => {
    console.debug('GLOBAL WS MESSAGE:', e.detail);
  });
  client.addEventListener('message', (e) => { window.gameScene && window.gameScene.onServerMessage(e.detail); });

  // helper to wait for a server message that satisfies a predicate
  function waitForServerMessage(predicate, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const onMsg = (ev) => {
        try {
          const msg = ev.detail;
          if (predicate(msg)) {
            console.debug('waitForServerMessage: predicate matched', msg);
            client.removeEventListener('message', onMsg);
            clearTimeout(timer);
            resolve(msg);
          }
        } catch (err) {
          // ignore
        }
      };
      client.addEventListener('message', onMsg);
      const timer = setTimeout(() => {
        client.removeEventListener('message', onMsg);
        console.debug('waitForServerMessage: timeout');
        reject(new Error('timeout waiting for server message'));
      }, timeout);
    });
  }

  // Open create-room modal instead of creating immediately
  const modal = document.getElementById('createModal');
  const modalRoomInput = document.getElementById('modal_room');
  const modalCreateBtn = document.getElementById('modal_create_btn');
  const modalCancelBtn = document.getElementById('modal_cancel_btn');
  const modalBackdrop = document.getElementById('modalBackdrop');

  if (btnCreateEl) btnCreateEl.addEventListener('click', () => {
    modal.classList.remove('hidden');
    modalRoomInput.focus();
  });

  // enhance UX: pressing Enter in the name or room input triggers Join
  function tryTriggerJoinOnEnter(e) {
    if (e.key === 'Enter') {
      const roomVal = (document.getElementById('modal_room') && document.getElementById('modal_room').value) ? document.getElementById('modal_room').value : document.getElementById('modal_room').value;
      // simulate click on Join button
      if (btnJoinEl) btnJoinEl.click();
    }
  }
  if (nameInput) nameInput.addEventListener('keydown', tryTriggerJoinOnEnter);
  const roomInputInline = document.getElementById('modal_room');
  if (roomInputInline) roomInputInline.addEventListener('keydown', tryTriggerJoinOnEnter);

  // helper to normalize user input into a websocket URL
  function toWsUrl(raw) {
    if (!raw) return null;
    raw = raw.trim();
    if (!raw) return null;
    if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
    if (raw.startsWith('http://')) return raw.replace(/^http:/, 'ws:') + '/ws';
    if (raw.startsWith('https://')) return raw.replace(/^https:/, 'wss:') + '/ws';
    const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
    return `${proto}://${raw.replace(/\/$/, '')}/ws`;
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  modalCancelBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', closeModal);
  const modalCloseCreate = document.getElementById('modal_close_create');
  if (modalCloseCreate) modalCloseCreate.addEventListener('click', closeModal);
  modalRoomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') modalCreateBtn.click(); });

  modalCreateBtn.addEventListener('click', async () => {
    const r = modalRoomInput.value || 'room1';
    // create then auto-join using generated playerId
    const pid = window.playerId;
    const name = nameInput.value || pid;
    try {
      // If an explicit server was entered (join modal IP/port), use it for the create request.
      function getJoinExplicitServer() {
        try {
          const ip = joinServerIpInput && joinServerIpInput.value && joinServerIpInput.value.trim();
          const port = joinServerPortInput && joinServerPortInput.value && joinServerPortInput.value.trim();
          if (!ip) return null;
          // include port if provided, otherwise default to 8000
          return port ? `${ip.replace(/:\d+$/, '')}:${port}` : `${ip}:8000`;
        } catch (e) { return null; }
      }
      const explicit = getJoinExplicitServer() || (serverInput && serverInput.value && serverInput.value.trim());
      if (explicit) {
        const wsUrl = toWsUrl(explicit);
        try { localStorage.setItem('serverAddr', explicit); } catch (e) {}
        console.debug('Requesting create room via explicit server', wsUrl, r);
        const temp = new WSClient(wsUrl);
        temp.connect();
        await new Promise((resolve, reject) => {
          const to = setTimeout(() => { try { temp.close(); } catch(e){}; reject(new Error('timeout')); }, 5000);
          temp.addEventListener('status', (ev) => { if (ev.detail === 'connected') temp.send({ action: 'create', room: r }); });
          const onMsg = (ev) => { const m = ev.detail; if (m && m.status === 'created' && m.room === r) { clearTimeout(to); temp.removeEventListener('message', onMsg); try { temp.close(); } catch(e){}; resolve(true); } };
          temp.addEventListener('message', onMsg);
        });
      } else {
        console.debug('Requesting create room', r);
        client.send({ action: 'create', room: r });
        await waitForServerMessage(msg => msg.status === 'created' && msg.room === r, 5000);
      }

      // We created the room; save player info and navigate to game page.
      status.textContent = 'Created ' + r;
      closeModal();
      try { localStorage.setItem('playerId', pid); localStorage.setItem('playerName', name); } catch (e) {}
      const navServer = explicit ? encodeURIComponent(explicit) : null;
      window.location.href = `game.html?room=${encodeURIComponent(r)}` + (navServer ? `&server=${navServer}` : '');
    } catch (err) {
      console.error('Failed to create/join room:', err);
      status.textContent = 'Create failed: ' + (err.message || err);
    }
  });
  // Join modal: show active rooms fetched from server
  const joinModal = document.getElementById('joinModal');
  const joinList = document.getElementById('join_list');
  const joinCancelBtn = document.getElementById('join_cancel_btn');
  const joinBackdrop = document.getElementById('joinBackdrop');

  function getJoinExplicitServerForRequest() {
    try {
      const ip = joinServerIpInput && joinServerIpInput.value && joinServerIpInput.value.trim();
      const port = joinServerPortInput && joinServerPortInput.value && joinServerPortInput.value.trim();
      if (!ip) return null;
      return port ? `${ip.replace(/:\d+$/, '')}:${port}` : `${ip}:8000`;
    } catch (e) { return null; }
  }

  function openJoinModal() {
    joinModal.classList.remove('hidden');
    // focus IP input for convenience
    if (joinServerIpInput) joinServerIpInput.focus();
    joinList.innerHTML = '<div style="color:var(--muted)">Loading rooms&hellip;</div>';
    requestRoomList();
  }

  if (btnJoinEl) btnJoinEl.addEventListener('click', () => openJoinModal());
  if (joinCancelBtn) joinCancelBtn.addEventListener('click', () => joinModal.classList.add('hidden'));
  joinBackdrop.addEventListener('click', () => joinModal.classList.add('hidden'));
  const modalCloseJoin = document.getElementById('modal_close_join');
  if (modalCloseJoin) modalCloseJoin.addEventListener('click', () => joinModal.classList.add('hidden'));

  // request room list helper (used on open and refresh)
  function requestRoomList() {
    joinList.innerHTML = '<div style="color:var(--muted)">Loading rooms&hellip;</div>';
    const explicit = getJoinExplicitServerForRequest() || (serverInput && serverInput.value && serverInput.value.trim());
    if (explicit) {
      const wsUrl = toWsUrl(explicit);
      try { localStorage.setItem('serverAddr', explicit); } catch (e) {}
      console.debug('requestRoomList via explicit', wsUrl);
      const temp = new WSClient(wsUrl);
      temp.connect();
      new Promise((resolve, reject) => {
        const to = setTimeout(() => { try { temp.close(); } catch(e){}; reject(new Error('timeout')); }, 4000);
        temp.addEventListener('status', (ev) => { if (ev.detail === 'connected') temp.send({ action: 'list' }); });
        temp.addEventListener('message', (ev) => { const msg = ev.detail; if (msg && Array.isArray(msg.rooms)) { clearTimeout(to); try { temp.close(); } catch(e){}; resolve(msg); } });
      }).then(msg => {
        console.debug('Received rooms list', msg.rooms);
        const raw = msg.rooms || [];
        const rooms = raw.map(r => { if (typeof r === 'string') return { room: r, players: 0 }; return { room: r.room, players: r.players || 0 }; });
        if (rooms.length === 0) { joinList.innerHTML = '<div style="color:var(--muted)">No active rooms</div>'; return; }
        joinList.innerHTML = '';
        rooms.forEach(r => {
          const row = document.createElement('div');
          row.className = 'join-row';
          const name = document.createElement('div'); name.className = 'name'; name.textContent = `${r.room} (${r.players})`;
          const btn = document.createElement('button'); btn.textContent = 'Join';
          btn.addEventListener('click', async () => {
            const pid = window.playerId;
            const nameVal = nameInput.value || pid;
            try {
              try { localStorage.setItem('playerId', pid); localStorage.setItem('playerName', nameVal); } catch(e){}
              const navServer = encodeURIComponent(explicit);
              window.location.href = `game.html?room=${encodeURIComponent(r.room)}&server=${navServer}`;
            } catch (err) { console.error('Join clicked error', err); status.textContent = 'Join failed'; }
          });
          row.appendChild(name); row.appendChild(btn); joinList.appendChild(row);
        });
      }).catch(() => { joinList.innerHTML = '<div style="color:var(--muted)">Failed to fetch rooms</div>'; console.debug('requestRoomList: failed to receive rooms (timeout or error)'); });
      return;
    }
    try {
      console.debug('requestRoomList: ws readyState=', client.ws && client.ws.readyState, 'queueLen=', client._queue && client._queue.length);
    } catch (e) {}
    console.debug('requestRoomList: sending list request');
    client.send({ action: 'list' });
    waitForServerMessage(msg => Array.isArray(msg.rooms), 3000).then(msg => {
      console.debug('Received rooms list', msg.rooms);
      const raw = msg.rooms || [];
      const rooms = raw.map(r => { if (typeof r === 'string') return { room: r, players: 0 }; return { room: r.room, players: r.players || 0 }; });
      if (rooms.length === 0) { joinList.innerHTML = '<div style="color:var(--muted)">No active rooms</div>'; return; }
      joinList.innerHTML = '';
      rooms.forEach(r => {
        const row = document.createElement('div'); row.style.display = 'flex'; row.style.gap = '8px'; row.style.margin = '6px 0';
        const name = document.createElement('div'); name.style.flex = '1'; name.textContent = `${r.room} (${r.players})`;
        const btn = document.createElement('button'); btn.textContent = 'Join';
        btn.addEventListener('click', async () => {
          const pid = window.playerId; const nameVal = nameInput.value || pid;
          try { try { localStorage.setItem('playerId', pid); localStorage.setItem('playerName', nameVal); } catch(e){}
            window.location.href = `game.html?room=${encodeURIComponent(r.room)}`;
          } catch (err) { console.error('Join clicked error', err); status.textContent = 'Join failed'; }
        });
        row.appendChild(name); row.appendChild(btn); joinList.appendChild(row);
      });
    }).catch(() => { joinList.innerHTML = '<div style="color:var(--muted)">Failed to fetch rooms</div>'; console.debug('requestRoomList: failed to receive rooms (timeout or error)'); });
  }

  // wire refresh button
  const joinRefreshBtn = document.getElementById('join_refresh_btn');
  if (joinRefreshBtn) joinRefreshBtn.addEventListener('click', requestRoomList);
  // wire direct-enter button (connect by IP:port)
  const joinEnterBtn = document.getElementById('join_enter_btn');
  if (joinEnterBtn) joinEnterBtn.addEventListener('click', async () => {
    const ip = joinServerIpInput && joinServerIpInput.value && joinServerIpInput.value.trim();
    const port = joinServerPortInput && joinServerPortInput.value && joinServerPortInput.value.trim();
    if (!ip) { status.textContent = 'Informe o IP do servidor.'; return; }
    const explicit = port ? `${ip.replace(/:\d+$/, '')}:${port}` : `${ip}:8000`;
    const wsUrl = toWsUrl(explicit);
    status.textContent = `Conectando a ${explicit}...`;
    const temp = new WSClient(wsUrl);
    try {
      temp.connect();
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => { try { temp.close(); } catch(e){}; reject(new Error('timeout')); }, 5000);
        temp.addEventListener('status', (ev) => { if (ev.detail === 'connected') { clearTimeout(to); resolve(true); } });
      });
      // success: save name/id and navigate
      try { localStorage.setItem('playerId', window.playerId); localStorage.setItem('playerName', nameInput.value || window.playerId); } catch (e) {}
      const navServer = encodeURIComponent(explicit);
      window.location.href = `game.html?server=${navServer}`;
    } catch (err) {
      console.error('Failed to connect to server', err);
      status.textContent = 'Falha ao conectar: ' + (err.message || err);
    } finally {
      try { temp.close(); } catch (e) {}
    }
  });
  if (btnStartEl) btnStartEl.addEventListener('click', () => {
    const modalRoom = document.getElementById('modal_room');
    const r = (modalRoom && modalRoom.value) ? modalRoom.value : 'room1';
    client.send({ action: 'start', room: r });
  });

  // Only initialize Phaser when on the game HTML page. This avoids rendering
  // a full-screen canvas (and its background) on the index/landing page which
  // was producing an undesirable centered band behind the hero card.
  const isGamePage = window.location.pathname && window.location.pathname.indexOf('game.html') !== -1;
  if (isGamePage) {
    // Phaser config
    const config = {
      type: Phaser.AUTO,
      parent: 'canvas-container',
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#222244',
      scene: [LobbyScene, GameScene]
    };

    const game = new Phaser.Game(config);
  } else {
    // If not on the game page, hide the canvas container to avoid layout artifacts
    const cc = document.getElementById('canvas-container');
    if (cc) cc.style.display = 'none';
  }

  // Expose a small API so main.js can call into game scenes
  window.phaserClient = { client };
});

class LobbyScene extends Phaser.Scene {
  constructor() { super({ key: 'LobbyScene' }); }
  create() {
    // Lobby UI is provided by the HTML overlay; keep the Phaser lobby scene empty
    // to avoid duplicate text rendered inside the canvas.
    window.gameScene = this;
  }
  onServerMessage(msg) {
    if (msg.event === 'game_started' || (msg.state && msg.state.voting_open !== undefined)) {
      this.scene.start('GameScene');
    }
  }
}

class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }
  create() {
    this.title = this.add.text(20, 20, 'Game', { font: '24px Arial', fill: '#fff' });
    this.handGroup = this.add.group();
    this.submissionsGroup = this.add.group();
    window.gameScene = this;
    const modalRoomEl = document.getElementById('modal_room');
    this.room = (modalRoomEl && modalRoomEl.value) ? modalRoomEl.value : 'room1';
    this.player_id = window.playerId || 'p1';
  }
  clearGroup(group) {
    group.getChildren().forEach(c => c.destroy());
  }
  renderHand(count) {
    this.clearGroup(this.handGroup);
    for (let i = 0; i < count; i++) {
      const x = 100 + i * 140;
      const y = 120;
      const rect = this.add.rectangle(x, y, 120, 60, 0xffffff).setStrokeStyle(2, 0x333333);
      const txt = this.add.text(x - 50, y - 10, 'Card ' + i, { color: '#000' });
      rect.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        window.phaserClient.client.send({ action: 'submit', room: this.room, player_id: this.player_id, card_index: i });
      });
      this.handGroup.addMultiple([rect, txt]);
    }
  }
  renderSubmissions(subs, voting_open) {
    this.clearGroup(this.submissionsGroup);
    if (!voting_open) return;
    subs.forEach((s, idx) => {
      const x = 100;
      const y = 240 + idx * 48;
      const btn = this.add.rectangle(x + 60, y, 260, 36, 0xffcc88).setInteractive({ useHandCursor: true });
      const txt = this.add.text(x - 80, y - 8, `Vote: ${s}`, { color: '#000' });
      btn.on('pointerup', () => {
        window.phaserClient.client.send({ action: 'vote', room: this.room, voter_id: this.player_id, voted_player_id: s });
      });
      this.submissionsGroup.addMultiple([btn, txt]);
    });
  }
  onServerMessage(msg) {
    if (msg.state) {
      const st = msg.state;
      const me = (st.players || []).find(p => p.id === this.player_id) || null;
      const hand_count = me ? me.hand_count : 0;
      this.renderHand(hand_count);
      this.renderSubmissions(st.submissions || [], !!st.voting_open);
    }
  }
}
