#!/usr/bin/env python3
#
# Replay udpSock.json to UDP localhost:20000, time-aligned to _recv_ts_ms.
#
# Usage:
#   python playback.py [--file /tmp/udpSock.json] [--port 20000] [--speed 100]
#
#   --speed  Playback speed as a percentage of real time.
#            100 = real time, 200 = 2x faster, 50 = half speed.

import argparse
import socket
import time
import sys

try:
    import orjson as json_lib
    def dumps(obj): return json_lib.dumps(obj)
    def loads(line): return json_lib.loads(line)
except ImportError:
    import json as json_lib
    def dumps(obj): return json_lib.dumps(obj).encode()
    def loads(line): return json_lib.loads(line)


def main():
    parser = argparse.ArgumentParser(description="Replay udpSock.json log over UDP")
    parser.add_argument("--file",  default="/tmp/udpSock.json", help="Path to NDJSON log file")
    parser.add_argument("--host",  default="127.0.0.1",         help="UDP destination host")
    parser.add_argument("--port",  default=20000, type=int,     help="UDP destination port")
    parser.add_argument("--speed",  default=100.0, type=float,  help="Playback speed %% (100=realtime)")
    parser.add_argument("--filter", default=[], nargs="+",      help="Filter expressions e.g. Eid=mts Status=success")
    args = parser.parse_args()

    if args.speed <= 0:
        print("ERROR: --speed must be > 0", file=sys.stderr)
        sys.exit(1)

    speed_factor = args.speed / 100.0  # >1 = faster, <1 = slower

    # Parse filter expressions: "Key=value" — all must match (AND)
    filters = []
    for expr in args.filter:
        if "=" not in expr:
            print(f"ERROR: invalid filter '{expr}' — expected Key=value", file=sys.stderr)
            sys.exit(1)
        key, val = expr.split("=", 1)
        filters.append((key.strip(), val.strip().lower()))
    if filters:
        print(f"Filters: {' AND '.join(f'{k}={v}' for k, v in filters)}")

    print(f"Streaming {args.file} ...")
    print(f"Sending to udp://{args.host}:{args.port}  |  speed: {args.speed}%")
    print("Press Ctrl+C to stop.\n")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    dest = (args.host, args.port)

    first_log_ts = None
    wall_start   = None
    sent         = 0

    try:
        with open(args.file, "r") as fh:
            for lineno, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue

                try:
                    obj = loads(line)
                except Exception as e:
                    print(f"  Line {lineno}: parse error ({e}), skipping")
                    continue

                log_ts = obj.get("_recv_ts_ms")
                if log_ts is None:
                    continue

                # Apply filters — all expressions must match
                if filters and not all(
                    str(obj.get(k, "")).lower() == v for k, v in filters
                ):
                    continue

                payload = dumps(obj)

                # Anchor timing to the first packet
                if first_log_ts is None:
                    first_log_ts = log_ts
                    wall_start   = time.perf_counter()

                # Sleep until it's time to send this packet
                log_offset_ms = log_ts - first_log_ts
                target_wall_s = (log_offset_ms / 1000.0) / speed_factor
                sleep_s = target_wall_s - (time.perf_counter() - wall_start)
                if sleep_s > 0:
                    time.sleep(sleep_s)

                sock.sendto(payload, dest)
                sent += 1

                if sent % 10_000 == 0:
                    elapsed = time.perf_counter() - wall_start
                    print(f"  {sent:,} sent  |  line {lineno:,}  |  elapsed: {elapsed:.1f}s")

    except KeyboardInterrupt:
        print(f"\nStopped after {sent:,} packets.")
    finally:
        sock.close()

    elapsed = time.perf_counter() - wall_start if wall_start else 0
    print(f"\nDone. {sent:,} packets sent in {elapsed:.2f}s.")


if __name__ == "__main__":
    main()
