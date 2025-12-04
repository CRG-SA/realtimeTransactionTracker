# Realtime Transaction Tracker (React + React-Bootstrap)

A production-ready UI that listens on a WebSocket (default `ws://<host>:8765`), tracks transactions by `Tid`, and highlights long-running ones:
- Start of transaction = first time a `Tid` is seen
- End = a message with `Status` of `SUCCESS` or `FAILED` (auto-remove)
- Color by age: <10s green, 10–60s amber, ≥60s red
- Sorted longest first, search/filter, per-row remove, clear all
- Optional **Demo mode** inside the UI and a separate **mock WebSocket server** (`npm run mock:ws`)

## Quick start

```bash
npm install
npm run dev
```
Open http://localhost:5173

If your WebSocket runs elsewhere/another port, pass `?ws=ws://HOST:PORT`:
```
http://localhost:5173/?ws=ws://localhost:8765
```

### Mock WebSocket server (optional)
Use this if you don’t have a backend yet.
```bash
npm run mock:ws
```
This starts a simple server on `ws://localhost:8765` and streams demo payloads matching your schema.

### Build
```bash
npm run build
npm run preview
