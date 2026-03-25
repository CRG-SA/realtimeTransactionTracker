import React from "react";
import { ActiveTxn } from "../types";
import { clamp, colorForSeconds, colorForSecondsHighLoad, human } from "../utils";
import { KV } from "./KV";

export const TxnRow = React.memo(({
  txn,
  thresholdSeconds,
  onRemove,
  isExpanded,
  onToggleExpand,
  highLoad = false,
}: {
  txn: ActiveTxn & { durationMs: number };
  thresholdSeconds: number;
  onRemove: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  highLoad?: boolean;
}) => {
  const sec = txn.durationMs / 1000;
  const color = highLoad
    ? colorForSecondsHighLoad(sec, thresholdSeconds)
    : colorForSeconds(sec, thresholdSeconds);
  const baseRedSeconds = Math.max(thresholdSeconds + 1, 60);
  const capped = clamp(sec, 0, baseRedSeconds);
  const pct = (capped / baseRedSeconds) * 100;
  const msg = txn.lastMsg;

  let healthLabel = "OK";
  if (sec >= baseRedSeconds) healthLabel = "Critical";
  else if (sec >= thresholdSeconds) healthLabel = "Degrading";

  return (
    <div className="card txn-card">
      <div
        className="txn-progress"
        style={{ background: `linear-gradient(90deg, ${color} ${pct}%, rgba(0,0,0,0.06) ${pct}%)` }}
      />
      <div className="txn-body" onClick={onToggleExpand}>
        <div className="txn-main">
          <div className="txn-header-row txn-clickable">
            <div className="txn-header-left">
              <span className="txn-tid" title={txn.tid}>TID: {txn.tid}</span>
              <span className="txn-badge txn-badge-muted">{human(txn.durationMs)}</span>
              {msg.Status && <span className="txn-badge txn-badge-blue">{msg.Status}</span>}
              {msg.Mtp && <span className="txn-badge txn-badge-purple">{msg.Mtp}</span>}
            </div>
            {msg.Bid && (
              <span className="txn-bid" title={msg.Bid}>BID: {msg.Bid}</span>
            )}
            <span className="expand-indicator">{isExpanded ? "▲" : "▼"}</span>
          </div>

          <div className="txn-grid">
            {msg.Eid && <KV k="Eid" v={msg.Eid} />}
            {msg.Fid && <KV k="Fid" v={msg.Fid} />}
            {msg.Uid && <KV k="Uid" v={msg.Uid} />}
            {msg.Cid && <KV k="Cid" v={msg.Cid} />}
            {msg.Hnm && <KV k="Host" v={msg.Hnm} />}
            {msg.Pid !== undefined && msg.Pid > 0 && <KV k="Pid" v={String(msg.Pid)} />}
          </div>

          {msg.Msg && (
            <div className="txn-message" title={msg.Msg}>
              {msg.Msg}
              {txn.messages && txn.messages.length > 1 && (
                <span className="txn-msg-count">{txn.messages.length}</span>
              )}
            </div>
          )}

          {isExpanded && txn.messages && txn.messages.length > 0 && (
            <div className="txn-history">
              {txn.messages.map((m, idx) => (
                <div key={idx} className="txn-history-row">
                  <span className="txn-history-time">{m.Uxt || ""}</span>
                  {m.Status && <span className="txn-history-status">{m.Status}</span>}
                  {m.Mtp && <span className="txn-history-mtp">{m.Mtp}</span>}
                  {m.Msg && <span className="txn-history-msg" title={m.Msg}>{m.Msg}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="txn-side">
          <span className="txn-health" style={{ color }}>{healthLabel}</span>
          <button
            className="btn-icon"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="Remove transaction"
          >✕</button>
        </div>
      </div>
    </div>
  );
});
