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
import logging
from typing import Dict, Set

import websockets

# basic logging for debugging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s %(levelname)s %(message)s')

from game.card import Card
from game.deck import Deck
from game.player import Player
from game.game_state import GameState
from game.cards_data import make_cah_like_decks


class Room:
    def __init__(self, room_id: str) -> None:
        self.room_id = room_id
        white, black = make_cah_like_decks()
        # keep white and black decks separate
        self.white_deck = Deck(list(white.cards))
        self.black_deck = Deck(list(black.cards))
        self.game = GameState([], self.white_deck, self.black_deck, hand_size=5)
        self.conns: Set[websockets.WebSocketServerProtocol] = set()
        # players that signalled ready for the next game
        self.ready: Set[str] = set()
        # map websocket connection -> player_id (set during join)
        self.conn_player: Dict[websockets.WebSocketServerProtocol, str] = {}

    def snapshot(self) -> dict:
        s = self.game.snapshot()
        s.update({"room": self.room_id, "ready": list(self.ready)})
        return s


ROOMS: Dict[str, Room] = {}


async def notify_room(room: Room, message: dict) -> None:
    if not room.conns:
        logging.debug('notify_room: no connections in room %s', room.room_id)
        return
    logging.debug('notify_room: broadcasting to room %s -> %s (conns=%d)', room.room_id, message, len(room.conns))
    # If message contains a 'state' dict, we will personalize it per-connection
    base_state = None
    if 'state' in message and isinstance(message['state'], dict):
        base_state = message['state']
    coros = []
    for c in list(room.conns):
        try:
            msg = dict(message)
            if base_state is not None:
                # deep-ish copy of state for personalization
                st = dict(base_state)
                # always include room-level snapshot data fresh
                st.update(room.game.snapshot())
                # expose which players are ready
                st['ready'] = list(room.ready)
                st['room'] = room.room_id
                # include black deck count from room
                st['black_deck_count'] = len(room.black_deck) if room.black_deck is not None else 0
                # if this connection is associated with a player, include their hand texts as 'your_hand'
                pid = room.conn_player.get(c)
                if pid:
                    try:
                        pl = next(p for p in room.game.players if p.id == pid)
                        st['your_hand'] = [getattr(card, 'text', str(card)) for card in pl.hand]
                    except StopIteration:
                        st['your_hand'] = []
                # also include a small preview of the top cards in the decks for UI
                try:
                    # white_top: up to 3 next white card texts (do not modify deck)
                    white_preview = []
                    for card in room.white_deck.cards:
                        if getattr(card, 'type', None) and getattr(card.type, 'value', None) == 'white':
                            white_preview.append(getattr(card, 'text', str(card)))
                            if len(white_preview) >= 3:
                                break
                    st['white_top'] = white_preview
                except Exception:
                    st['white_top'] = []
                try:
                    # black_top: next black card text if any
                    black_preview = None
                    for card in room.black_deck.cards:
                        if getattr(card, 'type', None) and getattr(card.type, 'value', None) == 'black':
                            black_preview = getattr(card, 'text', str(card))
                            break
                    st['black_top'] = black_preview
                except Exception:
                    st['black_top'] = None
                msg['state'] = st
            data = json.dumps(msg)
            coros.append(c.send(data))
        except Exception as e:
            logging.exception('notify_room: prepare/send failed for conn %s: %s', getattr(c, 'remote_address', None), e)
    results = await asyncio.gather(*coros, return_exceptions=True)
    for conn, res in zip(list(room.conns), results):
        if isinstance(res, Exception):
            logging.exception('notify_room: sending to %s failed: %s', getattr(conn, 'remote_address', None), res)


