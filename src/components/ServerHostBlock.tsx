import { useEffect, useRef, useState } from "react";
import type { ActiveTxn } from "../types";
import { human } from "../utils";

type ProcEntry = { pid: number; txn: ActiveTxn & { durationMs: number } };
type EidGroup = { eid: string; procs: ProcEntry[] };
type ServerGroup = { host: string; eids: EidGroup[] };

const BUSY_LINGER_MS = 500;

function ProcDot({ pid, txn, staleSecs }: { pid: number; txn: ActiveTxn & { durationMs: number }; staleSecs: number }) {
  const STALE_MS = staleSecs * 1000;
  const rawBusy = !txn.finalStatus;
  const [busy, setBusy] = useState(rawBusy);
  const [stale, setStale] = useState(() => Date.now() - txn.lastUpdateAt > STALE_MS);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevBusy = useRef(rawBusy);
  const msg = txn.lastMsg;

  useEffect(() => {
    if (rawBusy === prevBusy.current) return;
    prevBusy.current = rawBusy;

    if (rawBusy) {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
      setBusy(true);
    } else {
      lingerTimer.current = setTimeout(() => setBusy(false), BUSY_LINGER_MS);
    }

    return () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    };
  }, [rawBusy]);

  useEffect(() => {
    setStale(Date.now() - txn.lastUpdateAt > STALE_MS);
  }, [txn.lastUpdateAt, staleSecs]);

  useEffect(() => {
    const id = setInterval(() => setStale(Date.now() - txn.lastUpdateAt > STALE_MS), 10_000);
    return () => clearInterval(id);
  }, [txn.lastUpdateAt, staleSecs]);

  const dotClass = stale ? "dot-stale" : busy ? "dot-busy" : "dot-idle";

  return (
    <div className="proc-dot-wrap">
      <div
        className={`server-proc-dot ${dotClass}`}
        onMouseEnter={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setMousePos(null)}
      />
      {mousePos && (
        <div className="proc-dot-popup" style={{ left: mousePos.x + 12, top: mousePos.y - 8 }}>
          <div className="proc-dot-popup-row proc-dot-popup-title">
            <span>{msg.Eid ? msg.Eid : `PID ${pid}`}</span>
            <span className={`proc-dot-status ${busy ? "status-busy" : "status-idle"}`}>
              {busy ? "busy" : "idle"}
            </span>
          </div>
          <div className="proc-dot-popup-row"><span className="proc-dot-key">PID</span><span className="proc-dot-val">{pid}</span></div>
          {msg.Tid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Tid</span><span className="proc-dot-val">{msg.Tid}</span></div>}
          {msg.Status && <div className="proc-dot-popup-row"><span className="proc-dot-key">Status</span><span className="proc-dot-val">{msg.Status}</span></div>}
          {msg.Mtp && <div className="proc-dot-popup-row"><span className="proc-dot-key">Mtp</span><span className="proc-dot-val">{msg.Mtp}</span></div>}
          {msg.Fid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Fid</span><span className="proc-dot-val">{msg.Fid}</span></div>}
          {msg.Uid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Uid</span><span className="proc-dot-val">{msg.Uid}</span></div>}
          {msg.Msg && <div className="proc-dot-popup-row"><span className="proc-dot-key">Msg</span><span className="proc-dot-val">{msg.Msg}</span></div>}
          <div className="proc-dot-popup-row"><span className="proc-dot-key">First seen</span><span className="proc-dot-val">{new Date(txn.firstSeenAt).toLocaleTimeString()}</span></div>
          <div className="proc-dot-popup-row"><span className="proc-dot-key">Duration</span><span className="proc-dot-val">{human(txn.durationMs)}</span></div>
        </div>
      )}
    </div>
  );
}

export function ServerHostBlock({ group, thresholdSeconds: _thresholdSeconds, onClick, staleSecs }: { group: ServerGroup; thresholdSeconds: number; onClick?: () => void; staleSecs: number }) {
  const { eids } = group;

  return (
    <div className="server-proc-dots" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      {eids[0]?.procs.map(({ pid, txn }) => (
        <ProcDot key={pid} pid={pid} txn={txn} staleSecs={staleSecs} />
      ))}
    </div>
  );
}
