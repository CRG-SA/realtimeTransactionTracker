#!/usr/bin/env python3
import asyncio
import json
import time
from typing import Dict, Set

# Debian/Ubuntu 10.4-compatible imports
from websockets.legacy.server import serve, WebSocketServerProtocol
from websockets.exceptions import ConnectionClosed

UDP_PORT = 20000
WS_PORT = 8765

# Track clients and their outbound queues
connected_clients: Set[WebSocketServerProtocol] = set()
out_queues: Dict[WebSocketServerProtocol, asyncio.Queue] = {}

# -------------------------------
# UDP Listener -> enqueue to all
# -------------------------------
class UDPServer(asyncio.DatagramProtocol):
    """Receives UDP JSON packets and enqueues them for all WS clients."""

    def datagram_received(self, data, addr):
        msg = data.decode("utf-8", errors="ignore").strip()
        try:
            obj = json.loads(msg)
        except json.JSONDecodeError:
            print(f"⚠️  Invalid JSON from {addr}: {msg[:120]!r}")
            return

        obj["_src_ip"] = addr[0] 
        obj["_recv_ts_ms"] = int(time.time() * 1000)
        payload = json.dumps(obj, separators=(",", ":"))

        # Enqueue to all connected clients
        for ws in list(connected_clients):
            q = out_queues.get(ws)
            if q is None:
                continue
            # Don't block UDP handler; drop if queue is full
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # Optional: log or drop silently
                pass

# -------------------------------
# Per-client writer
# -------------------------------
async def writer_task(ws: WebSocketServerProtocol, q: asyncio.Queue):
    """
    Block until there is data for this client. Sends only when we have data.
    This produces ZERO traffic while idle.
    """
    try:
        while True:
            payload = await q.get()          # <-- blocks here until data
            await ws.send(payload)           # send when we have it
            q.task_done()
    except ConnectionClosed:
        pass
    except Exception as e:
        print(f"⚠️  writer error: {e!r}")

# -------------------------------
# WebSocket handler
# -------------------------------
async def ws_handler(ws: WebSocketServerProtocol, path: str):
    # Register client and queue
    q = asyncio.Queue(maxsize=1000)  # backpressure per client
    connected_clients.add(ws)
    out_queues[ws] = q
    print(f"🔌 WS connected ({len(connected_clients)})")

    # Start writer that blocks until there is work
    writer = asyncio.create_task(writer_task(ws, q))

    try:
        # We ignore inbound messages; just keep connection open.
        await ws.wait_closed()
    finally:
        # Cleanup
        writer.cancel()
        try:
            await writer
        except Exception:
            pass
        connected_clients.discard(ws)
        out_queues.pop(ws, None)
        print(f"❌ WS disconnected ({len(connected_clients)})")

# -------------------------------
# Main
# -------------------------------
async def main():
    print(f"📡 UDP listener on 0.0.0.0:{UDP_PORT}")
    print(f"🌐 WebSocket on ws://0.0.0.0:{WS_PORT} (idle-silent)")

    loop = asyncio.get_running_loop()
    await loop.create_datagram_endpoint(
        lambda: UDPServer(),
        local_addr=("0.0.0.0", UDP_PORT),
    )

    # ping_interval=None => no automatic pings; socket stays silent when idle
    async with serve(
        ws_handler,
        host="0.0.0.0",
        port=WS_PORT,
        ping_interval=None,
        ping_timeout=20,
        max_size=1 << 20,
        max_queue=1000,
        compression=None,
    ):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Server stopped.")
