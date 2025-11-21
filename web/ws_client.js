// Minimal WebSocket wrapper for the Phaser client
class WSClient extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this._queue = [];
    this._shouldReconnect = true;
    this._reconnectDelay = 1000; // ms
    this._maxReconnectDelay = 30000; // ms
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
  }

  connect() {
    // if already connected/connecting, ignore
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.ws) this.ws.close();
    console.debug('WSClient: connecting to', this.url);
    this.dispatchEvent(new CustomEvent('status', { detail: 'connecting' }));
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener('open', () => {
      console.debug('WSClient: connected to', this.url);
      this._reconnectAttempts = 0;
      this._reconnectDelay = 1000;
      if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
      this.dispatchEvent(new CustomEvent('status', { detail: 'connected' }));
      // flush queued messages
      while (this._queue.length > 0) {
        const m = this._queue.shift();
        try { this.ws.send(JSON.stringify(m)); console.debug('WSClient: flushed queued message', m); } catch (e) { console.error('Failed to send queued message', e); }
      }
    });

    this.ws.addEventListener('close', (ev) => {
      console.debug('WSClient: closed', ev);
      this.dispatchEvent(new CustomEvent('status', { detail: 'closed' }));
      if (this._shouldReconnect) this._scheduleReconnect();
    });

    this.ws.addEventListener('error', (ev) => {
      console.debug('WSClient: error', ev);
      this.dispatchEvent(new CustomEvent('status', { detail: 'error' }));
      // close will trigger reconnect
    });

    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        console.debug('WSClient: received', msg);
        this.dispatchEvent(new CustomEvent('message', { detail: msg }));
      } catch (e) {
        console.error('Invalid JSON from server', e);
      }
    });
  }

  _scheduleReconnect() {
    if (!this._shouldReconnect) return;
    this._reconnectAttempts += 1;
    const delay = Math.min(this._reconnectDelay * this._reconnectAttempts, this._maxReconnectDelay);
    console.debug('WSClient: scheduling reconnect in', delay, 'ms');
    this._reconnectTimer = setTimeout(() => {
      console.debug('WSClient: reconnect attempt', this._reconnectAttempts);
      this.connect();
    }, delay);
  }

  close() {
    this._shouldReconnect = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) this.ws.close();
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // queue until the socket opens
      console.debug('WSClient: queuing message (socket not open)', obj);
      this._queue.push(obj);
      return;
    }
    console.debug('WSClient: sending', obj);
    this.ws.send(JSON.stringify(obj));
  }
}

// Export for use in browser global
window.WSClient = WSClient;
