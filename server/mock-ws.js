// Simple mock WebSocket server that emits your schema to connected clients
// Usage: npm run mock:ws

import { WebSocketServer } from 'ws';

const PORT = 8765;
const wss = new WebSocketServer({ port: PORT });
console.log(`Mock WebSocket server listening on ws://localhost:${PORT}`);

function fmtTime(d) {
  const pad = (n, w=2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
}

function demoFlow() {
  const startTime = new Date();
  const uxd = `${String(startTime.getDate()).padStart(2,'0')}/${String(startTime.getMonth()+1).padStart(2,'0')}/${startTime.getFullYear()}`;
  const tid = crypto.randomUUID();

  const base = {
    Status: 'INFO',
    Uxd: uxd,
    Uxt: fmtTime(startTime),
    Eid: 'UNIClientApp',
    Hnm: 'pc12345',
    Pid: 2456,
    Fid: 'LoadCustomerData',
    Tid: tid,
    Cid: 'operator1',
    Uid: 'uobj00i4',
    Mtp: 'TrnBusy',
    Ret: 0,
    Msg: "Client reported 'busy loading data' while retrieving customer details",
    Elapsed: 0,
    Severity: 'Medium'
  };

  const packets = [base];
  const busyCount = Math.floor(6 + Math.random() * 10);
  for (let i = 0; i < busyCount; i++) {
    const t = new Date(startTime.getTime() + (i+1) * 1500);
    packets.push({ ...base, Uxt: fmtTime(t), Elapsed: (i+1)*1500 });
  }
  const endAt = new Date(startTime.getTime() + (busyCount+2) * 1500);
  packets.push({ ...base, Status: Math.random() < 0.85 ? 'SUCCESS' : 'FAILED', Uxt: fmtTime(endAt) });

  return packets;
}

function broadcast(obj) {
  const json = JSON.stringify(obj);
  for (const client of wss.clients) {
    try { client.send(json); } catch {}
  }
}

setInterval(() => {
  const flow = demoFlow();
  let i = 0;
  const id = setInterval(() => {
    broadcast(flow[i]);
    i += 1;
    if (i >= flow.length) clearInterval(id);
  }, 500);
}, 3000);
