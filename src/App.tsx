import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { ActiveTxn, ServerStats, WireMsg } from "./types";
import { buildWsUrl, human, readRuntimeConfig } from "./utils";
import { BidGroupRow } from "./components/BidGroupRow";
import { EmptyState } from "./components/EmptyState";
import { StatsOverlay } from "./components/StatsOverlay";
import { SummaryItem } from "./components/SummaryItem";
import { TxnRow } from "./components/TxnRow";

export default function App() {
  const [wsUrl, setWsUrl] = useState<string>("");
  const [connected, setConnected] = useState<"connecting" | "open" | "closed">("connecting");
  const [isPaused, setIsPaused] = useState(false);
  const [actives, setActives] = useState<Map<string, ActiveTxn>>(new Map());
  const [autoRemoveOnEnd, setAutoRemoveOnEnd] = useState(true);
  const [thresholdSeconds, setThresholdSeconds] = useState<number>(1);
  const [lingerSeconds, setLingerSeconds] = useState<number>(0);
  const [filter, setFilter] = useState<string>("");
  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [tps, setTps] = useState<number>(0);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [groupBy, setGroupBy] = useState<"tid" | "bid">("tid");
  const [expandedBids, setExpandedBids] = useState<Set<string>>(new Set());
  const [excludedBids, setExcludedBids] = useState<Set<string>>(new Set());

  const isPausedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsUrlRef = useRef<string>("");
  const retryRef = useRef<{ attempts: number; timer: any }>({ attempts: 0, timer: 0 });
  const messageTimesRef = useRef<number[]>([]);
  const incomingQueueRef = useRef<WireMsg[]>([]);
  const masterActivesRef = useRef<Map<string, ActiveTxn>>(new Map());

  // Sync isPausedRef and flush render on unpause
  useEffect(() => {
    isPausedRef.current = isPaused;
    if (!isPaused) {
      setActives(new Map(masterActivesRef.current));
    }
  }, [isPaused]);

  // Keep wsUrlRef in sync so connect() always sees the latest URL
  useEffect(() => {
    wsUrlRef.current = wsUrl;
  }, [wsUrl]);

  // Load runtime config
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await readRuntimeConfig();
      if (cancelled) return;
      setWsUrl(buildWsUrl(cfg));
    })();
    return () => { cancelled = true; };
  }, []);

  function connect() {
    if (!wsUrlRef.current) return;
    cleanupSocket();
    setConnected("connecting");
    try {
      const ws = new WebSocket(wsUrlRef.current);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected("open");
        retryRef.current.attempts = 0;
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(typeof evt.data === "string" ? evt.data : String(evt.data));
          if (!data) return;

          const now = Date.now();
          const queue = incomingQueueRef.current;
          const times = messageTimesRef.current;
          const msgs = Array.isArray(data) ? data : [data];

          for (const obj of msgs) {
            if (obj && obj._type === "stats") {
              setServerStats(obj as ServerStats);
            } else if (obj && obj.Tid) {
              queue.push(obj);
              times.push(now);
            }
          }
        } catch (e) {
          console.warn("Failed to parse message", e);
        }
      };

      ws.onclose = () => {
        setConnected("closed");
        scheduleReconnect();
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* ignore */ }
      };
    } catch {
      setConnected("closed");
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    const attempts = ++retryRef.current.attempts;
    const delay = Math.min(5000, 250 * Math.pow(2, attempts));
    clearTimeout(retryRef.current.timer);
    retryRef.current.timer = setTimeout(connect, delay);
  }

  function cleanupSocket() {
    clearTimeout(retryRef.current.timer);
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(); } catch { /* ignore */ }
    }
    wsRef.current = null;
  }

  useEffect(() => {
    if (!wsUrl) return;
    connect();
    return () => cleanupSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // Tick: process batches, auto-remove, TPS
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const m = masterActivesRef.current;

      const batch = incomingQueueRef.current;
      incomingQueueRef.current = [];

      let changed = batch.length > 0;
      for (const obj of batch) {
        const tid = obj.Tid;
        const status = (obj.Status || "").toLowerCase();
        const existing = m.get(tid);

        if (!existing) {
          const txn: ActiveTxn = {
            tid,
            firstSeenAt: now,
            lastUpdateAt: now,
            lastMsg: obj,
            messages: [obj],
          };
          if (status === "success" || status === "failed" || status === "error" || status === "failure") {
            txn.endAt = now;
            txn.finalStatus = status;
          }
          m.set(tid, txn);
        } else {
          existing.lastUpdateAt = now;
          existing.lastMsg = obj;
          const msgs = existing.messages || [];
          msgs.push(obj);
          const MAX_HISTORY = 100;
          if (msgs.length > MAX_HISTORY) msgs.shift();
          existing.messages = msgs;

          if (status === "success" || status === "failed" || status === "error" || status === "failure") {
            if (!existing.endAt) existing.endAt = now;
            existing.finalStatus = status;
          }
          m.set(tid, existing);
        }
      }

      for (const [tid, txn] of m) {
        if (
          autoRemoveOnEnd &&
          !!txn.endAt &&
          lingerSeconds >= 0 &&
          now - txn.endAt! > lingerSeconds * 1000
        ) {
          m.delete(tid);
          changed = true;
        }
      }

      if (changed && !isPausedRef.current) {
        setActives(new Map(m));
      }

      setTps(() => {
        const windowMs = 10_000;
        const arr = messageTimesRef.current;
        const cutoff = now - windowMs;
        while (arr.length && arr[0] < cutoff) arr.shift();
        return arr.length / (windowMs / 1000);
      });
    }, 200);

    return () => clearInterval(id);
  }, [autoRemoveOnEnd, lingerSeconds]);

  function removeTid(tid: string) {
    setActives(() => {
      const m = masterActivesRef.current;
      m.delete(tid);
      return new Map(m);
    });
    if (expandedTid === tid) setExpandedTid(null);
  }

  function clearAll() {
    masterActivesRef.current.clear();
    setActives(new Map());
    setExpandedTid(null);
  }

  const activeList = useMemo(() => {
    const now = Date.now();
    const thresholdMs = thresholdSeconds * 1000;
    const filterText = filter.trim().toLowerCase();

    let list = Array.from(actives.values()).map((t) => ({
      ...t,
      durationMs: (t.endAt ?? now) - t.firstSeenAt,
    }));

    if (thresholdMs > 0) {
      list = list.filter((t) => t.durationMs >= thresholdMs);
    }

    if (filterText) {
      list = list.filter((t) => {
        const msg = t.lastMsg;
        const fields: Array<string | number | undefined> = [
          t.tid, msg.Eid, msg.Fid, msg.Cid, msg.Uid,
          msg.Hnm, msg.Status, msg.Mtp, msg.Msg, msg.Severity,
        ];
        return fields.some((v) => v && v.toString().toLowerCase().includes(filterText));
      });
    }

    list.sort((a, b) => b.durationMs - a.durationMs);
    return list;
  }, [actives, thresholdSeconds, filter]);

  const bidGroups = useMemo(() => {
    if (groupBy !== "bid") return [];
    const groups = new Map<string, typeof activeList>();
    for (const txn of activeList) {
      const bid = txn.lastMsg.Bid ?? "\x00no-bid";
      if (!groups.has(bid)) groups.set(bid, []);
      groups.get(bid)!.push(txn);
    }
    return Array.from(groups.entries())
      .filter(([bid]) => !excludedBids.has(bid))
      .map(([bid, txns]) => ({
        bid,
        txns,
        longestDurationMs: Math.max(...txns.map((t) => t.durationMs)),
      }))
      .sort((a, b) => b.longestDurationMs - a.longestDurationMs);
  }, [activeList, groupBy, excludedBids]);

  const longest = activeList[0];

  return (
    <div className="app-root">
      <div className="app-container">

        <div className="app-header">
          <section className="card card-summary">
            <div className="header-left">
              <h1 className="app-title">Realtime Transaction Monitor</h1>
            </div>
            <div className="header-right">
              <div className={`ws-connection-pill ${connected === "open" ? "ws-ok" : connected === "connecting" ? "ws-warn" : "ws-bad"}`}>
                {wsUrl || "WebSocket..."}
              </div>

              <input
                className="input"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter (TID, Eid, Msg...)"
                title="Filter transactions"
              />

              <button
                onClick={() => setIsPaused((p) => !p)}
                className={`btn ${isPaused ? "btn-secondary btn-paused" : "btn-secondary"}`}
              >
                {isPaused ? "▶ Resume" : "⏸ Pause"}
              </button>

              <div className="capsule-toggle">
                <button
                  className={`capsule-btn${groupBy === "tid" ? " capsule-active" : ""}`}
                  onClick={() => setGroupBy("tid")}
                >TID</button>
                <button
                  className={`capsule-btn${groupBy === "bid" ? " capsule-active" : ""}`}
                  onClick={() => setGroupBy("bid")}
                >BID</button>
              </div>

              <button onClick={clearAll} className="btn btn-danger">
                🗑 Clear All
              </button>
            </div>
          </section>

          <section className="card card-summary">
            <div className="summary-grid">
              <SummaryItem label="Active" value={String(activeList.length)} />
              <SummaryItem label="Tx/s (last 10s)" value={tps.toFixed(1)} />
              <SummaryItem label="Longest" value={longest ? human(longest.durationMs) : "—"} />
              <SummaryItem
                label="Show if ≥"
                value={`${thresholdSeconds}s`}
                onMinus={() => setThresholdSeconds(Math.max(0, thresholdSeconds - 1))}
                onPlus={() => setThresholdSeconds(thresholdSeconds + 1)}
              />
              <SummaryItem
                label="Auto-remove (linger)"
                value={autoRemoveOnEnd ? `${lingerSeconds}s` : "Disabled"}
                onMinus={autoRemoveOnEnd ? () => setLingerSeconds(Math.max(0, lingerSeconds - 1)) : undefined}
                onPlus={autoRemoveOnEnd ? () => setLingerSeconds(lingerSeconds + 1) : undefined}
                toggle={() => setAutoRemoveOnEnd(!autoRemoveOnEnd)}
              />
              {excludedBids.size > 0 && (
                <div className="summary-item summary-item-right">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setExcludedBids(new Set())}
                    title="Show all hidden BIDs"
                  >
                    {excludedBids.size} hidden · Clear
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="txn-list">
          {activeList.length === 0 ? (
            <EmptyState />
          ) : groupBy === "bid" ? (
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
                onToggleTid={(tid: string) => setExpandedTid(expandedTid === tid ? null : tid)}
                onRemoveTid={removeTid}
                onHide={(bid: string) => setExcludedBids((prev) => new Set([...prev, bid]))}
              />
            ))
          ) : (
            activeList.map((t) => (
              <TxnRow
                key={t.tid}
                txn={t}
                thresholdSeconds={thresholdSeconds}
                onRemove={() => removeTid(t.tid)}
                isExpanded={expandedTid === t.tid}
                onToggleExpand={() => setExpandedTid(expandedTid === t.tid ? null : t.tid)}
              />
            ))
          )}
        </section>
      </div>

      {serverStats && <StatsOverlay stats={serverStats} />}
    </div>
  );
}
