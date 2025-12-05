#!/usr/bin/env python3
import json
import socket
import sys
import time
from datetime import datetime


def parse_line(line: str):
    line = line.strip()
    if not line:
        return None

    parts = line.split("|")

    # First part is status
    data = {"Status": parts[0]}

    for p in parts[1:]:
        if ":" in p:
            key, value = p.split(":", 1)
            data[key] = value
        else:
            data[p] = ""

    return data


def parse_uxt(uxt_str):
    """ Uxt format: HH:MM:SS.mmm """
    try:
        return datetime.strptime(uxt_str, "%H:%M:%S.%f")
    except:
        return None


def send_udp(json_obj, host="127.0.0.1", port=20000):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    message = json.dumps(json_obj).encode("utf-8")
    sock.sendto(message, (host, port))
    sock.close()


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 send_log_udp_realtime.py <logfile>")
        sys.exit(1)

    logfile = sys.argv[1]

    previous_time = None

    try:
        with open(logfile, "r") as f:
            for line in f:
                parsed = parse_line(line)
                if not parsed:
                    continue

                uxt_str = parsed.get("Uxt")
                current_time = parse_uxt(uxt_str)

                if current_time and previous_time:
                    delta = (current_time - previous_time).total_seconds()

                    # NEW RULE:
                    # if delta >= 10 seconds → sleep only 1 second
                    if delta >= 10:
                        time.sleep(1)
                    elif delta > 0:
                        time.sleep(delta)

                send_udp(parsed)

                if current_time:
                    previous_time = current_time

    except FileNotFoundError:
        print(f"Error: File not found: {logfile}")
        sys.exit(1)


if __name__ == "__main__":
    main()
