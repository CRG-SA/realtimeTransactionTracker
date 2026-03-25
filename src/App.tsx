import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";

// Types from your wire format
export type WireMsg = {
  Status: string;
  Uxd?: string;
  Uxt?: string;
  Eid?: string;
  Hnm?: string;
  Pid?: number;
  Fid?: string;
  Bid?: string;
  Tid: string;
  Cid?: string;
  Uid?: string;
  Mtp?: string;
  Ret?: number;
  Msg?: string;
  Elapsed?: number;
  Severity?: string;
};

export type ActiveTxn = {
  tid: string;
  firstSeenAt: number;
  lastUpdateAt: number;
  lastMsg: WireMsg;
  messages: WireMsg[];       // all messages for this TID
  endAt?: number;            // when Status became Success/Failed
  finalStatus?: string;      // "success" | "failed"
};

export type AppConfig = {
  wsPort: number;
};

export type ServerStats = {
  pkts_per_sec: number;
  rx_total: number;
  udp_drop_interval: number;
  udp_drop_total: number;
  ws_drop_total: number;
  q_size: number;
  clients: number;
};

const defaultConfig: AppConfig = {
  wsPort: 8765,
};

async function readRuntimeConfig(): Promise<AppConfig> {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) return defaultConfig;
    const cfg = await res.json();
    return { ...defaultConfig, ...cfg };
  } catch {
    return defaultConfig;
  }
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

