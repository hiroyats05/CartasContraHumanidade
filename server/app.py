"""Simple WebSocket server for the cardgame prototype.

Protocol (JSON messages over WebSocket):
- client -> server: {"action": "create", "room": "roomid"}
- client -> server: {"action": "join", "room": "roomid", "player_id": "p1", "name": "Alice"}
- client -> server: {"action": "start", "room": "roomid"}
- client -> server: {"action": "submit", "room": "roomid", "player_id": "p1", "card_index": 0}
- client -> server: {"action": "vote", "room": "roomid", "voter_id": "p2", "voted_player_id": "p1"}
- client -> server: {"action": "state", "room": "roomid"}

Server broadcasts JSON messages to all participants in the room when state changes.

This is intentionally minimal and in-memory only. Use `requirements.txt` to install
the `websockets` dependency.
"""

import asyncio
import json
from typing import Dict, Set

import websockets

from game.card import Card
from game.deck import Deck
from game.player import Player
from game.game_state import GameState
from game.cards_data import make_cah_like_decks


class Room:
    def __init__(self, room_id: str) -> None:
        self.room_id = room_id
        white, black = make_cah_like_decks()
        # replicate a bit for demo
        combined = Deck(list(white.cards) + list(black.cards))
        self.game = GameState([], combined, hand_size=5)
        self.conns: Set[websockets.WebSocketServerProtocol] = set()

    def snapshot(self) -> dict:
        return self.game.snapshot()


ROOMS: Dict[str, Room] = {}


async def notify_room(room: Room, message: dict) -> None:
    if not room.conns:
        return
    data = json.dumps(message)
    await asyncio.gather(*(c.send(data) for c in room.conns))


async def handle_message(ws, raw: str) -> None:
    try:
        msg = json.loads(raw)
    except Exception:
        await ws.send(json.dumps({"error": "invalid json"}))
        return

    action = msg.get("action")
    room_id = msg.get("room")
    if not room_id:
        await ws.send(json.dumps({"error": "room required"}))
        return

    room = ROOMS.get(room_id)

    if action == "create":
        if room_id in ROOMS:
            await ws.send(json.dumps({"error": "room exists", "room": room_id}))
            return
        room = Room(room_id)
        ROOMS[room_id] = room
        await ws.send(json.dumps({"status": "created", "room": room_id}))
        return

    if room is None:
        await ws.send(json.dumps({"error": "room not found", "room": room_id}))
        return

    if action == "join":
        pid = msg.get("player_id")
        name = msg.get("name", pid)
        if not pid:
            await ws.send(json.dumps({"error": "player_id required"}))
            return
        # avoid duplicates
        try:
            _ = room.game._get_player(pid)
            # player already present
        except ValueError:
            p = Player(pid, name)
            room.game.players.append(p)
            # update turn manager list
            room.game.turns.player_ids.append(pid)
        # register connection
        room.conns.add(ws)
        await notify_room(room, {"event": "player_joined", "room": room_id, "state": room.snapshot()})
        return

    if action == "start":
        try:
            room.game.start()
            await notify_room(room, {"event": "started", "room": room_id, "state": room.snapshot()})
        except Exception as e:
            await ws.send(json.dumps({"error": str(e)}))
        return

    if action == "submit":
        pid = msg.get("player_id")
        idx = msg.get("card_index", 0)
        try:
            room.game.submit_card(pid, int(idx))
            await notify_room(room, {"event": "submitted", "room": room_id, "state": room.snapshot()})
        except Exception as e:
            await ws.send(json.dumps({"error": str(e)}))
        return

    if action == "vote":
        voter = msg.get("voter_id")
        voted = msg.get("voted_player_id")
        try:
            winner = room.game.cast_vote(voter, voted)
            payload = {"event": "vote_cast", "room": room_id, "state": room.snapshot()}
            if winner:
                payload["winner"] = winner
            await notify_room(room, payload)
        except Exception as e:
            await ws.send(json.dumps({"error": str(e)}))
        return

    if action == "state":
        await ws.send(json.dumps({"state": room.snapshot()}))
        return

    await ws.send(json.dumps({"error": "unknown action"}))


async def handler(ws) -> None:
    try:
        async for message in ws:
            await handle_message(ws, message)
    finally:
        # remove from any rooms
        for room in ROOMS.values():
            if ws in room.conns:
                room.conns.remove(ws)


async def _main() -> None:
    print("Starting WebSocket server on ws://localhost:6789")
    async with websockets.serve(handler, "0.0.0.0", 6789):
        # run forever until cancelled
        await asyncio.Future()


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
