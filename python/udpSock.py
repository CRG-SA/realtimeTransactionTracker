#!/usr/bin/env python3

# python3 -m venv venv && ./venv/bin/pip install uvloop orjson websockets
# UDP_PORT=20005 WS_PORT=9000 ./venv/bin/python udpSock.py

# pkts/s: Average UDP packets received per second over the last 5 seconds.
# RX: Total cumulative UDP packets received since the server started.
# UDPdrop:
# Format: [Drops in last 5s] / [Total drops since start]
# Meaning: Packets dropped by the OS kernel because the receive buffer (4MB) was full. This should stay 0/0.
# WSdrop:
# Format: [Drops in last 5s] / [Total drops since start]
# Meaning: Packets dropped by the Python application because a client's WebSocket queue (4000 messages) was full.
# Clients: The number of unique active WebSocket connections (limited to one per IP).
# QMax: The highest queue level reached by any client in the last interval. If this approaches 4000, WSdrop will begin.

import asyncio
import time
import socket
import os
from typing import Dict, Set

# High-performance imports
import uvloop
import orjson

# Debian/Ubuntu 10.4-compatible imports
from websockets.legacy.server import serve, WebSocketServerProtocol
from websockets.exceptions import ConnectionClosed

# Configuration
UDP_PORT = int(os.environ.get("UDP_PORT", 20000))
WS_PORT = int(os.environ.get("WS_PORT", 8765))

# Stats
class ServerStats:
    def __init__(self):
        self.rx_total = 0
        self.ws_drop_total = 0  # WebSocket queue drops
        self.start_time = time.time()
        self.last_report_time = time.time()
        self.rx_last_report = 0
        self.ws_drop_last_report = 0

server_stats = ServerStats()

# Track clients and their outbound queues
connected_clients: Set[WebSocketServerProtocol] = set()
out_queues: Dict[WebSocketServerProtocol, asyncio.Queue] = {}
client_by_ip: Dict[str, WebSocketServerProtocol] = {}  # Track one connection per IP

# Lock for atomic connection registration/replacement
registration_lock = asyncio.Lock()

# UDP socket reference for stats
udp_socket = None

# -------------------------------
# UDP Listener -> enqueue to all
# -------------------------------
class UDPServer(asyncio.DatagramProtocol):
    """Receives UDP JSON packets and enqueues them for all WS clients."""
    
    def connection_made(self, transport):
        global udp_socket
        self.transport = transport
        sock = transport.get_extra_info('socket')
        if sock:
            # Increase receive buffer to 4MB to handle bursts
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
            udp_socket = sock

    def datagram_received(self, data, addr):
        server_stats.rx_total += 1
        
        # optimization: orjson can load bytes directly, skipping decode()
        try:
            obj = orjson.loads(data)
        except orjson.JSONDecodeError:
            return

        obj["_src_ip"] = addr[0] 
        obj["_recv_ts_ms"] = int(time.time() * 1000)
        
        # orjson.dumps returns bytes; decode to string for WebSocket text messages
        payload = orjson.dumps(obj).decode('utf-8')

        # Enqueue to all connected clients
        # Use local variable access for speed
        clients = connected_clients
        queues = out_queues
        
        if not clients:
            return

        for ws in list(clients):
            q = queues.get(ws)
            if q is None:
                continue
            # Don't block UDP handler; drop if queue is full
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                server_stats.ws_drop_total += 1
                pass

# -------------------------------
# Per-client writer
# -------------------------------
async def writer_task(ws: WebSocketServerProtocol, q: asyncio.Queue, lock: asyncio.Lock):
    """
    Block until there is data for this client. Sends only when we have data.
    This produces ZERO traffic while idle.
    """
    try:
        while True:
            payload = await q.get()          
            async with lock:
                await ws.send(payload)           
            q.task_done()
    except ConnectionClosed:
        pass
    except BaseException as e:
        if not isinstance(e, asyncio.CancelledError):
            print(f"⚠️  writer error: {e!r}")

async def heartbeat_task(ws: WebSocketServerProtocol, lock: asyncio.Lock):
    """Manual ping/pong to prevent AssertionError under high load."""
    try:
        while True:
            await asyncio.sleep(20)
            async with lock:
                # Use a small timeout for the ping frame itself
                pong_waiter = await ws.ping()
                await asyncio.wait_for(pong_waiter, timeout=10)
    except (ConnectionClosed, asyncio.TimeoutError, asyncio.CancelledError):
        pass
    except Exception:
        pass

