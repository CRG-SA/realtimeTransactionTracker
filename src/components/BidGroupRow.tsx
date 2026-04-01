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
}) {
  const isNoBid = bid === "\x00no-bid";
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
    <div className="bid-group card" onClick={onToggleExpand} style={{ cursor: "pointer" }}>
      {!isExpanded && (
        <div
          className="txn-progress"
          style={{ background: `linear-gradient(90deg, ${color} ${pct}%, rgba(0,0,0,0.06) ${pct}%)` }}
        />
      )}
      <div className="bid-group-header">
        <div className="bid-group-header-left">
          <span className="bid-group-label">{isNoBid ? "— no BID —" : `BID: ${bid}`}</span>
          <span className="bid-group-count" style={countStyle}>
            {txns.length} TID{txns.length !== 1 ? "s" : ""}
          </span>
          <span className="bid-group-duration" style={{ color }}>{human(longestDurationMs)}</span>
          {Array.from(statusCounts.entries()).map(([s, n]) => (
            <span key={s} className="txn-badge txn-badge-blue">
              {s}{n > 1 ? ` ×${n}` : ""}
            </span>
          ))}
        </div>
        <span className="expand-indicator">{isExpanded ? "▲" : "▼"}</span>
      </div>

      {!isExpanded && (
        <div className="txn-body">
          <div className="txn-main">
            <div className="txn-grid">
              {lm.Uid && <KV k="Uid" v={lm.Uid} />}
              {lm.Hnm && <KV k="Host" v={lm.Hnm} />}
              {lm.Eid && <KV k="Eid" v={lm.Eid} />}
              {lm.Fid && <KV k="Fid" v={lm.Fid} />}
              {lm.Cid && <KV k="Cid" v={lm.Cid} />}
              {lm.Pid !== undefined && lm.Pid > 0 && <KV k="Pid" v={String(lm.Pid)} />}
            </div>
          </div>
          <div className="txn-side" onClick={(e) => e.stopPropagation()}>
            <button className="btn-icon" title="Hide this BID" onClick={() => onHide(bid)}>✕</button>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="bid-group-children" onClick={(e) => e.stopPropagation()}>
          {txns.map((t) => (
            <TxnRow
              key={t.tid}
              txn={t}
              thresholdSeconds={thresholdSeconds}
              onRemove={() => onRemoveTid(t.tid)}
              isExpanded={expandedTid === t.tid}
              onToggleExpand={() => onToggleTid(t.tid)}
              highLoad={txns.length > 5}
            />
          ))}
        </div>
      )}
    </div>
  );
}
