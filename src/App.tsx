import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { ActiveTxn, AppConfig, ServerStats, WireMsg } from "./types";
import { buildWsUrl, defaultConfig, human, readRuntimeConfig } from "./utils";
import { useTabRegistry } from "./hooks/useTabRegistry";
import { BidGroupRow } from "./components/BidGroupRow";
import { EmptyState } from "./components/EmptyState";
import { ProcessDrillDown } from "./components/ProcessDrillDown";
import { ServerHostBlock } from "./components/ServerHostBlock";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsOverlay } from "./components/StatsOverlay";
import { SummaryItem } from "./components/SummaryItem";
import { TxnRow } from "./components/TxnRow";

export default function App() {
  const { otherTabs, suppressReconnect } = useTabRegistry();
  const suppressReconnectRef = useRef(suppressReconnect);
  const prevSuppressRef = useRef(suppressReconnect);
  suppressReconnectRef.current = suppressReconnect;
  const [wsUrl, setWsUrl] = useState<string>("");
  const [connected, setConnected] = useState<"connecting" | "open" | "closed">("connecting");
  const [isPaused, setIsPaused] = useState(false);
  const [actives, setActives] = useState<Map<string, ActiveTxn>>(new Map());
  const [autoRemoveOnEnd, setAutoRemoveOnEnd] = useState(defaultConfig.autoRemoveOnEnd!);
  const [thresholdSeconds, setThresholdSeconds] = useState<number>(defaultConfig.thresholdSeconds!);
  const [staleMinutes, setStaleMinutes] = useState<number>(defaultConfig.staleMinutes!);
  const [lingerSeconds, setLingerSeconds] = useState<number>(defaultConfig.lingerSeconds!);
  const [tpsInnerDotThreshold, setTpsInnerDotThreshold] = useState<number>(defaultConfig.tpsInnerDotThreshold!);
  const [busyPctInnerDotThreshold, setBusyPctInnerDotThreshold] = useState<number>(defaultConfig.busyPctInnerDotThreshold!);
  const [busyLingerMs, setBusyLingerMs] = useState<number>(defaultConfig.busyLingerMs!);
  const [busyWindowMs, setBusyWindowMs] = useState<number>(defaultConfig.busyWindowMs!);
  const [busyWindowTxns, setBusyWindowTxns] = useState<number>(defaultConfig.busyWindowTxns!);
  const [filter, setFilter] = useState<string>("");
  const [expandedTid, setExpandedTid] = useState<string | null>(null);
  const [tps, setTps] = useState<number>(0);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true");
  const [groupBy, setGroupBy] = useState<"tid" | "bid" | "servers" | "drilldown">(() => {
    const v = localStorage.getItem("groupBy");
    return (v === "tid" || v === "bid" || v === "servers") ? v : "tid";
  });
  const [expandedBids, setExpandedBids] = useState<Set<string>>(new Set());
  const [excludedBids, setExcludedBids] = useState<Set<string>>(new Set());
  const [groupEids, setGroupEids] = useState(() => {
    const v = localStorage.getItem("groupEids");
    return v === null ? true : v === "true";
  });
  const [editingGroups, setEditingGroups] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showClients, setShowClients] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [drilldownTabs, setDrilldownTabs] = useState<string[]>([]);
  const [activeDrilldown, setActiveDrilldown] = useState<string | null>(null);
  const [eidGroupDefs, setEidGroupDefs] = useState<{ name: string; pattern: string }[]>(() => {
    try {
      const v = localStorage.getItem("eidGroupDefs");
      if (v) return JSON.parse(v);
    } catch { /* ignore */ }
    return [{ name: "IBT", pattern: "ibt*" }];
  });

  const isPausedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsUrlRef = useRef<string>("");
  const retryRef = useRef<{ attempts: number; timer: any }>({ attempts: 0, timer: 0 });
  const messageTimesRef = useRef<number[]>([]);
  const incomingQueueRef = useRef<WireMsg[]>([]);
  const masterActivesRef = useRef<Map<string, ActiveTxn>>(new Map());
  const serverActivesRef = useRef<Map<string, ActiveTxn>>(new Map());
  const procTxnCountRef = useRef<Map<string, number>>(new Map());
  const procTxnTimesRef = useRef<Map<string, number[]>>(new Map());
  // busy intervals: { start, end? } — end=undefined means still running
  const procBusyIntervalsRef = useRef<Map<string, { start: number; end?: number }[]>>(new Map());
  const [serverActives, setServerActives] = useState<Map<string, ActiveTxn>>(new Map());
  const [serverTick, setServerTick] = useState(0);

  // Force serverGroups recompute every second so TPS/busy decay even with no incoming data
  useEffect(() => {
    const id = setInterval(() => setServerTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Dark mode
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("darkMode", String(darkMode));
  }, [darkMode]);

  // Auto-reconnect when primary session closes (suppress lifts)
  useEffect(() => {
    const wasSupressed = prevSuppressRef.current;
    prevSuppressRef.current = suppressReconnect;
    if (wasSupressed && !suppressReconnect) {
      const ws = wsRef.current;
      const isClosed = !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
      if (isClosed) {
        console.log("[WS] primary session gone — reconnecting");
        connect.current();
      }
    }
  }, [suppressReconnect]);

  // Persist user preferences
  useEffect(() => { localStorage.setItem("groupBy", groupBy); }, [groupBy]);
  useEffect(() => { localStorage.setItem("groupEids", String(groupEids)); }, [groupEids]);
  useEffect(() => { localStorage.setItem("eidGroupDefs", JSON.stringify(eidGroupDefs)); }, [eidGroupDefs]);

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
      if (cfg.thresholdSeconds !== undefined) setThresholdSeconds(cfg.thresholdSeconds);
      if (cfg.staleMinutes !== undefined) setStaleMinutes(cfg.staleMinutes);
      if (cfg.lingerSeconds !== undefined) setLingerSeconds(cfg.lingerSeconds);
      if (cfg.autoRemoveOnEnd !== undefined) setAutoRemoveOnEnd(cfg.autoRemoveOnEnd);
      if (cfg.tpsInnerDotThreshold !== undefined) setTpsInnerDotThreshold(cfg.tpsInnerDotThreshold);
      if (cfg.busyPctInnerDotThreshold !== undefined) setBusyPctInnerDotThreshold(cfg.busyPctInnerDotThreshold);
      if (cfg.busyLingerMs !== undefined) setBusyLingerMs(cfg.busyLingerMs);
      if (cfg.busyWindowMs !== undefined) setBusyWindowMs(cfg.busyWindowMs);
      if (cfg.busyWindowTxns !== undefined) setBusyWindowTxns(cfg.busyWindowTxns);
    })();
    return () => { cancelled = true; };
  }, []);

  const cleanupSocket = useRef(() => {
    clearTimeout(retryRef.current.timer);
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(); } catch { /* ignore */ }
    }
    wsRef.current = null;
  });

  const scheduleReconnect = useRef(() => {
    if (suppressReconnectRef.current) {
      console.log("[WS] reconnect suppressed — oldest tab, not focused, other session active");
      return;
    }
    const attempts = ++retryRef.current.attempts;
    const delay = Math.min(5000, 250 * Math.pow(2, attempts));
    console.log(`[WS] reconnecting in ${delay}ms (attempt #${attempts})`);
    clearTimeout(retryRef.current.timer);
    retryRef.current.timer = setTimeout(() => connect.current(), delay);
  });

  const connect = useRef(() => {
    if (!wsUrlRef.current) return;
    cleanupSocket.current();
    setConnected("connecting");
    try {
      const ws = new WebSocket(wsUrlRef.current);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[WS] connected to ${wsUrlRef.current}`);
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
            } else if (obj) {
              // Normalize Pid to number (sender may send as string)
              if (obj.Pid !== undefined) obj.Pid = Number(obj.Pid);
              if (obj.Tid) {
                queue.push(obj);
                times.push(now);
              } else if (obj.Hnm && obj.Pid) {
                // Lifecycle packet (DIED/SHUTDOWN/STARTUP) — no Tid, route directly
                queue.push(obj);
              }
            }
          }
        } catch (e) {
          console.warn("Failed to parse message", e);
        }
      };

      ws.onclose = (evt) => {
        console.warn(`[WS] closed — code=${evt.code} reason="${evt.reason || "(none)"}" wasClean=${evt.wasClean} url=${wsUrlRef.current}`);
        setConnected("closed");
        scheduleReconnect.current();
      };

      ws.onerror = (evt) => {
        console.error(`[WS] error event`, evt);
        try { ws.close(); } catch { /* ignore */ }
      };
    } catch {
      setConnected("closed");
      scheduleReconnect.current();
    }
  });

  useEffect(() => {
    if (!wsUrl) return;
    connect.current();
    return () => cleanupSocket.current();
  }, [wsUrl]);

  // Tick: process batches, auto-remove, TPS
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const m = masterActivesRef.current;

      const batch = incomingQueueRef.current;
      incomingQueueRef.current = [];

      const s = serverActivesRef.current;
      let changed = batch.length > 0;
      for (const obj of batch) {
        const tid = obj.Tid;
        const status = (obj.Status || "").toLowerCase();
        const isTerminal = status === "success" || status === "failed" || status === "error" || status === "failure";
        const isLifecycle = status === "died" || status === "shutdown" || status === "startup";

        // Lifecycle packets (DIED/SHUTDOWN/STARTUP) have no Tid — only update serverActives
        if (!isLifecycle) {
          const existing = m.get(tid);
          if (!existing) {
            const txn: ActiveTxn = {
              tid,
              firstSeenAt: now,
              lastUpdateAt: now,
              lastMsg: obj,
              messages: [obj],
            };
            if (isTerminal) {
              txn.endAt = now;
              txn.finalStatus = status;
            }
            m.set(tid, txn);
          } else {
            existing.lastUpdateAt = now;
            existing.lastMsg = obj;
            const msgs = existing.messages || [];
            msgs.push({ ...obj, _receivedAt: now } as any);
            const MAX_HISTORY = 100;
            if (msgs.length > MAX_HISTORY) msgs.shift();
            existing.messages = msgs;
            if (isTerminal) {
              if (!existing.endAt) existing.endAt = now;
              existing.finalStatus = status;
            }
            m.set(tid, existing);
          }
        }

        // Mirror into serverActives keyed by "Hnm:Pid" — one stable slot per process, never purged
        if (obj.Hnm && (obj.Pid ?? 0) > 0) {
          const procKey = `${obj.Hnm}:${obj.Pid}`;
          const sexisting = s.get(procKey);

          if (isLifecycle) {
            if (sexisting) {
              // Stamp only Status onto existing lastMsg — preserve Eid and all other fields
              sexisting.lastUpdateAt = now;
              sexisting.lastMsg = { ...sexisting.lastMsg, Status: obj.Status };
              s.set(procKey, sexisting);
            }
            // If no existing slot, ignore — nothing to mark
          } else {
            const prevEnded = sexisting?.endAt !== undefined;
            const isNewTxn = !sexisting || prevEnded;

            if (isNewTxn) {
              // New transaction for this process — increment counter and record timestamp
              procTxnCountRef.current.set(procKey, (procTxnCountRef.current.get(procKey) ?? 0) + 1);
              const times = procTxnTimesRef.current.get(procKey) ?? [];
              times.push(now);
              procTxnTimesRef.current.set(procKey, times);
              const intervals = procBusyIntervalsRef.current.get(procKey) ?? [];
              if (isTerminal) {
                intervals.push({ start: now, end: now });
              } else {
                intervals.push({ start: now });
              }
              procBusyIntervalsRef.current.set(procKey, intervals);
              const txn: ActiveTxn = {
                tid,
                firstSeenAt: now,
                lastUpdateAt: now,
                lastMsg: obj,
                messages: [{ ...obj, _receivedAt: now } as any],
              };
              if (isTerminal) { txn.endAt = now; txn.finalStatus = status; }
              s.set(procKey, txn);
            } else {
              // Continuing transaction — update slot
              sexisting.lastUpdateAt = now;
              sexisting.lastMsg = obj;
              const msgs = sexisting.messages || [];
              msgs.push({ ...obj, _receivedAt: now } as any);
              const MAX_HISTORY = 100;
              if (msgs.length > MAX_HISTORY) msgs.shift();
              sexisting.messages = msgs;
              if (isTerminal && !sexisting.endAt) {
                sexisting.endAt = now;
                sexisting.finalStatus = status;
                const intervals = procBusyIntervalsRef.current.get(procKey);
                if (intervals?.length) {
                  const last = intervals[intervals.length - 1]!;
                  if (!last.end) last.end = now;
                }
              }
              s.set(procKey, sexisting);
            }
          }
          changed = true;
        }
      }
      if (changed) setServerActives(new Map(s));

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
        while (arr.length && arr[0]! < cutoff) arr.shift();
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
      list = list.filter((t) => {
        // Always show terminal-only transactions (no START message, just END with error/failure)
        const isTerminalOnly = t.finalStatus && t.durationMs === 0;
        return isTerminalOnly || t.durationMs >= thresholdMs;
      });
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

  const serverGroups = useMemo(() => {
    if (groupBy !== "servers" && groupBy !== "drilldown") return [];

    const now = Date.now();
    // Group: host → eid → pid → best txn
    const byHost = new Map<string, Map<string, Map<number, ActiveTxn & { durationMs: number }>>>();
    for (const txn of serverActives.values()) {
      const host = txn.lastMsg.Hnm!;
      const eid = txn.lastMsg.Eid ?? "(no eid)";
      const pid = txn.lastMsg.Pid!;
      if (!byHost.has(host)) byHost.set(host, new Map());
      const byEid = byHost.get(host)!;
      if (!byEid.has(eid)) byEid.set(eid, new Map());
      const byPid = byEid.get(eid)!;
      const existing = byPid.get(pid);
      const withDuration = { ...txn, durationMs: (txn.endAt ?? now) - txn.firstSeenAt };
      if (!existing || txn.lastUpdateAt > existing.lastUpdateAt) byPid.set(pid, withDuration);
    }

    return Array.from(byHost.entries())
      .map(([host, byEid]) => ({
        host,
        eids: Array.from(byEid.entries())
          .map(([eid, byPid]) => ({
            eid,
            procs: Array.from(byPid.entries())
              .map(([pid, txn]) => {
                const procKey = `${host}:${pid}`;
                const times = procTxnTimesRef.current.get(procKey) ?? [];
                const tpsCutoff = now - 10_000;
                const recent = times.filter(t => t >= tpsCutoff);
                procTxnTimesRef.current.set(procKey, recent);
                const tps = recent.length / 10;

                const allIntervals = procBusyIntervalsRef.current.get(procKey) ?? [];
                // Window start = earliest of: busyWindowMs ago OR start of busyWindowTxns-th-most-recent interval
                const tenthStart = allIntervals.length >= busyWindowTxns
                  ? allIntervals[allIntervals.length - busyWindowTxns]!.start
                  : allIntervals[0]?.start ?? now;
                const busyCutoff = Math.min(now - busyWindowMs, tenthStart);
                const trimmedIntervals = allIntervals.filter(iv => (iv.end ?? now) >= busyCutoff);
                procBusyIntervalsRef.current.set(procKey, trimmedIntervals);
                const windowMs = now - busyCutoff;
                const busyMs = trimmedIntervals.reduce((sum, iv) => {
                  const s = Math.max(iv.start, busyCutoff);
                  const e = iv.end ?? now;
                  return sum + Math.max(0, e - s);
                }, 0);
                const busyPct = Math.round(busyMs / windowMs * 10000) / 100;

                return {
                  pid,
                  txn,
                  txnCount: procTxnCountRef.current.get(procKey) ?? 0,
                  tps,
                  busyPct,
                };
              }),
          }))
          .sort((a, b) => a.eid.localeCompare(b.eid)),
      }))
      .sort((a, b) => a.host.localeCompare(b.host));
  }, [serverActives, groupBy, serverTick, busyWindowMs, busyWindowTxns]);

  const longest = activeList[0];

  function matchesPattern(eid: string, pattern: string): boolean {
    const e = eid.toLowerCase();
    const p = pattern.toLowerCase();
    if (p.startsWith("*") && p.endsWith("*")) return e.includes(p.slice(1, -1));
    if (p.startsWith("*")) return e.endsWith(p.slice(1));
    if (p.endsWith("*")) return e.startsWith(p.slice(0, -1));
    return e === p;
  }

  const allRawEids = Array.from(new Set(
    serverGroups.flatMap((g) => g.eids.map((e) => e.eid))
  )).sort((a, b) => a.localeCompare(b));

  type GridRow = { label: string; eids: string[] };
  const gridRows: GridRow[] = (() => {
    if (!groupEids) return allRawEids.map((e) => ({ label: e, eids: [e] }));
    const consumed = new Set<string>();
    const rows: GridRow[] = [];
    for (const { name, pattern } of eidGroupDefs) {
      const matched = allRawEids.filter((e) => matchesPattern(e, pattern));
      if (matched.length > 0) {
        matched.forEach((e) => consumed.add(e));
        rows.push({ label: name, eids: matched });
      }
    }
    for (const eid of allRawEids) {
      if (!consumed.has(eid)) rows.push({ label: eid, eids: [eid] });
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  })();

  const handleProcDotClick = (host: string, pid: number, eid: string) => {
    // Extract first part of hostname before first dot
    const hostPrefix = host.split(".")[0];
    const tabKey = `${hostPrefix}:${eid}:${pid}`;
    setDrilldownTabs((prev) => prev.includes(tabKey) ? prev : [...prev, tabKey]);
    setActiveDrilldown(tabKey);
    setGroupBy("drilldown" as any);
  };

  const handleRestartProcess = (pid: number, hnm: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const restartPacket = {
        Command: "RESTART",
        Pid: pid,
        Hnm: hnm,
      };
      wsRef.current.send(JSON.stringify(restartPacket));
      console.log(`[WS] Sent restart command for ${hnm}:${pid}`);
    } else {
      console.warn("WebSocket not connected, cannot send restart command");
    }
  };

  const serverGridContent = serverGroups.length === 0 ? (
    <EmptyState />
  ) : (
    <>
      {editingGroups && (
        <div className="eid-group-editor card">
          <div className="eid-group-editor-header">
            <span className="eid-group-editor-title">EID Groups</span>
            <button className="btn-icon" onClick={() => setEditingGroups(false)}>✕</button>
          </div>
          {eidGroupDefs.map((def, i) => (
            <div key={i} className="eid-group-editor-row">
              <input
                className="input eid-group-input"
                value={def.name}
                placeholder="Group name"
                onChange={(e) => setEidGroupDefs((prev) => prev.map((d, j) => j === i ? { ...d, name: e.target.value } : d))}
              />
              <input
                className="input eid-group-input"
                value={def.pattern}
                placeholder="Pattern (e.g. ibt*)"
                onChange={(e) => setEidGroupDefs((prev) => prev.map((d, j) => j === i ? { ...d, pattern: e.target.value } : d))}
              />
              <button className="btn-icon" onClick={() => setEidGroupDefs((prev) => prev.filter((_, j) => j !== i))}>🗑</button>
            </div>
          ))}
          <button className="btn btn-secondary" style={{ alignSelf: "flex-start", marginTop: 4 }}
            onClick={() => setEidGroupDefs((prev) => [...prev, { name: "", pattern: "" }])}>
            + Add group
          </button>
        </div>
      )}
      <div className="server-grid" style={{ gridTemplateColumns: `max-content ${serverGroups.map(() => "1fr").join(" ")}` }}>
        <div className="server-grid-corner">
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`btn server-group-btn${groupEids ? " btn-secondary capsule-active" : " btn-secondary"}`}
              onClick={() => setGroupEids((v) => !v)}
            >{groupEids ? "Grouped" : "Expanded"}</button>
            <button
              className={`btn server-group-btn${editingGroups ? " btn-secondary capsule-active" : " btn-secondary"}`}
              onClick={() => setEditingGroups((v) => !v)}
            >✎</button>
          </div>
        </div>
        {serverGroups.map((g) => (
          <div key={g.host} className="server-grid-hostname">{g.host}</div>
        ))}
        {gridRows.map((row) => (
          <div key={row.label} className="server-grid-row-wrap" style={{ display: "contents" }}>
            <div
              className="server-grid-eid-label server-grid-eid-label-clickable"
              onClick={() => {
                const key = row.label;
                setDrilldownTabs((prev) => prev.includes(key) ? prev : [...prev, key]);
                setActiveDrilldown(key);
                setGroupBy("drilldown" as any);
              }}
            >{row.label}</div>
            {serverGroups.map((g) => {
              const matchedEids = g.eids.filter((e) => row.eids.includes(e.eid));
              const allProcs = matchedEids.flatMap((e) => e.procs);
              return (
                <div key={`${g.host}-${row.label}`} className="server-grid-cell">
                  {allProcs.length > 0 && (
                    <ServerHostBlock
                      group={{ host: g.host, eids: [{ eid: row.label, procs: allProcs }] }}
                      thresholdSeconds={thresholdSeconds}
                      staleSecs={staleMinutes * 60}
                      tpsInnerDotThreshold={tpsInnerDotThreshold}
                      busyPctInnerDotThreshold={busyPctInnerDotThreshold}
                      busyLingerMs={busyLingerMs}
                      onProcDotClick={(pid, eid) => handleProcDotClick(g.host, pid, eid)}
                      onKill={handleRestartProcess}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="app-root">
      {otherTabs.length > 0 && (
        <div className="other-tabs-banner">
          <span className="other-tabs-label">⚠ {otherTabs.length} other session{otherTabs.length > 1 ? "s" : ""} open on this machine{suppressReconnect ? " — reconnect paused (not in focus)" : ""}</span>
          {otherTabs
            .slice()
            .sort((a, b) => a.openedAt - b.openedAt)
            .map((tab, i) => (
              <span key={tab.id} className="other-tabs-pill">
                Session {i + 1} — opened {new Date(tab.openedAt).toLocaleTimeString()}
              </span>
            ))}
        </div>
      )}
      <div className="app-container">
        <div className="app-header">
          <section className="card card-summary">
            <div className="header-left">

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

              <button onClick={clearAll} className="btn btn-danger">
                🗑 Clear All
              </button>

              <div style={{ width: 16 }} />

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
              <SummaryItem
                label="Stale after"
                value={`${staleMinutes}m`}
                onMinus={() => setStaleMinutes((v) => Math.max(1, v - 1))}
                onPlus={() => setStaleMinutes((v) => v + 1)}
              />
              {excludedBids.size > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setExcludedBids(new Set())}
                  title="Show all hidden BIDs"
                >
                  {excludedBids.size} hidden · Clear
                </button>
              )}

              <div style={{ marginLeft: "auto" }} />
              <button
                className="btn btn-secondary"
                onClick={() => { setShowInfo((v) => !v); setShowSettings(false); setShowClients(false); }}
                title="Info"
              >
                ℹ️
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setShowSettings((v) => !v); setShowClients(false); setShowInfo(false); }}
                title="Settings"
              >
                ⚙
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setDarkMode((v) => !v)}
                title="Toggle dark mode"
              >
                {darkMode ? "☀️" : "🌙"}
              </button>

            </div>
          </section>

          <div className="group-tabs">
            <button
              className={`group-tab${groupBy === "tid" ? " group-tab-active" : ""}`}
              onClick={() => setGroupBy("tid")}
            >TID</button>
            <button
              className={`group-tab${groupBy === "bid" ? " group-tab-active" : ""}`}
              onClick={() => setGroupBy("bid")}
            >BID</button>
            <button
              className={`group-tab${groupBy === "servers" ? " group-tab-active" : ""}`}
              onClick={() => setGroupBy("servers")}
            >Robot</button>
            {drilldownTabs.map((key) => (
              <button
                key={key}
                className={`group-tab${groupBy === "drilldown" && activeDrilldown === key ? " group-tab-active" : ""}`}
                onClick={() => { setActiveDrilldown(key); setGroupBy("drilldown" as any); }}
              >
                {key}
                <span
                  className="drilldown-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDrilldownTabs((prev) => {
                      const next = prev.filter((k) => k !== key);
                      if (activeDrilldown === key) {
                        setActiveDrilldown(next.length > 0 ? next[next.length - 1]! : null);
                        if (next.length === 0) setGroupBy("servers");
                      }
                      return next;
                    });
                  }}
                >✕</span>
              </button>
            ))}
          </div>
        </div>

        <div className="app-body">
        <section className="txn-list">
          {groupBy === "drilldown" && activeDrilldown ? (() => {
            const label = activeDrilldown;
            // Check if it's a process-specific drilldown (format: hostPrefix:eid:pid)
            const parts = label.split(":");
            const isProcSpecific = parts.length === 3;
            let allProcs;

            if (isProcSpecific) {
              const [hostPrefix, eid, pidStr] = parts;
              const pid = Number(pidStr);
              allProcs = serverGroups.flatMap((g) =>
                g.host.startsWith(hostPrefix)
                  ? g.eids.flatMap((e) =>
                      e.eid === eid
                        ? e.procs.filter((p) => p.pid === pid).map((p) => ({ ...p, host: g.host }))
                        : []
                    )
                  : []
              );
            } else {
              const row = gridRows.find((r) => r.label === label);
              allProcs = row
                ? serverGroups.flatMap((g) =>
                    g.eids.filter((e) => row.eids.includes(e.eid)).flatMap((e) =>
                      e.procs.map((p) => ({ ...p, host: g.host }))
                    )
                  )
                : [];
            }
            return <ProcessDrillDown label={label} procs={allProcs} staleSecs={staleMinutes * 60} onKill={handleRestartProcess} onProcDotClick={handleProcDotClick} />;
          })() : groupBy === "servers" ? (
            serverGridContent
          ) : activeList.length === 0 ? (
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
        {showSettings && (
          <SettingsPanel
            thresholdSeconds={thresholdSeconds} setThresholdSeconds={setThresholdSeconds}
            staleMinutes={staleMinutes} setStaleMinutes={setStaleMinutes}
            lingerSeconds={lingerSeconds} setLingerSeconds={setLingerSeconds}
            autoRemoveOnEnd={autoRemoveOnEnd} setAutoRemoveOnEnd={setAutoRemoveOnEnd}
            tpsInnerDotThreshold={tpsInnerDotThreshold} setTpsInnerDotThreshold={setTpsInnerDotThreshold}
            busyPctInnerDotThreshold={busyPctInnerDotThreshold} setBusyPctInnerDotThreshold={setBusyPctInnerDotThreshold}
            busyLingerMs={busyLingerMs} setBusyLingerMs={setBusyLingerMs}
            busyWindowMs={busyWindowMs} setBusyWindowMs={setBusyWindowMs}
            busyWindowTxns={busyWindowTxns} setBusyWindowTxns={setBusyWindowTxns}
            onClose={() => setShowSettings(false)}
          />
        )}
        {showClients && (
          <div className="settings-panel">
            <div className="settings-header">
              <span className="settings-title">Connected clients</span>
              <button className="btn-icon" onClick={() => setShowClients(false)}>✕</button>
            </div>
            {(serverStats?.client_ips ?? []).length === 0 ? (
              <div style={{ padding: "16px", fontSize: 13, color: "var(--text-muted)" }}>No client IP data yet</div>
            ) : (
              <ul className="clients-list">
                {(serverStats?.client_ips ?? []).map((ip) => {
                  const isMe = ip === serverStats?.my_ip;
                  return (
                    <li key={ip} className={`clients-list-ip${isMe ? " clients-list-ip-me" : ""}`}>
                      <span className={`clients-list-dot${isMe ? " clients-list-dot-me" : ""}`} />
                      <span className="clients-list-addr">{ip}</span>
                      {isMe && <span className="clients-me-badge">you</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {showInfo && (
          <div className="settings-panel">
            <div className="settings-header">
              <span className="settings-title">Rules</span>
              <button className="btn-icon" onClick={() => setShowInfo(false)}>✕</button>
            </div>
            {groupBy === "servers" ? (
              <div className="info-content">
                <div className="info-section">
                  <div className="info-section-title">Process Dot Colors (Robot Tab)</div>
                  <div className="info-rule">
                    <span className="info-dot" style={{ background: "#22c55e" }} />
                    <span><strong>Green (Idle):</strong> Process is running, no active transactions</span>
                  </div>
                  <div className="info-rule">
                    <span className="info-dot" style={{ background: "#ef4444" }} />
                    <span><strong>Red (Busy):</strong> Process has active transactions in flight</span>
                  </div>
                  <div className="info-rule">
                    <span className="info-dot" style={{ background: "#166534" }} />
                    <span><strong>Dark Green (Stale):</strong> Process hasn't sent data for {staleMinutes} minute{staleMinutes !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="info-rule">
                    <span className="info-dot" style={{ background: "#9ca3af" }} />
                    <span><strong>Grey (Dead):</strong> Process has shut down or died</span>
                  </div>
                </div>
                <div className="info-section">
                  <div className="info-section-title">Special Indicators</div>
                  <div className="info-rule">
                    <span className="info-ring" style={{ boxShadow: "0 0 0 2px rgba(239, 68, 68, 0.9), 0 0 8px 2px rgba(239, 68, 68, 0.7)" }} />
                    <span><strong>Red Shadow Ring:</strong> Last transaction ended with ERROR status</span>
                  </div>
                  <div className="info-rule">
                    <span className="info-dot" style={{ background: "#f97316", boxShadow: "0 0 3px rgba(249, 115, 22, 0.9)" }} />
                    <span><strong>Orange Inner Dot:</strong> High transaction rate (Tx/s ≥ {tpsInnerDotThreshold}) or busy threshold exceeded</span>
                  </div>
                </div>
              </div>
            ) : groupBy === "tid" ? (
              <div className="info-content">
                <div className="info-section">
                  <div className="info-section-title">Transaction ID (TID) View</div>
                  <div className="info-rule">
                    <span><strong>Each row:</strong> A unique transaction identified by its TID</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Duration:</strong> Time from first packet to last packet (or end of linger period)</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Status indicator:</strong> Shows transaction state (running, success, error, failed)</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Filter:</strong> Search by TID, Eid, Fid, Uid, hostname, Status, message type, or message content</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Show if ≥:</strong> Hide transactions shorter than threshold duration</span>
                  </div>
                </div>
              </div>
            ) : groupBy === "bid" ? (
              <div className="info-content">
                <div className="info-section">
                  <div className="info-section-title">Business ID (BID) View</div>
                  <div className="info-rule">
                    <span><strong>Groups transactions:</strong> All transactions for the same BID are collected</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Longest duration:</strong> Displayed for each BID group to show slowest transaction</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Expand/collapse:</strong> Click BID to show/hide all transactions in that group</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Hide BID:</strong> Right-click or use menu to hide specific BIDs; use "Clear" to restore</span>
                  </div>
                </div>
              </div>
            ) : groupBy === "drilldown" ? (
              <div className="info-content">
                <div className="info-section">
                  <div className="info-section-title">Process Drilldown View</div>
                  <div className="info-rule">
                    <span><strong>Host columns:</strong> Each column represents one server host</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Each row:</strong> A process identified by EID (Enterprise ID)</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Columns show:</strong> PID, Transaction count, Tx/s, %Busy, latest TID, Status, Mtp, Fid, Uid, first seen time, duration, and message</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Status dots:</strong> Green (idle), Red (busy), Dark Green (stale), Grey (dead)</span>
                  </div>
                  <div className="info-rule">
                    <span><strong>Resize columns:</strong> Drag column borders to adjust widths</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="info-content">
                <div style={{ padding: "16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
                  Info available for all views
                </div>
              </div>
            )}
          </div>
        )}
        </div>{/* app-body */}
      </div>{/* app-container */}

      {serverStats && <StatsOverlay stats={serverStats} onClick={() => { setShowClients((v) => !v); setShowSettings(false); }} />}
    </div>
  );
}
