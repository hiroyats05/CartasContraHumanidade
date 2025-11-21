import asyncio
import json
import websockets


async def run_client():
    uri = "ws://localhost:6789"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"action": "create", "room": "room1"}))
        print("sent create")
        try:
            print(await asyncio.wait_for(ws.recv(), timeout=1.0))
        except asyncio.TimeoutError:
            pass
        await ws.send(json.dumps({"action": "join", "room": "room1", "player_id": "p1", "name": "Alice"}))
        print("sent join")
        # try to read a couple of broadcasts
        for _ in range(2):
            try:
                print(await asyncio.wait_for(ws.recv(), timeout=1.0))
            except asyncio.TimeoutError:
                break


if __name__ == "__main__":
    asyncio.run(run_client())