function colorForSeconds(sec: number, thresholdSeconds: number): string {
  const safeThreshold = Math.max(0, thresholdSeconds || 0);
  const baseRedSeconds = Math.max(safeThreshold + 1, 60);
  const t = clamp((sec - safeThreshold) / (baseRedSeconds - safeThreshold), 0, 1);
  const g0 = { r: 22, g: 163, b: 74 }; // green-ish
  const g1 = { r: 220, g: 38, b: 38 }; // red-ish
  const r = Math.round(g0.r + (g1.r - g0.r) * t);
  const g = Math.round(g0.g + (g1.g - g0.g) * t);
  const b = Math.round(g0.b + (g1.b - g0.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function colorForSecondsHighLoad(sec: number, thresholdSeconds: number): string {
  const safeThreshold = Math.max(0, thresholdSeconds || 0);
  const baseRedSeconds = Math.max(safeThreshold + 1, 60);
  const t = clamp((sec - safeThreshold) / (baseRedSeconds - safeThreshold), 0, 1);
  const g0 = { r: 56, g: 189, b: 248 };  // sky blue
  const g1 = { r: 139, g: 92, b: 246 };  // violet
  const r = Math.round(g0.r + (g1.r - g0.r) * t);
  const g = Math.round(g0.g + (g1.g - g0.g) * t);
  const b = Math.round(g0.b + (g1.b - g0.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function human(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const mmm = ms % 1000;
  if (mm !== undefined) return `${mm}m ${ss}s`;
  return `${ss}.${String(Math.floor(mmm / 100)).padStart(1, "0")}s`;
}

function buildWsUrl(cfg: AppConfig): string {
  const loc = window.location;
  const isHttps = loc.protocol === "https:";
  const proto = isHttps ? "wss" : "ws";
  const host = loc.hostname || "localhost";
  const port = cfg.wsPort ?? 8765;
  return `${proto}://${host}:${port}`;
}

export default function App() {
  const [wsUrl, setWsUrl] = useState<string>("");
  const [connected, setConnected] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );
  const [isPaused, setIsPaused] = useState(false);
  const [actives, setActives] = useState<Map<string, ActiveTxn>>(new Map());
  const [autoRemoveOnEnd, setAutoRemoveOnEnd] = useState(true);
  const [thresholdSeconds, setThresholdSeconds] = useState<number>(1); // "Show if ≥"
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
  const retryRef = useRef<{ attempts: number; timer: any }>({
    attempts: 0,
    timer: 0,
  });
  const messageTimesRef = useRef<number[]>([]); // timestamps of messages for TPS
  const incomingQueueRef = useRef<WireMsg[]>([]); // buffer for batching
  const masterActivesRef = useRef<Map<string, ActiveTxn>>(new Map()); // source of truth

  // Sync isPausedRef and flush render on unpause
  useEffect(() => {
    isPausedRef.current = isPaused;
    if (!isPaused) {
      setActives(new Map(masterActivesRef.current));
    }
  }, [isPaused]);

  // Load runtime config
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await readRuntimeConfig();
      if (cancelled) return;
      setWsUrl(buildWsUrl(cfg));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // WebSocket connection
  function connect() {
    if (!wsUrl) return;
    cleanupSocket();
    setConnected("connecting");
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected("open");
        retryRef.current.attempts = 0;
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(
            typeof evt.data === "string" ? evt.data : String(evt.data)
          );
          if (!data) return;

          const now = Date.now();
          const queue = incomingQueueRef.current;
          const times = messageTimesRef.current;

          // Support both single object and array of objects
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
        try {
          ws.close();
        } catch {
          // ignore
        }
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
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    wsRef.current = null;
  }

  useEffect(() => {
    if (!wsUrl) return;
    connect();
    return () => cleanupSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // Tick: durations, TPS, auto-remove, and Batch Processing
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const m = masterActivesRef.current;

      // 1. Process Batched Messages
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
          const MAX_HISTORY = 100; // slightly reduced for performance
          if (msgs.length > MAX_HISTORY) msgs.shift();
          existing.messages = msgs;

          if (status === "success" || status === "failed" || status === "error" || status === "failure") {
            if (!existing.endAt) existing.endAt = now;
            existing.finalStatus = status;
          }
          m.set(tid, existing);
        }
      }

      // 2. Auto-remove ended txns based on lingerSeconds
      for (const [tid, txn] of m) {
        const ended = !!txn.endAt;
        if (
          autoRemoveOnEnd &&
          ended &&
          lingerSeconds >= 0 &&
          now - txn.endAt! > lingerSeconds * 1000
        ) {
          m.delete(tid);
          changed = true;
        }
      }

      // 3. Trigger Re-render if state changed (skip while paused)
      if (changed && !isPausedRef.current) {
        setActives(new Map(m));
      }

      // 4. Recompute TPS (messages per second over 10s)
      setTps(() => {
        const windowMs = 10_000;
        const arr = messageTimesRef.current;
        const cutoff = now - windowMs;
        while (arr.length && arr[0] < cutoff) {
          arr.shift();
        }
        return arr.length / (windowMs / 1000);
      });
    }, 200);

    return () => clearInterval(id);
  }, [autoRemoveOnEnd, lingerSeconds]);

  function removeTid(tid: string) {
    setActives((prev) => {
      const m = masterActivesRef.current;
      m.delete(tid);
      return new Map(m);
    });
    if (expandedTid === tid) {
      setExpandedTid(null);
    }
  }

  function clearAll() {
    masterActivesRef.current.clear();
    setActives(new Map());
    setExpandedTid(null);
  }

  // Inject sample for testing
  function injectSample() {
    const tid =
      (crypto as any).randomUUID?.() ??
      `tid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const now = Date.now();
    const base: WireMsg = {
      Status: "INFO",
      Uxd: "27/10/2025",
      Uxt: "07:42:15.213",
      Eid: "UNIClientApp",
      Hnm: "pc12345",
      Pid: 2456,
      Fid: "LoadCustomerData",
      Tid: tid,
      Cid: "operator1",
      Uid: "uobj00i4",
      Mtp: "TrnBusy",
      Ret: 0,
      Msg: "Client reported 'busy loading data' while retrieving customer details",
      Elapsed: 1520,
      Severity: "Medium",
    };

    setActives((prev) => {
      const m = masterActivesRef.current;
      const txn: ActiveTxn = {
        tid,
        firstSeenAt: now - Math.floor(Math.random() * 70000),
        lastUpdateAt: now,
        lastMsg: base,
        messages: [base],
      };
      m.set(tid, txn);
      return new Map(m);
    });
  }

  // Build active list with duration, filter, threshold
  const activeList = useMemo(() => {
    const now = Date.now();
    const thresholdMs = thresholdSeconds * 1000;
    const filterText = filter.trim().toLowerCase();

    let list = Array.from(actives.values()).map((t) => {
      const end = t.endAt ?? now;
      return {
        ...t,
        durationMs: end - t.firstSeenAt,
      };
    });

    // Duration filter: only show txns >= thresholdSeconds
    if (thresholdMs > 0) {
      list = list.filter((t) => t.durationMs >= thresholdMs);
    }

    // Text filter
    if (filterText) {
      list = list.filter((t) => {
        const msg = t.lastMsg;
        const fields: Array<string | number | undefined> = [
          t.tid,
          msg.Eid,
          msg.Fid,
          msg.Cid,
          msg.Uid,
          msg.Hnm,
          msg.Status,
          msg.Mtp,
          msg.Msg,
          msg.Severity,
        ];
        return fields.some(
          (v) => v && v.toString().toLowerCase().includes(filterText)
        );
      });
    }

    // Longest duration first
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

        {/* Header */}

        <div className="app-header">
          <section className="card card-summary">
            <div className="header-left">
              <h1 className="app-title">Realtime Transaction Monitor</h1>
            </div>
            <div className="header-right">
              <div
                className={`ws-connection-pill ${connected === "open"
                  ? "ws-ok"
                  : connected === "connecting"
                    ? "ws-warn"
                    : "ws-bad"
                  }`}
              >
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

              {/* <button onClick={injectSample} className="btn">
                ⏱
              </button> */}
            </div>
          </section>

          {/* Summary + thresholds */}
          <section className="card card-summary">
            <div className="summary-grid">
              <SummaryItem label="Active" value={String(activeList.length)} />

              <SummaryItem
                label="Tx/s (last 10s)"
                value={tps.toFixed(1)}
              />

              <SummaryItem
                label="Longest"
                value={longest ? human(longest.durationMs) : "—"}
              />

              <SummaryItem
                label="Show if ≥"
                value={`${thresholdSeconds}s`}
                onMinus={() =>
                  setThresholdSeconds(Math.max(0, thresholdSeconds - 1))
                }
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
        {/* Active list */}
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
                onToggleTid={(tid) => setExpandedTid(expandedTid === tid ? null : tid)}
                onRemoveTid={removeTid}
                onHide={(bid) => setExcludedBids((prev) => new Set([...prev, bid]))}
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
                onToggleExpand={() =>
                  setExpandedTid(expandedTid === t.tid ? null : t.tid)
                }
              />
            ))
          )}
        </section>
      </div>

      {serverStats && <StatsOverlay stats={serverStats} />}
    </div >
  );
}

type TxnWithDuration = ActiveTxn & { durationMs: number };

function BidGroupRow({
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

  // Latest TID by lastUpdateAt
  const latest = txns.reduce((a, b) => b.lastUpdateAt > a.lastUpdateAt ? b : a, txns[0]);
  const lm = latest.lastMsg;

  // Aggregate statuses across all TIDs
  const statusCounts = new Map<string, number>();
  for (const t of txns) {
    const s = t.lastMsg.Status || "?";
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }

  return (
    <div className="bid-group card" onClick={onToggleExpand} style={{ cursor: "pointer" }}>
      {/* colour bar — hidden when expanded */}
      {!isExpanded && (
        <div
          className="txn-progress"
          style={{ background: `linear-gradient(90deg, ${color} ${pct}%, rgba(0,0,0,0.06) ${pct}%)` }}
        />
      )}
      {/* BID header */}
      <div className="bid-group-header">
        <div className="bid-group-header-left">
          <span className="bid-group-label">{isNoBid ? "— no BID —" : `BID: ${bid}`}</span>
          <span className="bid-group-count" style={(() => {
            const n = txns.length;
            if (n <= 5) return {};
            const t = Math.min((n - 5) / (20 - 5), 1);
            const r = Math.round(187 + (252 - 187) * t);  // pastel green → pastel red
            const g = Math.round(247 + (165 - 247) * t);
            const b = Math.round(208 + (165 - 208) * t);
            return { background: `rgb(${r},${g},${b})`, color: "#374151", borderColor: "transparent" };
          })()}>{txns.length} TID{txns.length !== 1 ? "s" : ""}</span>
          <span className="bid-group-duration" style={{ color }}>{human(longestDurationMs)}</span>
          {Array.from(statusCounts.entries()).map(([s, n]) => (
            <span key={s} className="txn-badge txn-badge-blue">
              {s}{n > 1 ? ` ×${n}` : ""}
            </span>
          ))}
        </div>
        <span className="expand-indicator">{isExpanded ? "▲" : "▼"}</span>
      </div>

      {/* Collapsed summary: key fields from latest TID */}
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
            <button
              className="btn-icon"
              title="Hide this BID"
              onClick={() => onHide(bid)}
            >✕</button>
          </div>
        </div>
      )}

      {/* TID breakdown — always visible, same style as TID view */}
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

function StatsOverlay({ stats }: { stats: ServerStats }) {
  const hasDrops = stats.udp_drop_total > 0 || stats.ws_drop_total > 0;
  return (
    <div className={`stats-overlay ${hasDrops ? "stats-overlay-warn" : ""}`}>
      <span className="stats-overlay-item">{stats.pkts_per_sec.toFixed(1)} <span className="stats-overlay-label">pkt/s</span></span>
      <span className="stats-overlay-sep" />
      <span className={`stats-overlay-item ${stats.udp_drop_interval > 0 ? "stats-drop-active" : ""}`}>
        UDP <span className="stats-overlay-label">drop</span> {stats.udp_drop_total}
      </span>
      <span className="stats-overlay-sep" />
      <span className={`stats-overlay-item ${stats.ws_drop_total > 0 ? "stats-drop-active" : ""}`}>
        WS <span className="stats-overlay-label">drop</span> {stats.ws_drop_total}
      </span>
      <span className="stats-overlay-sep" />
      <span className="stats-overlay-item">Q <span className="stats-overlay-label"></span>{stats.q_size}</span>
      <span className="stats-overlay-sep" />
      <span className="stats-overlay-item">{stats.clients} <span className="stats-overlay-label">clients</span></span>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  onMinus,
  onPlus,
  toggle,
}: {
  label: string;
  value: string;
  onMinus?: () => void;
  onPlus?: () => void;
  toggle?: () => void;
}) {
  const isDisabled = value === "Disabled";

  return (
    <div className="summary-item">
      <div className="summary-label-text">{label}</div>
      <div className="summary-item-row">
        {toggle && (
          <input
            type="checkbox"
            checked={!isDisabled}
            onChange={toggle}
            style={{ marginRight: 6 }}
          />
        )}
        <div className="summary-value">{value}</div>
        {!isDisabled && onMinus && (
          <button className="mini-btn" onClick={onMinus}>
            –
          </button>
        )}
        {!isDisabled && onPlus && (
          <button className="mini-btn" onClick={onPlus}>
            +
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card card-empty">
      <div className="card-body-empty">
        No active transactions.
      </div>
    </div>
  );
}

const TxnRow = React.memo(({
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
        style={{
          background: `linear-gradient(90deg, ${color} ${pct}%, rgba(0,0,0,0.06) ${pct}%)`,
        }}
      />
      <div
        className="txn-body"
        onClick={onToggleExpand}
      >
        <div className="txn-main">
          <div className="txn-header-row txn-clickable">
            <div className="txn-header-left">
              <span className="txn-tid" title={txn.tid}>
                TID: {txn.tid}
              </span>
              <span className="txn-badge txn-badge-muted">
                {human(txn.durationMs)}
              </span>
              {msg.Status && (
                <span className="txn-badge txn-badge-blue">
                  {msg.Status}
                </span>
              )}
              {msg.Mtp && (
                <span className="txn-badge txn-badge-purple">
                  {msg.Mtp}
                </span>
              )}
            </div>
            {msg.Bid && (
              <span className="txn-bid" title={msg.Bid}>
                BID: {msg.Bid}
              </span>
            )}
            <span className="expand-indicator">
              {isExpanded ? "▲" : "▼"}
            </span>
          </div>

          <div className="txn-grid">
            {msg.Eid && <KV k="Eid" v={msg.Eid} />}
            {msg.Fid && <KV k="Fid" v={msg.Fid} />}
            {msg.Uid && <KV k="Uid" v={msg.Uid} />}
            {msg.Cid && <KV k="Cid" v={msg.Cid} />}
            {msg.Hnm && <KV k="Host" v={msg.Hnm} />}
            {msg.Pid !== undefined && msg.Pid > 0 && (
              <KV k="Pid" v={String(msg.Pid)} />
            )}
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
          <span
            className="txn-health"
            style={{ color }}
          >
            {healthLabel}
          </span>
          <button
            className="btn-icon"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove transaction"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
});

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-value" title={v}>
        {v}
      </span>
    </div>
  );
}
