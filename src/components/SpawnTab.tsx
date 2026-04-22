import React from "react";
import type { ActiveTxn } from "../types";
import { BidGroupRow } from "./BidGroupRow";
import { EmptyState } from "./EmptyState";

type TxnWithDuration = ActiveTxn & { durationMs: number };
type StatusFilter = "STARTUP" | "DIED" | "COREDUMP" | null;

const STATUS_META: { key: StatusFilter & string; label: string; activeColor: string }[] = [
  { key: "STARTUP", label: "Startup", activeColor: "#22c55e" },
  { key: "DIED",    label: "Died",    activeColor: "#f97316" },
  { key: "COREDUMP",label: "Coredump",activeColor: "#ef4444" },
];

export const SpawnTab = React.memo(({
  actives,
  thresholdSeconds,
  expandedTid,
  onToggleTid,
  onRemoveTid,
}: {
  actives: Map<string, ActiveTxn>;
  thresholdSeconds: number;
  expandedTid: string | null;
  onToggleTid: (tid: string) => void;
  onRemoveTid: (tid: string) => void;
}) => {
  const now = Date.now();
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>(null);
  const [expandedBids, setExpandedBids] = React.useState<Set<string>>(new Set());

  const spawnTxns: TxnWithDuration[] = Array.from(actives.values())
    .map((t) => ({
      ...t,
      durationMs: (t.endAt ?? now) - t.firstSeenAt,
    }))
    .sort((a, b) => b.lastUpdateAt - a.lastUpdateAt);

  const statusCounts = {
    STARTUP:  spawnTxns.filter((t) => t.lastMsg.Status === "STARTUP").length,
    DIED:     spawnTxns.filter((t) => t.lastMsg.Status === "DIED").length,
    COREDUMP: spawnTxns.filter((t) => t.lastMsg.Status === "COREDUMP").length,
  };

  const filteredTxns = statusFilter
    ? spawnTxns.filter((t) => t.lastMsg.Status === statusFilter)
    : spawnTxns;

  // Group by Bid
  const groupMap = new Map<string, TxnWithDuration[]>();
  for (const t of filteredTxns) {
    const bid = t.lastMsg.Bid ?? "\x00no-bid";
    const arr = groupMap.get(bid);
    if (arr) arr.push(t);
    else groupMap.set(bid, [t]);
  }

  const bidGroups = Array.from(groupMap.entries())
    .map(([bid, txns]) => ({
      bid,
      txns,
      longestDurationMs: Math.max(...txns.map((t) => t.durationMs)),
    }))
    .sort((a, b) => b.longestDurationMs - a.longestDurationMs);

  const toggleFilter = (key: StatusFilter & string) => {
    setStatusFilter((prev) => prev === key ? null : key);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div id="spawn-stats-card" className="card" style={{ marginBottom: 8, padding: "6px 10px" }}>
        <div id="spawn-stats-row" style={{ display: "flex", gap: 8, alignItems: "stretch" }}>

          {STATUS_META.map(({ key, label, activeColor }) => {
            const count = statusCounts[key];
            const isActive = statusFilter === key;
            return (
              <button
                key={key}
                id={`spawn-filter-btn-${key.toLowerCase()}`}
                onClick={() => toggleFilter(key)}
                style={{
                  flex: 1,
                  border: `1.5px solid ${isActive ? activeColor : "var(--border-card)"}`,
                  borderRadius: 8,
                  padding: "5px 12px",
                  background: isActive ? `${activeColor}18` : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div
                  id={`spawn-filter-label-${key.toLowerCase()}`}
                  style={{ fontSize: 11, color: isActive ? activeColor : "var(--text-muted)", fontWeight: isActive ? 600 : 400 }}
                >
                  {label}
                </div>
                <div
                  id={`spawn-filter-count-${key.toLowerCase()}`}
                  style={{ fontSize: 16, fontWeight: 600, color: isActive ? activeColor : "var(--text-primary)" }}
                >
                  {count}
                </div>
              </button>
            );
          })}

        </div>
      </div>

      <div id="spawn-txn-list" className="txn-list" style={{ flex: 1, overflowY: "auto" }}>
        {bidGroups.length === 0 ? (
          <EmptyState />
        ) : (
          bidGroups.map((g) => (
            <BidGroupRow
              key={g.bid}
              bid={g.bid}
              txns={g.txns}
              longestDurationMs={g.longestDurationMs}
              thresholdSeconds={thresholdSeconds}
              isExpanded={expandedBids.has(g.bid)}
              onToggleExpand={() => setExpandedBids((prev) => {
                const next = new Set(prev);
                next.has(g.bid) ? next.delete(g.bid) : next.add(g.bid);
                return next;
              })}
              expandedTid={expandedTid}
              onToggleTid={onToggleTid}
              onRemoveTid={onRemoveTid}
              onHide={() => {}}
              hideProgress
            />
          ))
        )}
      </div>
    </div>
  );
});

SpawnTab.displayName = "SpawnTab";
