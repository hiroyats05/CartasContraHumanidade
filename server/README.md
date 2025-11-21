# Server (WebSocket) for Card Game Prototype

This folder contains a minimal WebSocket server that exposes the prototype
game logic (`GameState`) over JSON messages.

Quick start

1. Create a virtualenv and install requirements:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Run the server:

```powershell
python -m server.app
```

Protocol (JSON) — examples

- Create room:
  `{"action":"create","room":"room1"}`
- Join room:
  `{"action":"join","room":"room1","player_id":"p1","name":"Alice"}`
- Start game:
  `{"action":"start","room":"room1"}`
- Submit card:
  `{"action":"submit","room":"room1","player_id":"p1","card_index":0}`
- Vote:
  `{"action":"vote","room":"room1","voter_id":"p2","voted_player_id":"p1"}`

The server broadcasts `state` updates to all connected WebSocket clients in the room.

Notes

- This is an in-memory prototype: no persistence, no authentication. It's intended
  for local testing and iterative development.
