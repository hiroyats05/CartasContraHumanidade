"""aiohttp-based server that serves static files and a WebSocket endpoint.

This lets clients load the static `web/` assets from the same origin and
connect to the WebSocket at `/ws` without needing a `?server=` workaround.
"""

import asyncio
import json
import logging
import os
from typing import Dict, Set

from aiohttp import web

# basic logging for debugging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s %(levelname)s %(message)s')

from game.card import Card
from game.deck import Deck
from game.player import Player
from game.game_state import GameState
from game.cards_data import make_cah_like_decks


BASE_DIR = os.path.dirname(os.path.dirname(__file__))
STATIC_DIR = os.path.normpath(os.path.join(BASE_DIR, 'web'))


class Room:
    def __init__(self, room_id: str) -> None:
        self.room_id = room_id
        white, black = make_cah_like_decks()
        # keep white and black decks separate
        self.white_deck = Deck(list(white.cards))
        self.black_deck = Deck(list(black.cards))
        self.game = GameState([], self.white_deck, self.black_deck, hand_size=3)
        # conns are aiohttp.web.WebSocketResponse objects
        self.conns: Set[web.WebSocketResponse] = set()
        # players that signalled ready for the next game
        self.ready: Set[str] = set()
        # map websocket connection -> player_id (set during join)
        self.conn_player: Dict[web.WebSocketResponse, str] = {}

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
    base_state = None
    if 'state' in message and isinstance(message['state'], dict):
        base_state = message['state']
    coros = []
    # prepare per-connection payloads
    for c in list(room.conns):
        try:
            msg = dict(message)
            if base_state is not None:
                st = dict(base_state)
                st.update(room.game.snapshot())
                st['ready'] = list(room.ready)
                st['room'] = room.room_id
                st['black_deck_count'] = len(room.black_deck) if room.black_deck is not None else 0
                pid = room.conn_player.get(c)
                if pid:
                    try:
                        pl = next(p for p in room.game.players if p.id == pid)
                        st['your_hand'] = [getattr(card, 'text', str(card)) for card in pl.hand]
                    except StopIteration:
                        st['your_hand'] = []
                # white_top preview
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
                msg['state'] = st
            data = json.dumps(msg)
            coros.append(_send_safe(c, data))
        except Exception as e:
            logging.exception('notify_room: prepare/send failed for conn %s: %s', getattr(c, 'transport', None), e)
    results = await asyncio.gather(*coros, return_exceptions=True)
    for conn, res in zip(list(room.conns), results):
        if isinstance(res, Exception):
            logging.exception('notify_room: sending to %s failed: %s', getattr(conn, 'transport', None), res)


async def _send_safe(ws: web.WebSocketResponse, data: str):
    try:
        await ws.send_str(data)
    except Exception:
        logging.exception('Failed to send data to ws %s', getattr(ws, 'transport', None))


