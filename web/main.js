// Phaser 3 minimal client to interact with the cardgame websocket server
const SERVER_URL = 'ws://localhost:6789';

window.addEventListener('load', () => {
  const nameInput = document.getElementById('player_name');

  // generate a short random player id (hidden from UI) used automatically
  function generatePlayerId() {
    return 'p' + Math.random().toString(36).substring(2, 8);
  }
  if (!window.playerId) window.playerId = generatePlayerId();
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

  function closeModal() {
    modal.classList.add('hidden');
  }

  modalCancelBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', closeModal);
  modalRoomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') modalCreateBtn.click(); });

  modalCreateBtn.addEventListener('click', async () => {
    const r = modalRoomInput.value || 'room1';
    // create then auto-join using generated playerId
    const pid = window.playerId;
    const name = nameInput.value || pid;
    try {
      // send create and wait confirmation
      console.debug('Requesting create room', r);
      client.send({ action: 'create', room: r });
      await waitForServerMessage(msg => msg.status === 'created' && msg.room === r, 5000);

      // now join and wait for server broadcast that includes our player
      client.send({ action: 'join', room: r, player_id: pid, name });
      await waitForServerMessage(msg => msg.event === 'player_joined' && msg.room === r && msg.state && (msg.state.players || []).some(p => p.id === pid), 5000).catch(() => {
        console.debug('Join confirmation wait timed out (create flow)');
      });

      status.textContent = 'Created and joined ' + r;
      closeModal();
      try { localStorage.setItem('playerId', pid); localStorage.setItem('playerName', name); } catch (e) {}
      window.location.href = `game.html?room=${encodeURIComponent(r)}`;
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

  function openJoinModal() {
    joinModal.classList.remove('hidden');
    joinList.innerHTML = '<div style="color:var(--muted)">Loading rooms&hellip;</div>';
    requestRoomList();
  }

  if (btnJoinEl) btnJoinEl.addEventListener('click', () => openJoinModal());
  joinCancelBtn.addEventListener('click', () => joinModal.classList.add('hidden'));
  joinBackdrop.addEventListener('click', () => joinModal.classList.add('hidden'));

  // request room list helper (used on open and refresh)
  function requestRoomList() {
    joinList.innerHTML = '<div style="color:var(--muted)">Loading rooms&hellip;</div>';
      try {
        console.debug('requestRoomList: ws readyState=', client.ws && client.ws.readyState, 'queueLen=', client._queue && client._queue.length);
      } catch (e) { /* ignore if internals not present */ }
      console.debug('requestRoomList: sending list request');
      client.send({ action: 'list' });
    waitForServerMessage(msg => Array.isArray(msg.rooms), 3000).then(msg => {
      console.debug('Received rooms list', msg.rooms);
      const raw = msg.rooms || [];
      const rooms = raw.map(r => {
        if (typeof r === 'string') return { room: r, players: 0 };
        return { room: r.room, players: r.players || 0 };
      });
      if (rooms.length === 0) {
        joinList.innerHTML = '<div style="color:var(--muted)">No active rooms</div>';
        return;
      }
      joinList.innerHTML = '';
      rooms.forEach(r => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.margin = '6px 0';
        const name = document.createElement('div');
        name.style.flex = '1';
        name.textContent = `${r.room} (${r.players})`;
        const btn = document.createElement('button');
        btn.textContent = 'Join';
        btn.addEventListener('click', async () => {
          const pid = window.playerId;
          const nameVal = nameInput.value || pid;
          try {
            console.debug('Requesting join', r.room, pid);
            client.send({ action: 'join', room: r.room, player_id: pid, name: nameVal });
            await waitForServerMessage(m => m.event === 'player_joined' && m.room === r.room && (m.state && (m.state.players || []).some(p => p.id === pid)), 5000).catch(() => { console.debug('Join confirmation wait timed out (join flow)'); });
            try { localStorage.setItem('playerId', pid); localStorage.setItem('playerName', nameVal); } catch(e){}
            window.location.href = `game.html?room=${encodeURIComponent(r.room)}`;
          } catch (err) {
            console.error('Join clicked error', err);
            status.textContent = 'Join failed';
          }
        });
        row.appendChild(name);
        row.appendChild(btn);
        joinList.appendChild(row);
      });
    }).catch(() => {
      joinList.innerHTML = '<div style="color:var(--muted)">Failed to fetch rooms</div>';
        console.debug('requestRoomList: failed to receive rooms (timeout or error)');
    });
  }

  // wire refresh button
  const joinRefreshBtn = document.getElementById('join_refresh_btn');
  if (joinRefreshBtn) joinRefreshBtn.addEventListener('click', requestRoomList);
  if (btnStartEl) btnStartEl.addEventListener('click', () => {
    const modalRoom = document.getElementById('modal_room');
    const r = (modalRoom && modalRoom.value) ? modalRoom.value : 'room1';
    client.send({ action: 'start', room: r });
  });

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

  // Expose a small API so main.js can call into game scenes
  window.phaserClient = { client };
});

class LobbyScene extends Phaser.Scene {
  constructor() { super({ key: 'LobbyScene' }); }
  create() {
    this.add.text(20, 20, 'Lobby (use the HTML controls)', { font: '20px Arial', fill: '#fff' });
    this.add.text(20, 48, 'When the game starts, it will switch to the Game view.', { font: '14px Arial', fill: '#ddd' });
    // listen for state messages to auto-transition
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
