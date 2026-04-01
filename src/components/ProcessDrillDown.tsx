import { useEffect, useRef, useState } from "react";
import type { ActiveTxn } from "../types";
import { human } from "../utils";

type ProcEntry = { pid: number; txn: ActiveTxn & { durationMs: number }; host?: string };

const BUSY_LINGER_MS = 500;

const DEFAULT_WIDTHS = [22, 52, 50, 180, 70, 80, 80, 80, 80, 60, 260];
const COLS = ["", "Status", "PID", "Tid", "Status", "Mtp", "Fid", "Uid", "Seen", "Dur", "Msg"];

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

function ProcRow({ pid, txn, staleSecs }: { pid: number; txn: ActiveTxn & { durationMs: number }; staleSecs: number }) {
  const STALE_MS = staleSecs * 1000;
  const rawBusy = !txn.finalStatus;
  const [busy, setBusy] = useState(rawBusy);
  const [stale, setStale] = useState(() => Date.now() - txn.lastUpdateAt > STALE_MS);
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
    setStale(Date.now() - txn.lastUpdateAt > STALE_MS);
  }, [txn.lastUpdateAt, staleSecs]);

  useEffect(() => {
    const id = setInterval(() => setStale(Date.now() - txn.lastUpdateAt > STALE_MS), 10_000);
    return () => clearInterval(id);
  }, [txn.lastUpdateAt, staleSecs]);

  const dotClass = stale ? "dot-stale" : busy ? "dot-busy" : "dot-idle";
  const statusLabel = stale ? "stale" : busy ? "busy" : "idle";
  const statusClass = stale ? "status-stale" : busy ? "status-busy" : "status-idle";
  const firstSeen = new Date(txn.firstSeenAt).toLocaleTimeString();
  const dur = human(txn.durationMs);

  return (
    <tr className="dd-tr">
      <td className="dd-td dd-td-dot"><div className={`server-proc-dot ${dotClass}`} /></td>
      <td className="dd-td" title={statusLabel}><span className={statusClass}>{statusLabel}</span></td>
      <td className="dd-td" title={String(pid)}>{pid}</td>
      <td className="dd-td dd-mono" title={msg.Tid ?? ""}>{msg.Tid ?? "—"}</td>
      <td className="dd-td" title={msg.Status ?? ""}>{msg.Status ?? "—"}</td>
      <td className="dd-td" title={msg.Mtp ?? ""}>{msg.Mtp ?? "—"}</td>
      <td className="dd-td" title={msg.Fid ?? ""}>{msg.Fid ?? "—"}</td>
      <td className="dd-td" title={msg.Uid ?? ""}>{msg.Uid ?? "—"}</td>
      <td className="dd-td" title={firstSeen}>{firstSeen}</td>
      <td className="dd-td" title={dur}>{dur}</td>
      <td className="dd-td dd-msg" title={msg.Msg ?? ""}>{msg.Msg ?? ""}</td>
    </tr>
  );
}

function DrillDownTable({ hostProcs, staleSecs }: { hostProcs: ProcEntry[]; staleSecs: number }) {
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
        {hostProcs.map(({ pid, txn }) => (
          <ProcRow key={pid} pid={pid} txn={txn} staleSecs={staleSecs} />
        ))}
      </tbody>
    </table>
  );
}

export function ProcessDrillDown({ label, procs, staleSecs }: { label: string; procs: ProcEntry[]; staleSecs: number }) {
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
          <DrillDownTable hostProcs={hostProcs} staleSecs={staleSecs} />
        </div>
      ))}
      {byHost.size === 0 && (
        <div className="drilldown-empty">No processes seen for <strong>{label}</strong> yet.</div>
      )}
    </div>
  );
}
