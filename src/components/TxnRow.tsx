import React from "react";
import type { ActiveTxn } from "../types";
import { clamp, colorForSeconds, colorForSecondsHighLoad, human } from "../utils";
import { KV } from "./KV";

export const TxnRow = React.memo(({
  txn,
  thresholdSeconds,
  onRemove,
  isExpanded,
  onToggleExpand,
  highLoad = false,
  hideProgress = false,
}: {
  txn: ActiveTxn & { durationMs: number };
  thresholdSeconds: number;
  onRemove: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  highLoad?: boolean;
  hideProgress?: boolean;
}) => {
  const [msgOpen, setMsgOpen] = React.useState(false);
  const [expandedMsgRows, setExpandedMsgRows] = React.useState<Set<number>>(new Set());

  const toggleMsgRow = (idx: number) => {
    if (window.getSelection()?.toString()) return;
    setExpandedMsgRows((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };
  const sec = txn.durationMs / 1000;
  const color = highLoad
    ? colorForSecondsHighLoad(sec, thresholdSeconds)
    : colorForSeconds(sec, thresholdSeconds);
  const baseRedSeconds = Math.max(thresholdSeconds + 1, 60);
  const capped = clamp(sec, 0, baseRedSeconds);
  const pct = (capped / baseRedSeconds) * 100;
  const msg = txn.lastMsg;
  const tid = txn.tid;

  let healthLabel = "OK";
  if (sec >= baseRedSeconds) healthLabel = "Critical";
  else if (sec >= thresholdSeconds) healthLabel = "Degrading";

  return (
    <div id={`txn-card-${tid}`} className="card txn-card">
      {!hideProgress && (
        <div
          id={`txn-progress-bar-${tid}`}
          className="txn-progress"
          style={{ background: `linear-gradient(90deg, ${color} ${pct}%, rgba(0,0,0,0.06) ${pct}%)` }}
        />
      )}
      <div id={`txn-body-${tid}`} className="txn-body" onClick={onToggleExpand}>
        <div id={`txn-main-${tid}`} className="txn-main">
          <div id={`txn-header-row-${tid}`} className="txn-header-row txn-clickable">
            <div id={`txn-header-left-${tid}`} className="txn-header-left">
              <span id={`txn-tid-label-${tid}`} className="txn-tid" title={tid}>TID: {tid}</span>
              {!hideProgress && (
                <span id={`txn-duration-badge-${tid}`} className="txn-badge txn-badge-muted">
                  {human(txn.durationMs)}
                </span>
              )}
              {msg.Status && (
                <span
                  id={`txn-status-badge-${tid}`}
                  className={`txn-badge ${msg.Status === "COREDUMP" ? "txn-badge-red" : "txn-badge-blue"}`}
                >
                  {msg.Status}
                </span>
              )}
              {msg.Mtp && (
                <span id={`txn-mtp-badge-${tid}`} className="txn-badge txn-badge-purple">
                  {msg.Mtp}
                </span>
              )}
            </div>
            {msg.Bid && (
              <span id={`txn-bid-label-${tid}`} className="txn-bid" title={msg.Bid}>
                BID: {msg.Bid}
              </span>
            )}
            <span id={`txn-expand-arrow-${tid}`} className="expand-indicator">
              {isExpanded ? "▲" : "▼"}
            </span>
          </div>

          <div id={`txn-kv-grid-${tid}`} className="txn-grid">
            {msg.Eid && <KV k="Eid" v={msg.Eid} />}
            {msg.Fid && <KV k="Fid" v={msg.Fid} />}
            {msg.Uid && <KV k="Uid" v={msg.Uid} />}
            {msg.Cid && <KV k="Cid" v={msg.Cid} />}
            {msg.Hnm && <KV k="Host" v={msg.Hnm} />}
            {msg.Pid !== undefined && msg.Pid > 0 && <KV k="Pid" v={String(msg.Pid)} />}
          </div>

          {msg.Msg && (
            <div id={`txn-msg-wrapper-${tid}`} style={{ display: "flex", alignItems: "flex-start", gap: 4, marginTop: 6 }}>
              <button
                id={`txn-eye-button-${tid}`}
                className="btn-icon"
                title="View message"
                onClick={(e) => { e.stopPropagation(); setMsgOpen((v) => !v); }}
                style={{ fontSize: 11, padding: "1px 5px", opacity: msgOpen ? 1 : 0.5, flexShrink: 0, marginTop: 1 }}
              >👁</button>
              <div id={`txn-message-text-${tid}`} className="txn-message" title={msg.Msg} style={{ marginTop: 0, flex: 1 }}>
                {msg.Msg}
                {txn.messages && txn.messages.length > 1 && (
                  <span id={`txn-message-count-${tid}`} className="txn-msg-count">
                    {txn.messages.length}
                  </span>
                )}
              </div>
            </div>
          )}

          {msgOpen && msg.Msg && (
            <div id={`txn-msg-normalized-${tid}`} className="txn-msg-normalized" onClick={(e) => e.stopPropagation()}>
              {msg.Msg.split(/\\n/).map((line, i) => (
                <div key={i} id={`txn-norm-line-${tid}-${i}`} className="txn-msg-normalized-line">{line}</div>
              ))}
            </div>
          )}

          {(isExpanded || msgOpen) && txn.messages && txn.messages.length > 0 && (
            <div id={`txn-history-panel-${tid}`} className="txn-history" onClick={(e) => e.stopPropagation()}>
              <table id={`txn-history-table-${tid}`} className="txn-history-table">
                <thead>
                  <tr id={`txn-history-thead-row-${tid}`}>
                    <th className="txn-history-th txn-history-th-time">Time</th>
                    <th className="txn-history-th txn-history-th-severity">Severity</th>
                    <th className="txn-history-th txn-history-th-status">Status</th>
                    <th className="txn-history-th txn-history-th-mtp">Mtp</th>
                    <th className="txn-history-th txn-history-th-fid">Fid</th>
                    <th className="txn-history-th txn-history-th-uid">Uid</th>
                    <th className="txn-history-th txn-history-th-ret">Ret</th>
                    <th className="txn-history-th txn-history-th-message">Message</th>
                  </tr>
                </thead>
                <tbody id={`txn-history-tbody-${tid}`}>
                  {txn.messages.map((m, idx) => (
                    <tr
                      key={idx}
                      id={`txn-history-row-${tid}-${idx}`}
                      className="txn-history-row"
                      style={(msgOpen || expandedMsgRows.has(idx)) ? { verticalAlign: "top" } : undefined}
                    >
                      <td id={`txn-hcell-time-${tid}-${idx}`} className="txn-history-td txn-history-td-time">{m.Uxt || "—"}</td>
                      <td id={`txn-hcell-severity-${tid}-${idx}`} className="txn-history-td txn-history-td-severity">{m.Severity || "—"}</td>
                      <td id={`txn-hcell-status-${tid}-${idx}`} className="txn-history-td txn-history-td-status">{m.Status || "—"}</td>
                      <td id={`txn-hcell-mtp-${tid}-${idx}`} className="txn-history-td txn-history-td-mtp">{m.Mtp || "—"}</td>
                      <td id={`txn-hcell-fid-${tid}-${idx}`} className="txn-history-td txn-history-td-fid" title={m.Fid || ""}>{m.Fid || "—"}</td>
                      <td id={`txn-hcell-uid-${tid}-${idx}`} className="txn-history-td txn-history-td-uid" title={m.Uid || ""}>{m.Uid || "—"}</td>
                      <td id={`txn-hcell-ret-${tid}-${idx}`} className="txn-history-td txn-history-td-ret">{m.Ret !== undefined ? m.Ret : "—"}</td>
                      <td
                        id={`txn-hcell-message-${tid}-${idx}`}
                        className="txn-history-td txn-history-td-message"
                        title={m.Msg || ""}
                        style={{ cursor: m.Msg ? "pointer" : undefined }}
                        onClick={() => m.Msg && toggleMsgRow(idx)}
                      >
                        {(msgOpen || expandedMsgRows.has(idx)) && m.Msg
                          ? m.Msg.split(/\\n/).map((line, i) => (
                              <div key={i} style={{ whiteSpace: "pre-wrap" }}>{line}</div>
                            ))
                          : (m.Msg || "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div id={`txn-side-panel-${tid}`} className="txn-side">
          {!hideProgress && (
            <span id={`txn-health-label-${tid}`} className="txn-health" style={{ color }}>
              {healthLabel}
            </span>
          )}
          <button
            id={`txn-remove-button-${tid}`}
            className="btn-icon"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="Remove transaction"
          >✕</button>
        </div>
      </div>
    </div>
  );
});

TxnRow.displayName = "TxnRow";
