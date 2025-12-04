#!/usr/bin/env python3
import json
import socket
import sys
import time

def parse_line(line: str):
    line = line.strip()

    if not line:
        return None

    parts = line.split("|")

    # First part is status
    data = {"Status": parts[0]}

    # The remaining parts contain key:value fields
    for p in parts[1:]:
        if ":" in p:
            key, value = p.split(":", 1)
            data[key] = value
        else:
            # Handle fields without ":" just in case
            data[p] = ""

    return data


def send_udp(json_obj, host="127.0.0.1", port=20000):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    message = json.dumps(json_obj).encode("utf-8")
    sock.sendto(message, (host, port))
    sock.close()


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 send_log_udp.py <logfile>")
        sys.exit(1)

    logfile = sys.argv[1]

    try:
        with open(logfile, "r") as f:
            for line in f:
                parsed = parse_line(line)
                if parsed:
                    send_udp(parsed)
                    time.sleep(0.01)
    except FileNotFoundError:
        print(f"Error: File not found: {logfile}")
        sys.exit(1)


if __name__ == "__main__":
    main()

