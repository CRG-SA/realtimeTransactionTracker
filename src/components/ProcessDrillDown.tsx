import { useEffect, useRef, useState } from "react";
import type { ActiveTxn } from "../types";
import { computeProcState, dotClassFor, statusClassFor, statusLabelFor } from "../utils";

type ProcEntry = { pid: number; txn: ActiveTxn & { durationMs: number }; host?: string; txnCount?: number; tps?: number; busyPct?: number };

const BUSY_LINGER_MS = 500;

const DEFAULT_WIDTHS = [22, 52, 70, 50, 60, 55, 55, 180, 70, 80, 150, 60, 80, 80, 60, 60, 260];
const COLS = ["", "State", "Mem", "PID", "Txns", "Tx/s", "%Busy", "Tid", "Status", "Mtp", "Fid", "Key", "Uid", "Seen", "Dur", "Idle", "Msg"];

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
  const msg = txn.lastMsg;
  const procState = computeProcState(msg.Status);
  const { isTerminal, isError: hasError } = procState;
  const rawBusy = !txn.finalStatus && !isTerminal;
  const [busy, setBusy] = useState(rawBusy);
  const [stale, setStale] = useState(() => !isTerminal && Date.now() - txn.lastUpdateAt > STALE_MS);
  const [now, setNow] = useState(Date.now());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevBusy = useRef(rawBusy);

  useEffect(() => {
    if (isTerminal) {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
      setBusy(false);
      setStale(false);
      return;
    }
    if (rawBusy === prevBusy.current) return;
    prevBusy.current = rawBusy;
    if (rawBusy) {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
      setBusy(true);
    } else {
      lingerTimer.current = setTimeout(() => setBusy(false), BUSY_LINGER_MS);
    }
    return () => { if (lingerTimer.current) clearTimeout(lingerTimer.current); };
  }, [rawBusy, isTerminal]);

  useEffect(() => {
    setNow(Date.now());
    if (!isTerminal) setStale(Date.now() - txn.lastUpdateAt > STALE_MS);
  }, [txn.lastUpdateAt, staleSecs, isTerminal]);

  useEffect(() => {
    if (isTerminal) return;
    const id = setInterval(() => {
      setNow(Date.now());
      setStale(Date.now() - txn.lastUpdateAt > STALE_MS);
    }, 1000);
    return () => clearInterval(id);
  }, [txn.lastUpdateAt, staleSecs, isTerminal]);

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

  const dotClass = dotClassFor(procState, stale, busy);
  const statusLabel = statusLabelFor(procState, stale, busy);
  const statusClass = statusClassFor(procState, stale, busy);
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
      <tr id={`dd-row-${pid}`} className="dd-tr">
        <td id={`dd-cell-dot-${pid}`} className="dd-td dd-td-dot">
          <div
            id={`dd-dot-${pid}`}
            className={`server-proc-dot ${dotClass}${hasError || procState.isDied ? " dot-error-ring" : ""}`}
            onClick={handleDotClick}
            onContextMenu={handleContextMenu}
            style={{ cursor: "pointer" }}
          />
        </td>
        <td id={`dd-cell-status-${pid}`} className="dd-td" title={statusLabel} onClick={handleDotClick} style={{ cursor: "pointer" }}>
          <span className={statusClass}>{statusLabel}</span>
        </td>
        <td id={`dd-cell-mem-${pid}`} className="dd-td" title={(msg as any).Ct2 ? `${(parseInt((msg as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB` : ""}>
          {(msg as any).Ct2 ? `${(parseInt((msg as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB` : "—"}
        </td>
        <td id={`dd-cell-pid-${pid}`} className="dd-td" title={String(pid)}>{pid}</td>
        <td id={`dd-cell-txns-${pid}`} className="dd-td" title={String(txnCount)}>{txnCount.toLocaleString()}</td>
        <td id={`dd-cell-tps-${pid}`} className="dd-td" title={tps.toFixed(1)}>{tps.toFixed(1)}</td>
        <td id={`dd-cell-busy-${pid}`} className="dd-td" title={`${busyPct.toFixed(2)}%`}>{busyPct.toFixed(2)}%</td>
        <td id={`dd-cell-tid-${pid}`} className="dd-td dd-mono" title={msg.Tid ?? ""}>{msg.Tid ?? "—"}</td>
        <td id={`dd-cell-msgstatus-${pid}`} className="dd-td" title={msg.Status ?? ""}>{msg.Status ?? "—"}</td>
        <td id={`dd-cell-mtp-${pid}`} className="dd-td" title={msg.Mtp ?? ""}>{msg.Mtp ?? "—"}</td>
        <td id={`dd-cell-fid-${pid}`} className="dd-td" title={msg.Fid ?? ""}>{msg.Fid ?? "—"}</td>
        <td id={`dd-cell-key-${pid}`} className="dd-td" title={msg.Key ?? ""}>{msg.Key ?? "—"}</td>
        <td id={`dd-cell-uid-${pid}`} className="dd-td" title={msg.Uid ?? ""}>{msg.Uid ?? "—"}</td>
        <td id={`dd-cell-seen-${pid}`} className="dd-td" title={firstSeen}>{firstSeen}</td>
        <td id={`dd-cell-dur-${pid}`} className="dd-td" title={durationStr}>{durationStr}</td>
        <td id={`dd-cell-idle-${pid}`} className="dd-td" title={rawBusy ? "" : idleStr}>{rawBusy ? "—" : idleStr}</td>
        <td id={`dd-cell-msg-${pid}`} className="dd-td dd-msg" title={msg.Msg ?? ""}>{msg.Msg ?? ""}</td>
      </tr>
      {contextMenu && (
        <div id={`dd-context-menu-${pid}`} className="proc-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div id={`dd-context-header-${pid}`} className="proc-context-header">
            <span id={`dd-context-title-${pid}`} className="proc-context-title">
              {msg.Eid ? msg.Eid : `PID ${pid}`}
            </span>
            <button id={`dd-context-close-${pid}`} className="proc-context-close" onClick={closeContext}>✕</button>
          </div>
          <div id={`dd-context-content-${pid}`} className="proc-context-content">
            <div className="proc-dot-popup-row"><span className="proc-dot-key">PID</span><span className="proc-dot-val">{pid}</span></div>
            {msg.Tid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Tid</span><span className="proc-dot-val">{msg.Tid}</span></div>}
            {msg.Status && <div className="proc-dot-popup-row"><span className="proc-dot-key">Status</span><span className="proc-dot-val">{msg.Status}</span></div>}
            {msg.Mtp && <div className="proc-dot-popup-row"><span className="proc-dot-key">Mtp</span><span className="proc-dot-val">{msg.Mtp}</span></div>}
            {msg.Fid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Fid</span><span className="proc-dot-val">{msg.Fid}</span></div>}
            {msg.Key && <div className="proc-dot-popup-row"><span className="proc-dot-key">Key</span><span className="proc-dot-val">{msg.Key}</span></div>}
            {msg.Uid && <div className="proc-dot-popup-row"><span className="proc-dot-key">Uid</span><span className="proc-dot-val">{msg.Uid}</span></div>}
            {msg.Msg && <div className="proc-dot-popup-row"><span className="proc-dot-key">Msg</span><span className="proc-dot-val">{msg.Msg}</span></div>}
            <div className="proc-dot-popup-row"><span className="proc-dot-key">Txns</span><span className="proc-dot-val">{txnCount.toLocaleString()}</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">Tx/s</span><span className="proc-dot-val">{tps.toFixed(1)}</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">%Busy</span><span className="proc-dot-val">{busyPct.toFixed(2)}%</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">First seen</span><span className="proc-dot-val">{firstSeen}</span></div>
            <div className="proc-dot-popup-row"><span className="proc-dot-key">Duration</span><span className="proc-dot-val">{durationStr}</span></div>
            {(msg as any).Ct2 && <div className="proc-dot-popup-row"><span className="proc-dot-key">Memory</span><span className="proc-dot-val">{(parseInt((msg as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB</span></div>}
          </div>
          <button id={`dd-context-restart-btn-${pid}`} className="proc-context-restart-btn" onClick={handleRestart}>
            Restart Process
          </button>
        </div>
      )}
    </>
  );
}

function DrillDownTable({ hostProcs, staleSecs, onKill, host, onProcDotClick }: { hostProcs: ProcEntry[]; staleSecs: number; onKill?: ((pid: number, hnm: string) => void) | undefined; host: string; onProcDotClick?: ((host: string, pid: number, eid: string) => void) | undefined }) {
  const { widths, onMouseDown } = useColWidths();
  const safeHost = host.replace(/[^a-zA-Z0-9_\-.]/g, "_");

  return (
    <table id={`dd-table-${safeHost}`} className="dd-table">
      <colgroup>
        {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
      </colgroup>
      <thead id={`dd-thead-${safeHost}`}>
        <tr id={`dd-thead-row-${safeHost}`}>
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
      <tbody id={`dd-tbody-${safeHost}`}>
        {hostProcs.map(({ pid, txn, txnCount, tps, busyPct }) => (
          <ProcRow key={pid} pid={pid} txn={txn} staleSecs={staleSecs} txnCount={txnCount ?? 0} tps={tps ?? 0} busyPct={busyPct ?? 0} onKill={onKill} host={host} onProcDotClick={onProcDotClick} />
        ))}
      </tbody>
    </table>
  );
}

const LOGS_DEFAULT_WIDTHS = [90, 60, 100, 80, 80, 70, 150, 60, 70, 70, 70, 260];
const LOGS_COLS = ["Time", "PID", "TID", "Severity", "Status", "Mtp", "Fid", "Key", "Uid", "Ret", "Mem", "Message"];

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

  useEffect(() => {
    const newLogs = allLogs.filter((log) => {
      const key = `${log.pid}:${log.tid}:${log.Msg}:${log.Status}:${log.Severity}:${(log as any)._receivedAt ?? log.firstSeenAt}`;
      if (seenKeysRef.current.has(key)) return false;
      seenKeysRef.current.add(key);
      return true;
    });

    if (newLogs.length > 0) {
      setAccumulatedLogs((prev) => [...prev, ...newLogs]);
    }
  }, [allLogs]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [accumulatedLogs.length]);

  if (accumulatedLogs.length === 0) {
    return <div id="logs-empty" className="logs-empty">No log messages yet</div>;
  }

  return (
    <div id="logs-container" className="logs-container">
      <div id="logs-header" className="logs-header">Message Log ({accumulatedLogs.length} messages)</div>
      <div id="logs-table-wrapper" className="logs-table-wrapper" ref={containerRef}>
        <table id="logs-table" className="logs-table">
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead id="logs-thead">
            <tr id="logs-thead-row">
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
          <tbody id="logs-tbody">
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
                  <tr key={i} id={`logs-row-${i}`} className="logs-tr">
                    <td id={`logs-cell-time-${i}`} className="logs-td logs-td-time">{timeStr}</td>
                    <td id={`logs-cell-pid-${i}`} className="logs-td logs-td-pid" title={String(log.pid)}>{log.pid}</td>
                    <td id={`logs-cell-tid-${i}`} className="logs-td logs-td-tid" title={log.tid}>{log.tid}</td>
                    <td id={`logs-cell-severity-${i}`} className="logs-td logs-td-severity" title={log.Severity ?? ""}>{log.Severity ?? "—"}</td>
                    <td id={`logs-cell-status-${i}`} className="logs-td logs-td-status" title={log.Status ?? ""}>{log.Status ?? "—"}</td>
                    <td id={`logs-cell-mtp-${i}`} className="logs-td" title={log.Mtp ?? ""}>{log.Mtp ?? "—"}</td>
                    <td id={`logs-cell-fid-${i}`} className="logs-td" title={log.Fid ?? ""}>{log.Fid ?? "—"}</td>
                    <td id={`logs-cell-key-${i}`} className="logs-td" title={log.Key ?? ""}>{log.Key ?? "—"}</td>
                    <td id={`logs-cell-uid-${i}`} className="logs-td" title={log.Uid ?? ""}>{log.Uid ?? "—"}</td>
                    <td id={`logs-cell-ret-${i}`} className="logs-td" title={log.Ret !== undefined ? String(log.Ret) : ""}>{log.Ret !== undefined ? log.Ret : "—"}</td>
                    <td id={`logs-cell-mem-${i}`} className="logs-td" title={(log as any).Ct2 ? `${(parseInt((log as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB` : ""}>
                      {(log as any).Ct2 ? `${(parseInt((log as any).Ct2.split(":")[0]) / 1048576).toFixed(1)} MB` : "—"}
                    </td>
                    <td id={`logs-cell-msg-${i}`} className="logs-td logs-td-message" title={log.Msg ?? ""}>{log.Msg ?? "—"}</td>
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
  const safeLabel = label.replace(/[^a-zA-Z0-9_\-.]/g, "_");
  const byHost = new Map<string, ProcEntry[]>();
  for (const p of procs) {
    const h = p.host ?? p.txn.lastMsg.Hnm ?? "unknown";
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push(p);
  }

  return (
    <div id={`drilldown-panel-${safeLabel}`} className="drilldown-panel">
      {Array.from(byHost.entries()).map(([host, hostProcs]) => {
        const safeHost = host.replace(/[^a-zA-Z0-9_\-.]/g, "_");
        return (
          <div key={host} id={`drilldown-host-section-${safeHost}`} className="drilldown-host-section">
            <div id={`drilldown-host-header-${safeHost}`} className="drilldown-host-header">{host}</div>
            <DrillDownTable hostProcs={hostProcs} staleSecs={staleSecs} onKill={onKill} host={host} onProcDotClick={onProcDotClick} />
          </div>
        );
      })}
      {byHost.size === 0 && (
        <div id={`drilldown-empty-${safeLabel}`} className="drilldown-empty">
          No processes seen for <strong>{label}</strong> yet.
        </div>
      )}
      {procs.length > 0 && <LogsTable procs={procs} />}
    </div>
  );
}