async def handle_message(ws: web.WebSocketResponse, raw: str) -> None:
    try:
        msg = json.loads(raw)
    except Exception:
        await ws.send_str(json.dumps({"error": "invalid json"}))
        return

    logging.debug('handle_message: from=%s msg=%s', getattr(ws, 'transport', None), msg)

    action = msg.get("action")
    room_id = msg.get("room")
    if action == "list":
        summaries = []
        for rid, r in ROOMS.items():
            try:
                cnt = len(r.game.players)
            except Exception:
                cnt = 0
            summaries.append({"room": rid, "players": cnt})
        payload = {"rooms": summaries}
        try:
            await ws.send_str(json.dumps(payload))
        except Exception:
            logging.exception('Failed to send list response')
        return

    if not room_id:
        await ws.send_str(json.dumps({"error": "room required"}))
        return

    room = ROOMS.get(room_id)

    if action == "create":
        if room_id in ROOMS:
            await ws.send_str(json.dumps({"error": "room exists", "room": room_id}))
            return
        room = Room(room_id)
        ROOMS[room_id] = room
        logging.info('Room created: %s', room_id)
        await ws.send_str(json.dumps({"status": "created", "room": room_id, "state": room.snapshot()}))
        return

    if room is None:
        await ws.send_str(json.dumps({"error": "room not found", "room": room_id}))
        return

    if action == "join":
        pid = msg.get("player_id")
        name = msg.get("name", pid)
        if not pid:
            await ws.send_str(json.dumps({"error": "player_id required"}))
            return
        try:
            _ = room.game._get_player(pid)
        except ValueError:
            p = Player(pid, name)
            room.game.players.append(p)
            room.game.turns.player_ids.append(pid)
        room.conns.add(ws)
        room.conn_player[ws] = pid
        logging.info('Player %s joining room %s (connections=%d)', pid, room_id, len(room.conns))
        await notify_room(room, {"event": "player_joined", "room": room_id, "state": room.snapshot()})
        return

    if action == "ready":
        pid = msg.get("player_id")
        rd = msg.get("ready", True)
        if not pid:
            await ws.send_str(json.dumps({"error": "player_id required"}))
            return
        if rd:
            room.ready.add(pid)
            logging.info('Player %s marked READY in room %s', pid, room_id)
        else:
            if pid in room.ready:
                room.ready.remove(pid)
            logging.info('Player %s unmarked READY in room %s', pid, room_id)
        await notify_room(room, {"event": "player_ready", "room": room_id, "player": pid, "ready": bool(rd), "state": room.snapshot()})

        try:
            player_ids = [p.id for p in room.game.players]
            if player_ids:
                missing = [x for x in player_ids if x not in room.ready]
                if not missing:
                    if not room.conns:
                        logging.debug('Auto-start skipped: no active connections in room %s', room_id)
                    else:
                        connected_pids = set(room.conn_player.get(c) for c in room.conns if room.conn_player.get(c))
                        player_ids_set = set(player_ids)
                        if connected_pids != player_ids_set:
                            logging.debug('Auto-start skipped: not all players are connected for room %s (connected=%s players=%s)', room_id, connected_pids, player_ids_set)
                        else:
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
            player_ids = [p.id for p in room.game.players]
            missing = [pid for pid in player_ids if pid not in room.ready]
            if player_ids and missing:
                await ws.send_str(json.dumps({"error": "not_all_ready", "missing": missing}))
                return
            room.game.start()
            room.ready.clear()
            await notify_room(room, {"event": "started", "room": room_id, "state": room.snapshot()})
        except Exception as e:
            await ws.send_str(json.dumps({"error": str(e)}))
        return

    if action == "submit":
        pid = msg.get("player_id")
        idx = msg.get("card_index", 0)
        try:
            room.game.submit_card(pid, int(idx))
            await notify_room(room, {"event": "submitted", "room": room_id, "state": room.snapshot()})
        except Exception as e:
            await ws.send_str(json.dumps({"error": str(e)}))
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
            await ws.send_str(json.dumps({"error": str(e)}))
        return

    if action == "state":
        try:
            st = room.snapshot()
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
            pid = room.conn_player.get(ws)
            if pid:
                try:
                    pl = next(p for p in room.game.players if p.id == pid)
                    st['your_hand'] = [getattr(card, 'text', str(card)) for card in pl.hand]
                except Exception:
                    st['your_hand'] = []
            await ws.send_str(json.dumps({"state": st}))
        except Exception:
            await ws.send_str(json.dumps({"error": "failed to build state"}))
        return

    await ws.send_str(json.dumps({"error": "unknown action"}))


async def websocket_handler(request: web.Request) -> web.StreamResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    logging.info('New WS connection: %s', request.remote)
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                await handle_message(ws, msg.data)
            elif msg.type == web.WSMsgType.ERROR:
                logging.error('ws connection closed with exception %s', ws.exception())
                break
    except Exception:
        logging.exception('Connection handler error for %s', request.remote)
    finally:
        # cleanup connection from any rooms
        for room in ROOMS.values():
            if ws in room.conns:
                room.conns.remove(ws)
                if ws in room.conn_player:
                    try:
                        del room.conn_player[ws]
                    except Exception:
                        pass
                logging.info('Connection %s removed from room %s', request.remote, room.room_id)
    return ws


def create_app() -> web.Application:
    app = web.Application()
    # serve static files from the repo's `web/` directory
    if os.path.isdir(STATIC_DIR):
        app.router.add_static('/', STATIC_DIR, show_index=True)
    else:
        logging.warning('Static dir not found: %s', STATIC_DIR)
    # ws endpoint
    app.router.add_get('/ws', websocket_handler)
    return app


def main() -> None:
    import os
    app = create_app()
    host = '0.0.0.0'
    # Use PORT from environment (Render provides $PORT). Fallback to 6789 for local dev.
    port = int(os.environ.get('PORT', '8000'))
    print(f"Starting server on http://{host}:{port} (WS at /ws)")
    web.run_app(app, host=host, port=port)


if __name__ == '__main__':
    main()
