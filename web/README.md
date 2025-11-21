Phaser 3 Web Client
-------------------

Lightweight Phaser 3 UI that connects to the local WebSocket server (ws://localhost:6789).

How to run

- Serve the `web/` folder with a static file server (Phaser + WebSockets require a proper origin). Example using Python 3:

```pwsh
python -m http.server 8000 --directory web
# then open http://localhost:8000 in your browser
```

Controls
- Use the HTML inputs on the left to set `room`, `player_id`, and `player_name`.
- Click `Create Room`, `Join Room`, `Start Game` to interact with the server.
- When in-game, click cards to submit and click submission buttons to vote.

Notes
- This client expects the JSON snapshot format the Python server sends (players list with `id` and `hand_count`, `submissions`, `voting_open`).
- The client uses a very small `WSClient` wrapper in `ws_client.js` and Phaser scenes in `main.js`.