async def handle_message(ws, raw: str) -> None:
    try:
        msg = json.loads(raw)
    except Exception:
        await ws.send(json.dumps({"error": "invalid json"}))
        return

    logging.debug('handle_message: from=%s msg=%s', getattr(ws, 'remote_address', None), msg)

    action = msg.get("action")
    room_id = msg.get("room")
    # allow some actions without a `room` field
    if action == "list":
        # return list of active room summaries (room id + player count)
        summaries = []
        for rid, r in ROOMS.items():
            try:
                cnt = len(r.game.players)
            except Exception:
                cnt = 0
            summaries.append({"room": rid, "players": cnt})
        logging.debug('List requested from %s, returning %d rooms: %s', getattr(ws, 'remote_address', None), len(summaries), summaries)
        payload = {"rooms": summaries}
        # attempt to send and log errors
        try:
            await ws.send(json.dumps(payload))
            logging.debug('List response sent to %s', getattr(ws, 'remote_address', None))
        except Exception:
            logging.exception('Failed to send list response to %s', getattr(ws, 'remote_address', None))
        return

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
        logging.info('Room created: %s', room_id)
        # include initial snapshot with deck counts
        await ws.send(json.dumps({"status": "created", "room": room_id, "state": room.snapshot()}))
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
        room.conn_player[ws] = pid
        logging.info('Player %s joining room %s (connections=%d)', pid, room_id, len(room.conns))
        await notify_room(room, {"event": "player_joined", "room": room_id, "state": room.snapshot()})
        return

    if action == "ready":
        # mark or unmark a player as ready
        pid = msg.get("player_id")
        rd = msg.get("ready", True)
        if not pid:
            await ws.send(json.dumps({"error": "player_id required"}))
            return
        if rd:
            room.ready.add(pid)
            logging.info('Player %s marked READY in room %s', pid, room_id)
        else:
            if pid in room.ready:
                room.ready.remove(pid)
            logging.info('Player %s unmarked READY in room %s', pid, room_id)
        # broadcast update about ready state
        await notify_room(room, {"event": "player_ready", "room": room_id, "player": pid, "ready": bool(rd), "state": room.snapshot()})

        # if all players are present and all have marked ready, auto-start
        try:
            player_ids = [p.id for p in room.game.players]
            if player_ids:
                missing = [x for x in player_ids if x not in room.ready]
                if not missing:
                    # do not auto-start if there are no active connections (guard noisy ready signals)
                    if not room.conns:
                        logging.debug('Auto-start skipped: no active connections in room %s', room_id)
                    else:
                        # require that all known players are currently connected to avoid starting on stale/partial state
                        connected_pids = set(room.conn_player.get(c) for c in room.conns if room.conn_player.get(c))
                        player_ids_set = set(player_ids)
                        if connected_pids != player_ids_set:
                            logging.debug('Auto-start skipped: not all players are connected for room %s (connected=%s players=%s)', room_id, connected_pids, player_ids_set)
                        else:
                            # only auto-start if the game isn't already started
                            if getattr(room.game, 'started', False):
                                logging.debug('Auto-start skipped: game already started for room %s', room_id)
                            else:
                                logging.info('All players ready in room %s, auto-starting', room_id)
                                try:
                                    room.game.start()
                                    room.ready.clear()
                                    await notify_room(room, {"event": "started", "room": room_id, "state": room.snapshot()})
                                except Exception as e:
                                    logging.exception('Failed to auto-start room %s: %s', room_id, e)
        except Exception:
            logging.exception('Error while checking auto-start condition for room %s', room_id)
        return

    if action == "start":
        try:
            # require all players to be ready before starting
            player_ids = [p.id for p in room.game.players]
            missing = [pid for pid in player_ids if pid not in room.ready]
            if player_ids and missing:
                await ws.send(json.dumps({"error": "not_all_ready", "missing": missing}))
                return
            room.game.start()
            # clear ready set after starting
            room.ready.clear()
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
        try:
            st = room.snapshot()
            # add deck previews for direct state request
            try:
                white_preview = []
                for card in room.white_deck.cards:
                    if getattr(card, 'type', None) and getattr(card.type, 'value', None) == 'white':
                        white_preview.append(getattr(card, 'text', str(card)))
                        if len(white_preview) >= 3:
                            break
                st['white_top'] = white_preview
            except Exception:
                st['white_top'] = []
            try:
                black_preview = None
                for card in room.black_deck.cards:
                    if getattr(card, 'type', None) and getattr(card.type, 'value', None) == 'black':
                        black_preview = getattr(card, 'text', str(card))
                        break
                st['black_top'] = black_preview
            except Exception:
                st['black_top'] = None
            # include your_hand for this connection when known
            pid = room.conn_player.get(ws)
            if pid:
                try:
                    pl = next(p for p in room.game.players if p.id == pid)
                    st['your_hand'] = [getattr(card, 'text', str(card)) for card in pl.hand]
                except Exception:
                    st['your_hand'] = []
            await ws.send(json.dumps({"state": st}))
        except Exception:
            await ws.send(json.dumps({"error": "failed to build state"}))
        return

    await ws.send(json.dumps({"error": "unknown action"}))


async def handler(ws) -> None:
    logging.info('New connection: %s', getattr(ws, 'remote_address', None))
    try:
        async for message in ws:
            await handle_message(ws, message)
    except Exception:
        logging.exception('Connection handler error for %s', getattr(ws, 'remote_address', None))
    finally:
        # remove from any rooms
        for room in ROOMS.values():
            if ws in room.conns:
                room.conns.remove(ws)
                # also remove mapping if present
                if ws in room.conn_player:
                    try:
                        del room.conn_player[ws]
                    except Exception:
                        pass
                logging.info('Connection %s removed from room %s', getattr(ws, 'remote_address', None), room.room_id)


async def _main() -> None:
    print("Starting WebSocket server on ws://localhost:6789")
    async with websockets.serve(handler, "0.0.0.0", 6789):
        # run forever until cancelled
        await asyncio.Future()


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
