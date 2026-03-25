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

function human(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const mmm = ms % 1000;
  if (mm > 0) return `${mm}m ${ss}s`;
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

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<{ attempts: number; timer: any }>({
    attempts: 0,
    timer: 0,
  });
  const messageTimesRef = useRef<number[]>([]); // timestamps of messages for TPS
  const incomingQueueRef = useRef<WireMsg[]>([]); // buffer for batching
  const masterActivesRef = useRef<Map<string, ActiveTxn>>(new Map()); // source of truth

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
        if (isPaused) return;
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

      // 3. Trigger Re-render if state changed
      if (changed) {
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

              {/* <button
              onClick={() => setIsPaused((p) => !p)}
              className="btn btn-secondary"
            >
              {isPaused ? "▶ Resume" : "⏸ Pause"}
            </button> */}

              <button onClick={clearAll} className="btn btn-danger">
                🗑 Clear All
              </button>

              <button onClick={injectSample} className="btn">
                ⏱
              </button>
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
            </div>
          </section>
        </div>
        {/* Active list */}
        <section className="txn-list">
          {activeList.length === 0 ? (
            <EmptyState />
          ) : (
            activeList.map((t) => (
              <TxnRow
                key={t.tid}
                txn={t}
                thresholdSeconds={thresholdSeconds}
                onRemove={() => removeTid(t.tid)}
                isExpanded={expandedTid === t.tid}
                onToggleExpand={() =>
                  setExpandedTid(
                    expandedTid === t.tid ? null : t.tid
                  )
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
}: {
  txn: ActiveTxn & { durationMs: number };
  thresholdSeconds: number;
  onRemove: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) => {
  const sec = txn.durationMs / 1000;
  const color = colorForSeconds(sec, thresholdSeconds);
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
            {msg.Pid !== undefined && (
              <KV k="Pid" v={String(msg.Pid)} />
            )}
          </div>

          {msg.Msg && (
            <div className="txn-message" title={msg.Msg}>
              {msg.Msg}
            </div>
          )}

          {isExpanded && txn.messages && txn.messages.length > 1 && (
            <div className="txn-history">
              {txn.messages.map((m, idx) => (
                <div key={idx} className="txn-history-row">
                  <span className="txn-history-time">
                    {m.Uxt || ""}
                  </span>
                  {m.Status && (
                    <span className="txn-history-status">
                      {m.Status}
                    </span>
                  )}
                  {m.Mtp && (
                    <span className="txn-history-mtp">
                      {m.Mtp}
                    </span>
                  )}
                  {m.Msg && (
                    <span
                      className="txn-history-msg"
                      title={m.Msg}
                    >
                      {m.Msg}
                    </span>
                  )}
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
