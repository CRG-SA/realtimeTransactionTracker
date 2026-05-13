import React from "react";
import type { ActiveTxn } from "../types";
import { clamp, colorForSeconds, human } from "../utils";
import { KV } from "./KV";

type PidEntry = { pid: number; txn: ActiveTxn & { durationMs: number } };

export const ProcessRow = React.memo(({ entry, thresholdSeconds }: {
  entry: PidEntry;
  thresholdSeconds: number;
}) => {
  const { pid, txn } = entry;
  const msg = txn.lastMsg;
  const sec = txn.durationMs / 1000;
  const baseRedSeconds = Math.max(thresholdSeconds + 1, 60);
  const color = colorForSeconds(sec, thresholdSeconds);
  const pct = (clamp(sec, 0, baseRedSeconds) / baseRedSeconds) * 100;
  const isEnded = !!txn.finalStatus;

  return (
    <div id={`proc-row-${pid}`} className="proc-row">
      <div
        id={`proc-progress-bar-${pid}`}
        className="txn-progress"
        style={{ background: `linear-gradient(90deg, ${color} ${pct}%, rgba(0,0,0,0.06) ${pct}%)` }}
      />
      <div id={`proc-body-${pid}`} className="txn-body">
        <div id={`proc-main-${pid}`} className="txn-main">
          <div id={`proc-header-row-${pid}`} className="txn-header-row">
            <div id={`proc-header-left-${pid}`} className="txn-header-left">
              <span id={`proc-pid-label-${pid}`} className="proc-pid">PID {pid}</span>
              <span id={`proc-duration-badge-${pid}`} className="txn-badge txn-badge-muted">
                {human(txn.durationMs)}
              </span>
              {msg.Status && (
                <span id={`proc-status-badge-${pid}`} className="txn-badge txn-badge-blue">
                  {msg.Status}
                </span>
              )}
              {msg.Mtp && (
                <span id={`proc-mtp-badge-${pid}`} className="txn-badge txn-badge-purple">
                  {msg.Mtp}
                </span>
              )}
              {isEnded && (
                <span
                  id={`proc-final-badge-${pid}`}
                  className={txn.finalStatus === "success" ? "txn-badge txn-badge-blue" : "txn-badge proc-badge-error"}
                >
                  {txn.finalStatus}
                </span>
              )}
            </div>
          </div>
          <div id={`proc-kv-grid-${pid}`} className="txn-grid">
            {msg.Eid && <KV k="Eid" v={msg.Eid} />}
            {msg.Fid && <KV k="Fid" v={msg.Fid} />}
            {msg.Key && <KV k="Key" v={msg.Key} />}
            {msg.Uid && <KV k="Uid" v={msg.Uid} />}
            {msg.Cid && <KV k="Cid" v={msg.Cid} />}
          </div>
          {msg.Msg && (
            <div id={`proc-message-${pid}`} className="txn-message">{msg.Msg}</div>
          )}
        </div>
        <div id={`proc-side-${pid}`} className="txn-side">
          <span id={`proc-health-label-${pid}`} className="txn-health" style={{ color }}>
            {sec >= baseRedSeconds ? "Critical" : sec >= thresholdSeconds ? "Degrading" : "OK"}
          </span>
        </div>
      </div>
    </div>
  );
});

ProcessRow.displayName = "ProcessRow";
