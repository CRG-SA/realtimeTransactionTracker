import { useEffect, useRef, useState } from "react";
import type { ActiveTxn } from "../types";

type ProcEntry = { pid: number; txn: ActiveTxn & { durationMs: number }; host?: string; txnCount?: number; tps?: number; busyPct?: number };

const BUSY_LINGER_MS = 500;

const DEFAULT_WIDTHS = [22, 52, 70, 50, 60, 55, 55, 180, 70, 80, 150, 80, 80, 60, 60, 260];
const COLS = ["", "Status", "Mem", "PID", "Txns", "Tx/s", "%Busy", "Tid", "Status", "Mtp", "Fid", "Uid", "Seen", "Dur", "Idle", "Msg"];

function useColWidths() {
  const [widths, setWidths] = useState<number[]>(DEFAULT_WIDTHS);
  const dragging = useRef<{ col: number; startX: number; startW: number } | null>(null);

  const onMouseDown = (col: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { col, startX: e.clientX, startW: widths[col]! };

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - dragging.current.startX;
      const newW = Math.max(30, dragging.current.startW + delta);
      setWidths((prev) => prev.map((w, i) => i === dragging.current!.col ? newW : w));
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return { widths, onMouseDown };
}

function ProcRow({ pid, txn, staleSecs, txnCount, tps, busyPct, onKill, host, onProcDotClick }: { pid: number; txn: ActiveTxn & { durationMs: number }; staleSecs: number; txnCount: number; tps: number; busyPct: number; onKill?: ((pid: number, hnm: string) => void) | undefined; host: string; onProcDotClick?: ((host: string, pid: number, eid: string) => void) | undefined }) {
  const STALE_MS = staleSecs * 1000;
  const rawBusy = !txn.finalStatus;
  const [busy, setBusy] = useState(rawBusy);
  const [stale, setStale] = useState(() => Date.now() - txn.lastUpdateAt > STALE_MS);
  const [now, setNow] = useState(Date.now());
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
      lingerTimer.current = setTimeout(() => setBusy(false), BUSY_LINGER_MS);
    }
    return () => { if (lingerTimer.current) clearTimeout(lingerTimer.current); };
  }, [rawBusy]);

  useEffect(() => {
    setNow(Date.now());
    setStale(Date.now() - txn.lastUpdateAt > STALE_MS);
  }, [txn.lastUpdateAt, staleSecs]);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      setStale(Date.now() - txn.lastUpdateAt > STALE_MS);
    }, 1000);
    return () => clearInterval(id);
  }, [txn.lastUpdateAt, staleSecs]);

  const formatTime = (ms: number) => {
    const safeMs = Math.max(0, ms);
    const totalSecs = Math.floor(safeMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}m ${secs}s`;
  };

  const durationMs = Math.max(0, (txn.endAt ?? now) - txn.firstSeenAt);
  const idleMs = Math.max(0, now - txn.lastUpdateAt);
  const durationStr = formatTime(durationMs);
  const idleStr = formatTime(idleMs);

  const statusUp = (msg.Status ?? "").toUpperCase();
  const isDied = statusUp === "DIED";
  const isShutdown = statusUp === "SHUTDOWN";
  const hasError = statusUp === "ERROR";
  const dotClass = isDied || isShutdown ? "dot-dead" : stale ? "dot-stale" : busy ? "dot-busy" : "dot-idle";
  const statusLabel = isDied ? "died" : isShutdown ? "shutdown" : stale ? "stale" : busy ? "busy" : "idle";
  const statusClass = isDied ? "status-died" : isShutdown ? "status-shutdown" : stale ? "status-stale" : busy ? "status-busy" : "status-idle";
  const firstSeen = new Date(txn.firstSeenAt).toLocaleTimeString();

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDotClick = () => {
    const eid = msg.Eid ?? "(no eid)";
    onProcDotClick?.(host, pid, eid);
  };

  const handleRestart = () => {
    const hnm = msg.Hnm || "unknown";
    onKill?.(pid, hnm);
    setContextMenu(null);
  };

  const closeContext = () => {
    setContextMenu(null);
  };

  return (
    <>
      <tr className="dd-tr">
        <td className="dd-td dd-td-dot"><div className={`server-proc-dot ${dotClass}${hasError || isDied ? " dot-error-ring" : ""}`} onClick={handleDotClick} onContextMenu={handleContextMenu} style={{ cursor: "pointer" }} /></td>
      <td className="dd-td" title={statusLabel} onClick={handleDotClick} style={{ cursor: "pointer" }}><span className={statusClass}>{statusLabel}</span></td>
      <td className="dd-td" title={(msg as any).Ct2 ? `${(parseInt((msg as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB` : ""}>
        {(msg as any).Ct2 ? `${(parseInt((msg as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB` : "—"}
      </td>
      <td className="dd-td" title={String(pid)}>{pid}</td>
      <td className="dd-td" title={String(txnCount)}>{txnCount.toLocaleString()}</td>
      <td className="dd-td" title={tps.toFixed(1)}>{tps.toFixed(1)}</td>
      <td className="dd-td" title={`${busyPct.toFixed(2)}%`}>{busyPct.toFixed(2)}%</td>
      <td className="dd-td dd-mono" title={msg.Tid ?? ""}>{msg.Tid ?? "—"}</td>
      <td className="dd-td" title={msg.Status ?? ""}>{msg.Status ?? "—"}</td>
      <td className="dd-td" title={msg.Mtp ?? ""}>{msg.Mtp ?? "—"}</td>
      <td className="dd-td" title={msg.Fid ?? ""}>{msg.Fid ?? "—"}</td>
      <td className="dd-td" title={msg.Uid ?? ""}>{msg.Uid ?? "—"}</td>
      <td className="dd-td" title={firstSeen}>{firstSeen}</td>
      <td className="dd-td" title={durationStr}>{durationStr}</td>
      <td className="dd-td" title={rawBusy ? "" : idleStr}>{rawBusy ? "—" : idleStr}</td>
      <td className="dd-td dd-msg" title={msg.Msg ?? ""}>{msg.Msg ?? ""}</td>
      </tr>
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
            <div className="proc-dot-popup-row"><span className="proc-dot-key">First seen</span><span className="proc-dot-val">{firstSeen}</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">Duration</span><span className="proc-dot-val">{durationStr}</span></div>
            {(msg as any).Ct2 && <div className="proc-dot-popup-row"><span className="proc-dot-key">Memory</span><span className="proc-dot-val">{(parseInt((msg as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB</span></div>}
          </div>
          <button className="proc-context-restart-btn" onClick={handleRestart}>
            Restart Process
          </button>
        </div>
      )}
    </>
  );
}

function DrillDownTable({ hostProcs, staleSecs, onKill, host, onProcDotClick }: { hostProcs: ProcEntry[]; staleSecs: number; onKill?: ((pid: number, hnm: string) => void) | undefined; host: string; onProcDotClick?: ((host: string, pid: number, eid: string) => void) | undefined }) {
  const { widths, onMouseDown } = useColWidths();

  return (
    <table className="dd-table">
      <colgroup>
        {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
      </colgroup>
      <thead>
        <tr>
          {COLS.map((c, i) => (
            <th key={i} className="dd-th">
              <div className="dd-th-inner">
                <span>{c}</span>
                {i < COLS.length - 1 && (
                  <div className="dd-resize-handle" onMouseDown={(e) => onMouseDown(i, e)} />
                )}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {hostProcs.map(({ pid, txn, txnCount, tps, busyPct }) => (
          <ProcRow key={pid} pid={pid} txn={txn} staleSecs={staleSecs} txnCount={txnCount ?? 0} tps={tps ?? 0} busyPct={busyPct ?? 0} onKill={onKill} host={host} onProcDotClick={onProcDotClick} />
        ))}
      </tbody>
    </table>
  );
}

const LOGS_DEFAULT_WIDTHS = [90, 60, 100, 80, 80, 70, 150, 70, 70, 70, 260];
const LOGS_COLS = ["Time", "PID", "TID", "Severity", "Status", "Mtp", "Fid", "Uid", "Ret", "Mem", "Message"];

function useLogsColWidths() {
  const [widths, setWidths] = useState<number[]>(LOGS_DEFAULT_WIDTHS);
  const dragging = useRef<{ col: number; startX: number; startW: number } | null>(null);

  const onMouseDown = (col: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { col, startX: e.clientX, startW: widths[col]! };

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - dragging.current.startX;
      const newW = Math.max(30, dragging.current.startW + delta);
      setWidths((prev) => prev.map((w, i) => i === dragging.current!.col ? newW : w));
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return { widths, onMouseDown };
}

function LogsTable({ procs }: { procs: ProcEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { widths, onMouseDown } = useLogsColWidths();
  const [accumulatedLogs, setAccumulatedLogs] = useState<any[]>([]);
  const seenKeysRef = useRef<Set<string>>(new Set());

  const allLogs = procs.flatMap(({ pid, txn }) =>
    txn.messages.map((msg) => ({ ...msg, pid, tid: txn.tid, firstSeenAt: txn.firstSeenAt }))
  );

  // Accumulate new logs and avoid duplicates
  useEffect(() => {
    const newLogs = allLogs.filter((log) => {
      const key = `${log.pid}:${log.tid}:${log.Msg}:${log.Status}:${log.Severity}`;
      if (seenKeysRef.current.has(key)) return false;
      seenKeysRef.current.add(key);
      return true;
    });

    if (newLogs.length > 0) {
      setAccumulatedLogs((prev) => [...prev, ...newLogs]);
    }
  }, [allLogs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [accumulatedLogs.length]);

  if (accumulatedLogs.length === 0) {
    return <div className="logs-empty">No log messages yet</div>;
  }

  return (
    <div className="logs-container">
      <div className="logs-header">Message Log ({accumulatedLogs.length} messages)</div>
      <div className="logs-table-wrapper" ref={containerRef}>
        <table className="logs-table">
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              {LOGS_COLS.map((c, i) => (
                <th key={i} className="logs-th">
                  <div className="logs-th-inner">
                    <span>{c}</span>
                    {i < LOGS_COLS.length - 1 && (
                      <div className="logs-resize-handle" onMouseDown={(e) => onMouseDown(i, e)} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accumulatedLogs
              .sort((a, b) => {
                const timeA = (a as any)._receivedAt ?? a.firstSeenAt;
                const timeB = (b as any)._receivedAt ?? b.firstSeenAt;
                return timeA - timeB;
              })
              .map((log, i) => {
                const timestamp = (log as any)._receivedAt ?? log.firstSeenAt;
                const date = new Date(timestamp);
                const timeStr = `${date.toLocaleTimeString()}.${String(date.getMilliseconds()).padStart(3, '0')}`;
                return (
                  <tr key={i} className="logs-tr">
                    <td className="logs-td logs-td-time">{timeStr}</td>
                    <td className="logs-td logs-td-pid" title={String(log.pid)}>{log.pid}</td>
                    <td className="logs-td logs-td-tid" title={log.tid}>{log.tid}</td>
                    <td className="logs-td logs-td-severity" title={log.Severity ?? ""}>{log.Severity ?? "—"}</td>
                    <td className="logs-td logs-td-status" title={log.Status ?? ""}>{log.Status ?? "—"}</td>
                    <td className="logs-td" title={log.Mtp ?? ""}>{log.Mtp ?? "—"}</td>
                    <td className="logs-td" title={log.Fid ?? ""}>{log.Fid ?? "—"}</td>
                    <td className="logs-td" title={log.Uid ?? ""}>{log.Uid ?? "—"}</td>
                    <td className="logs-td" title={log.Ret !== undefined ? String(log.Ret) : ""}>{log.Ret !== undefined ? log.Ret : "—"}</td>
                    <td className="logs-td" title={(log as any).Ct2 ? `${(parseInt((log as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB` : ""}>
                      {(log as any).Ct2 ? `${(parseInt((log as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB` : "—"}
                    </td>
                    <td className="logs-td logs-td-message" title={log.Msg ?? ""}>{log.Msg ?? "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProcessDrillDown({ label, procs, staleSecs, onKill, onProcDotClick }: { label: string; procs: ProcEntry[]; staleSecs: number; onKill?: ((pid: number, hnm: string) => void) | undefined; onProcDotClick?: ((host: string, pid: number, eid: string) => void) | undefined }) {
  const byHost = new Map<string, ProcEntry[]>();
  for (const p of procs) {
    const h = p.host ?? p.txn.lastMsg.Hnm ?? "unknown";
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push(p);
  }

  return (
    <div className="drilldown-panel">
      {Array.from(byHost.entries()).map(([host, hostProcs]) => (
        <div key={host} className="drilldown-host-section">
          <div className="drilldown-host-header">{host}</div>
          <DrillDownTable hostProcs={hostProcs} staleSecs={staleSecs} onKill={onKill} host={host} onProcDotClick={onProcDotClick} />
        </div>
      ))}
      {byHost.size === 0 && (
        <div className="drilldown-empty">No processes seen for <strong>{label}</strong> yet.</div>
      )}
      {procs.length > 0 && <LogsTable procs={procs} />}
    </div>
  );
}
