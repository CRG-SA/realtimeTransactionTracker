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
    <div className="proc-row">
      <div
        className="txn-progress"
        style={{ background: `linear-gradient(90deg, ${color} ${pct}%, rgba(0,0,0,0.06) ${pct}%)` }}
      />
      <div className="txn-body">
        <div className="txn-main">
          <div className="txn-header-row">
            <div className="txn-header-left">
              <span className="proc-pid">PID {pid}</span>
              <span className="txn-badge txn-badge-muted">{human(txn.durationMs)}</span>
              {msg.Status && <span className="txn-badge txn-badge-blue">{msg.Status}</span>}
              {msg.Mtp && <span className="txn-badge txn-badge-purple">{msg.Mtp}</span>}
              {isEnded && (
                <span className={txn.finalStatus === "success" ? "txn-badge txn-badge-blue" : "txn-badge proc-badge-error"}>
                  {txn.finalStatus}
                </span>
              )}
            </div>
          </div>
          <div className="txn-grid">
            {msg.Eid && <KV k="Eid" v={msg.Eid} />}
            {msg.Fid && <KV k="Fid" v={msg.Fid} />}
            {msg.Uid && <KV k="Uid" v={msg.Uid} />}
            {msg.Cid && <KV k="Cid" v={msg.Cid} />}
          </div>
          {msg.Msg && <div className="txn-message">{msg.Msg}</div>}
        </div>
        <div className="txn-side">
          <span className="txn-health" style={{ color }}>
            {sec >= baseRedSeconds ? "Critical" : sec >= thresholdSeconds ? "Degrading" : "OK"}
          </span>
        </div>
      </div>
    </div>
  );
});
