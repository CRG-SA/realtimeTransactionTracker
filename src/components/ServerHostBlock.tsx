import { useEffect, useRef, useState } from "react";
import type { ActiveTxn } from "../types";
import { human } from "../utils";

type ProcEntry = { pid: number; txn: ActiveTxn & { durationMs: number }; txnCount?: number; tps?: number; busyPct?: number };
type EidGroup = { eid: string; procs: ProcEntry[] };
type ServerGroup = { host: string; eids: EidGroup[] };

function ProcDot({ pid, txn, staleSecs, txnCount, tps, busyPct, tpsInnerDotThreshold, busyPctInnerDotThreshold, busyLingerMs, onClick, onKill }: {
  pid: number;
  txn: ActiveTxn & { durationMs: number };
  staleSecs: number;
  txnCount: number;
  tps: number;
  busyPct: number;
  tpsInnerDotThreshold: number;
  busyPctInnerDotThreshold: number;
  busyLingerMs: number;
  onClick?: (() => void) | undefined;
  onKill?: ((pid: number, hnm: string) => void) | undefined;
}) {
  const STALE_MS = staleSecs * 1000;
  const rawBusy = !txn.finalStatus;
  const [busy, setBusy] = useState(rawBusy);
  const [stale, setStale] = useState(() => Date.now() - txn.lastUpdateAt > STALE_MS);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
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
      lingerTimer.current = setTimeout(() => setBusy(false), busyLingerMs);
    }

    return () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    };
  }, [rawBusy, busyLingerMs]);

  useEffect(() => {
    setStale(Date.now() - txn.lastUpdateAt > STALE_MS);
  }, [txn.lastUpdateAt, staleSecs]);

  useEffect(() => {
    const id = setInterval(() => setStale(Date.now() - txn.lastUpdateAt > STALE_MS), 10_000);
    return () => clearInterval(id);
  }, [txn.lastUpdateAt, staleSecs]);

  const statusUp = (msg.Status ?? "").toUpperCase();
  const isDied = statusUp === "DIED";
  const isShutdown = statusUp === "SHUTDOWN";
  const hasError = statusUp === "ERROR";
  const dotClass = isDied || isShutdown ? "dot-dead" : stale ? "dot-stale" : busy ? "dot-busy" : "dot-idle";

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleKill = () => {
    const hnm = msg.Hnm || "unknown";
    onKill?.(pid, hnm);
    setContextMenu(null);
  };

  const closeContext = () => {
    setContextMenu(null);
  };

  return (
    <div className="proc-dot-wrap">
      <div
        className={`server-proc-dot ${dotClass}${hasError || isDied ? " dot-error-ring" : ""}`}
        onMouseEnter={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setMousePos(null)}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        style={onClick ? { cursor: "pointer" } : undefined}
      >
        {(tps > tpsInnerDotThreshold || busyPct > busyPctInnerDotThreshold) && <div className="dot-high-tps" />}
      </div>
      {mousePos && !contextMenu && (
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
          <div className="proc-dot-popup-row"><span className="proc-dot-key">Txns</span><span className="proc-dot-val">{txnCount.toLocaleString()}</span></div>
          <div className="proc-dot-popup-row"><span className="proc-dot-key">Tx/s</span><span className="proc-dot-val">{tps.toFixed(1)}</span></div>
          <div className="proc-dot-popup-row"><span className="proc-dot-key">%Busy</span><span className="proc-dot-val">{busyPct.toFixed(2)}%</span></div>
          <div className="proc-dot-popup-row"><span className="proc-dot-key">First seen</span><span className="proc-dot-val">{new Date(txn.firstSeenAt).toLocaleTimeString()}</span></div>
          <div className="proc-dot-popup-row"><span className="proc-dot-key">Duration</span><span className="proc-dot-val">{human(txn.durationMs)}</span></div>
          {(msg as any).Ct2 && <div className="proc-dot-popup-row"><span className="proc-dot-key">Memory</span><span className="proc-dot-val">{(parseInt((msg as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB</span></div>}
        </div>
      )}
      {contextMenu && (
        <div className="proc-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="proc-context-header">
            <span className="proc-context-title">{msg.Eid ? msg.Eid : `PID ${pid}`}</span>
            <button className="proc-context-close" onClick={closeContext}>✕</button>
          </div>
          <div className="proc-context-content">
            <div className="proc-dot-popup-row"><span className="proc-dot-key">PID</span><span className="proc-dot-val">{pid}</span></div>
            {msg.Tid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Tid</span><span className="proc-dot-val">{msg.Tid}</span></div>}
            {msg.Status && <div className="proc-dot-popup-row"><span className="proc-dot-key">Status</span><span className="proc-dot-val">{msg.Status}</span></div>}
            {msg.Mtp && <div className="proc-dot-popup-row"><span className="proc-dot-key">Mtp</span><span className="proc-dot-val">{msg.Mtp}</span></div>}
            {msg.Fid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Fid</span><span className="proc-dot-val">{msg.Fid}</span></div>}
            {msg.Uid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Uid</span><span className="proc-dot-val">{msg.Uid}</span></div>}
            {msg.Msg && <div className="proc-dot-popup-row"><span className="proc-dot-key">Msg</span><span className="proc-dot-val">{msg.Msg}</span></div>}
            <div className="proc-dot-popup-row"><span className="proc-dot-key">Txns</span><span className="proc-dot-val">{txnCount.toLocaleString()}</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">Tx/s</span><span className="proc-dot-val">{tps.toFixed(1)}</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">%Busy</span><span className="proc-dot-val">{busyPct.toFixed(2)}%</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">First seen</span><span className="proc-dot-val">{new Date(txn.firstSeenAt).toLocaleTimeString()}</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">Duration</span><span className="proc-dot-val">{human(txn.durationMs)}</span></div>
            {(msg as any).Ct2 && <div className="proc-dot-popup-row"><span className="proc-dot-key">Memory</span><span className="proc-dot-val">{(parseInt((msg as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB</span></div>}
          </div>
          <button className="proc-context-restart-btn" onClick={handleKill}>
            Restart Process
          </button>
        </div>
      )}
    </div>
  );
}

export function ServerHostBlock({ group, thresholdSeconds: _thresholdSeconds, onClick, staleSecs, tpsInnerDotThreshold, busyPctInnerDotThreshold, busyLingerMs, onProcDotClick, onKill }: {
  group: ServerGroup;
  thresholdSeconds: number;
  onClick?: () => void;
  staleSecs: number;
  tpsInnerDotThreshold: number;
  busyPctInnerDotThreshold: number;
  busyLingerMs: number;
  onProcDotClick?: (pid: number, eid: string) => void;
  onKill?: (pid: number, hnm: string) => void;
}) {
  const { eids } = group;

  return (
    <div className="server-proc-dots" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      {eids[0]?.procs.map(({ pid, txn, txnCount, tps, busyPct }) => {
        const eid = txn.lastMsg.Eid ?? "(no eid)";
        const handleClick = onProcDotClick ? () => onProcDotClick(pid, eid) : undefined;
        return (
          <ProcDot
            key={pid}
            pid={pid}
            txn={txn}
            staleSecs={staleSecs}
            txnCount={txnCount ?? 0}
            tps={tps ?? 0}
            busyPct={busyPct ?? 0}
            tpsInnerDotThreshold={tpsInnerDotThreshold}
            busyPctInnerDotThreshold={busyPctInnerDotThreshold}
            busyLingerMs={busyLingerMs}
            onClick={handleClick}
            onKill={onKill}
          />
        );
      })}
    </div>
  );
}
