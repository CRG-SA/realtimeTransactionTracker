import type { ActiveTxn } from "../types";
import { colorForSeconds, human } from "../utils";
import { KV } from "./KV";
import { TxnRow } from "./TxnRow";

type TxnWithDuration = ActiveTxn & { durationMs: number };

export function BidGroupRow({
  bid,
  txns,
  longestDurationMs,
  thresholdSeconds,
  isExpanded,
  onToggleExpand,
  expandedTid,
  onToggleTid,
  onRemoveTid,
  onHide,
  hideProgress = false,
}: {
  bid: string;
  txns: TxnWithDuration[];
  longestDurationMs: number;
  thresholdSeconds: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  expandedTid: string | null;
  onToggleTid: (tid: string) => void;
  onRemoveTid: (tid: string) => void;
  onHide: (bid: string) => void;
  hideProgress?: boolean;
}) {
  const isNoBid = bid === "\x00no-bid";
  const safeBid = bid.replace(/\x00/g, "no-bid").replace(/[^a-zA-Z0-9_\-.]/g, "_");
  const sec = longestDurationMs / 1000;
  const color = colorForSeconds(sec, thresholdSeconds);
  const baseRedSeconds = Math.max(thresholdSeconds + 1, 60);
  const pct = (Math.min(sec, baseRedSeconds) / baseRedSeconds) * 100;

  const latest = txns.reduce((a, b) => b.lastUpdateAt > a.lastUpdateAt ? b : a, txns[0]);
  const lm = latest?.lastMsg;

  const statusCounts = new Map<string, number>();
  for (const t of txns) {
    const s = t.lastMsg.Status || "?";
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }

  const countStyle = (() => {
    const n = txns.length;
    if (n <= 5) return {};
    const t = Math.min((n - 5) / (20 - 5), 1);
    const r = Math.round(187 + (252 - 187) * t);
    const g = Math.round(247 + (165 - 247) * t);
    const b = Math.round(208 + (165 - 208) * t);
    return { background: `rgb(${r},${g},${b})`, color: "#374151", borderColor: "transparent" };
  })();

  return (
    <div id={`bid-card-${safeBid}`} className="bid-group card" onClick={onToggleExpand} style={{ cursor: "pointer" }}>
      {!isExpanded && !hideProgress && (
        <div
          id={`bid-progress-bar-${safeBid}`}
          className="txn-progress"
          style={{ background: `linear-gradient(90deg, ${color} ${pct}%, rgba(0,0,0,0.06) ${pct}%)` }}
        />
      )}
      <div id={`bid-header-${safeBid}`} className="bid-group-header">
        <div id={`bid-header-left-${safeBid}`} className="bid-group-header-left">
          <span id={`bid-label-${safeBid}`} className="bid-group-label">
            {isNoBid ? "— no BID —" : `BID: ${bid}`}
          </span>
          <span id={`bid-count-badge-${safeBid}`} className="bid-group-count" style={countStyle}>
            {txns.length} TID{txns.length !== 1 ? "s" : ""}
          </span>
          {!hideProgress && (
            <span id={`bid-duration-badge-${safeBid}`} className="bid-group-duration" style={{ color }}>
              {human(longestDurationMs)}
            </span>
          )}
          {Array.from(statusCounts.entries()).map(([s, n]) => (
            <span
              key={s}
              id={`bid-status-badge-${safeBid}-${s}`}
              className={`txn-badge ${s === "COREDUMP" ? "txn-badge-red" : "txn-badge-blue"}`}
            >
              {s}{n > 1 ? ` ×${n}` : ""}
            </span>
          ))}
        </div>
        <span id={`bid-expand-arrow-${safeBid}`} className="expand-indicator">
          {isExpanded ? "▲" : "▼"}
        </span>
      </div>

      {!isExpanded && (
        <div id={`bid-summary-body-${safeBid}`} className="txn-body">
          <div id={`bid-summary-main-${safeBid}`} className="txn-main">
            <div id={`bid-summary-kv-grid-${safeBid}`} className="txn-grid">
              {lm.Uid && <KV k="Uid" v={lm.Uid} />}
              {lm.Hnm && <KV k="Host" v={lm.Hnm} />}
              {lm.Eid && <KV k="Eid" v={lm.Eid} />}
              {lm.Fid && <KV k="Fid" v={lm.Fid} />}
              {lm.Cid && <KV k="Cid" v={lm.Cid} />}
              {lm.Pid !== undefined && lm.Pid > 0 && <KV k="Pid" v={String(lm.Pid)} />}
            </div>
          </div>
          <div id={`bid-summary-side-${safeBid}`} className="txn-side" onClick={(e) => e.stopPropagation()}>
            <button
              id={`bid-hide-button-${safeBid}`}
              className="btn-icon"
              title="Hide this BID"
              onClick={() => onHide(bid)}
            >✕</button>
          </div>
        </div>
      )}

      {isExpanded && (
        <div id={`bid-children-${safeBid}`} className="bid-group-children" onClick={(e) => e.stopPropagation()}>
          {txns.map((t) => (
            <TxnRow
              key={t.tid}
              txn={t}
              thresholdSeconds={thresholdSeconds}
              onRemove={() => onRemoveTid(t.tid)}
              isExpanded={expandedTid === t.tid}
              onToggleExpand={() => onToggleTid(t.tid)}
              highLoad={txns.length > 5}
              hideProgress={hideProgress}
            />
          ))}
        </div>
      )}
    </div>
  );
}
