#!/usr/bin/env python3
import socket
import json
import time
import uuid
import os

# Configuration from environment variables
UDP_IP = os.environ.get("UDP_IP", "127.0.0.1")
UDP_PORT = int(os.environ.get("UDP_PORT", 20000))
PKTS_PER_SECOND = int(os.environ.get("PPS", 100))

# Sample data template based on user requirements
TEMPLATE = {
    "Status": "INFO",
    "Uxd": "03/12/2025",
    "Uxt": "12:14:22.946",
    "Dbd": "",
    "Eid": "sss",
    "Hnm": "bdolitutapp1.telkom.co.za",
    "Pid": "4272",
    "Fid": "_log_QueryProviderEmployeesByFunction",
    "Tid": "",
    "Fnm": "ssssessionimpl.cc",
    "Mtp": "TrnEnd",
    "Key": "11",
    "Uid": "Kgopajt",
    "Cid": "PIGGYBACK NOT USED",
    "Icn": "10.254.105.48",
    "Ocn": "",
    "Ret": "0",
    "Ern": "0",
    "Ct1": "17547",
    "Ct2": "-1:0",
    "Msg": "Transaction ended with success"
}

def generator():
    # Attempt to load orjson if available for performance, fallback to json
    try:
        import orjson
        dumps = lambda d: orjson.dumps(d)
    except ImportError:
        dumps = lambda d: json.dumps(d).encode('utf-8')

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"🚀 Starting load generator -> {UDP_IP}:{UDP_PORT}")
    print(f"📈 Target Rate: {PKTS_PER_SECOND} pkts/s")
    print(f"💡 Sequence: START -> INFO -> SUCCESS (New Tid per set)")
    
    interval = 1.0 / PKTS_PER_SECOND
    
    status_cycle = ["START", "INFO", "SUCCESS"]
    status_idx = 0
    current_tid = str(uuid.uuid4())
    
    count = 0
    start_time = time.time()
    
    try:
        while True:
            # Create packet
            data = TEMPLATE.copy()
            status = status_cycle[status_idx]
            
            # Update dynamic fields
            data["Status"] = status
            data["Tid"] = current_tid
            data["Uxt"] = time.strftime("%H:%M:%S") + f".{int((time.time() % 1) * 1000):03d}"
            
            # Send packet
            payload = dumps(data)
            sock.sendto(payload, (UDP_IP, UDP_PORT))
            
            count += 1
            
            # Cycle status and Tid
            status_idx = (status_idx + 1) % 3
            if status_idx == 0:
                current_tid = str(uuid.uuid4())
                
            # Precise timing to maintain target PPS
            elapsed = time.time() - start_time
            expected_time = count * interval
            sleep_time = expected_time - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)
                
            # Progress update
            if count % PKTS_PER_SECOND == 0:
                rate = count / (time.time() - start_time)
                print(f"Sent {count} pkts | Avg Rate: {rate:.1f} pkts/s", end='\r')

    except KeyboardInterrupt:
        total_time = time.time() - start_time
        print(f"\n\n🛑 Stopped. Sent {count} total packets in {total_time:.1f}s")
        print(f"🏁 Final Avg Rate: {count/total_time:.1f} pkts/s")

if __name__ == "__main__":
    generator()