# -------------------------------
# WebSocket handler
# -------------------------------
async def ws_handler(ws: WebSocketServerProtocol, path: str):
    # Get client IP
    client_ip = ws.remote_address[0] if ws.remote_address else "unknown"
    
    async with registration_lock:
        # Close existing connection from same IP and clean it up immediately
        if client_ip in client_by_ip:
            old_ws = client_by_ip[client_ip]
            if old_ws in connected_clients:
                print(f"🔄 Replacing existing connection from {client_ip}")
                # Clean up old connection immediately
                connected_clients.discard(old_ws)
                out_queues.pop(old_ws, None)
                client_by_ip.pop(client_ip, None)
                # Then close it (this will trigger its finally block, but cleanup already done)
                await old_ws.close(1000, "Replaced by new connection")
        
        # Register client and queue
        q = asyncio.Queue(maxsize=4000)  
        lock = asyncio.Lock()
        connected_clients.add(ws)
        out_queues[ws] = q
        client_by_ip[client_ip] = ws
        print(f"🔌 WS connected from {client_ip} ({len(connected_clients)} total)")

    # Start writer and heartbeat tasks
    writer = asyncio.create_task(writer_task(ws, q, lock))
    heartbeat = asyncio.create_task(heartbeat_task(ws, lock))

    try:
        # We ignore inbound messages; just keep connection open.
        await ws.wait_closed()
    finally:
        # Cleanup - must complete fully to avoid leaking connections
        heartbeat.cancel()
        writer.cancel()
        try:
            await asyncio.gather(writer, heartbeat, return_exceptions=True)
        except BaseException:
            pass
        connected_clients.discard(ws)
        queue_size = q.qsize()
        out_queues.pop(ws, None)
        # Only remove from IP map if this is still the current connection for this IP
        if client_by_ip.get(client_ip) == ws:
            client_by_ip.pop(client_ip, None)
        print(f"❌ WS disconnected from {client_ip} ({len(connected_clients)} remaining, cleared {queue_size} pending msgs)")

# -------------------------------
# Stats Reporter
# -------------------------------
async def stats_reporter():
    last_udp_drops = 0
    
    while True:
        await asyncio.sleep(5)
        now = time.time()
        dt = now - server_stats.last_report_time
        
        rx_diff = server_stats.rx_total - server_stats.rx_last_report
        ws_drop_diff = server_stats.ws_drop_total - server_stats.ws_drop_last_report
        
        rx_rate = rx_diff / dt
        
        # Get UDP socket drops from OS (Linux only)
        udp_drops = 0
        if udp_socket:
            try:
                # SO_RXQ_OVFL (40) returns packet drop count on Linux
                udp_drops = udp_socket.getsockopt(socket.SOL_SOCKET, 40)
            except (OSError, AttributeError):
                pass  # Not supported on this platform
        
        udp_drop_diff = udp_drops - last_udp_drops
        
        # Calculate max queue fill
        max_q = 0
        sum_q = 0
        client_count = len(connected_clients)
        if client_count > 0:
            for q in out_queues.values():
                sz = q.qsize()
                if sz > max_q: max_q = sz
                sum_q += sz
            avg_q = sum_q / client_count
        else:
            avg_q = 0

        print(f"Stats: {rx_rate:6.1f} pkts/s | RX: {server_stats.rx_total} | UDPdrop: {udp_drop_diff}/{udp_drops} | WSdrop: {ws_drop_diff}/{server_stats.ws_drop_total} | Clients: {client_count} | QMax: {max_q}")
        
        server_stats.last_report_time = now
        server_stats.rx_last_report = server_stats.rx_total
        server_stats.ws_drop_last_report = server_stats.ws_drop_total
        last_udp_drops = udp_drops

# -------------------------------
# Main
# -------------------------------
async def main():
    print(f"📡 UDP listener on 0.0.0.0:{UDP_PORT} (uvloop + orjson)")
    print(f"🌐 WebSocket on ws://0.0.0.0:{WS_PORT} (idle-silent)")

    loop = asyncio.get_running_loop()
    await loop.create_datagram_endpoint(
        lambda: UDPServer(),
        local_addr=("0.0.0.0", UDP_PORT),
    )
    
    # Start stats reporter
    asyncio.create_task(stats_reporter())

    # ping_interval=None => disable internal heartbeat to avoid collision with data
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
        # Install uvloop policy for maximum performance
        uvloop.install()
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Server stopped.")
