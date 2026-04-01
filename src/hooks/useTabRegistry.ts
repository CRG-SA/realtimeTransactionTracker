import { useEffect, useRef, useState } from "react";

export type TabInfo = { id: string; openedAt: number; lastSeen: number };

const CHANNEL = "ws-tracker-tabs";
const HEARTBEAT_MS = 2000;
const STALE_MS = 6000;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useTabRegistry() {
  const myId = useRef(makeId());
  const myOpenedAt = useRef(Date.now());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [otherTabs, setOtherTabs] = useState<TabInfo[]>([]);
  const [isFocused, setIsFocused] = useState(() => document.hasFocus());
  const knownRef = useRef<Map<string, TabInfo>>(new Map());

  useEffect(() => {
    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;

    const announce = () => {
      ch.postMessage({ type: "heartbeat", id: myId.current, openedAt: myOpenedAt.current });
    };

    ch.onmessage = (evt) => {
      const { type, id, openedAt } = evt.data;
      if (id === myId.current) return;

      if (type === "heartbeat" || type === "hello") {
        const now = Date.now();
        knownRef.current.set(id, { id, openedAt, lastSeen: now });
        setOtherTabs(Array.from(knownRef.current.values()));
        if (type === "hello") announce();
      } else if (type === "bye") {
        knownRef.current.delete(id);
        setOtherTabs(Array.from(knownRef.current.values()));
      }
    };

    ch.postMessage({ type: "hello", id: myId.current, openedAt: myOpenedAt.current });

    const hb = setInterval(announce, HEARTBEAT_MS);

    const prune = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, tab] of knownRef.current) {
        if (now - tab.lastSeen > STALE_MS) {
          knownRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) setOtherTabs(Array.from(knownRef.current.values()));
    }, HEARTBEAT_MS);

    const onUnload = () => ch.postMessage({ type: "bye", id: myId.current });
    window.addEventListener("beforeunload", onUnload);

    return () => {
      clearInterval(hb);
      clearInterval(prune);
      window.removeEventListener("beforeunload", onUnload);
      ch.postMessage({ type: "bye", id: myId.current });
      ch.close();
    };
  }, []);

  // This tab is the oldest if no other tab has an earlier openedAt
  const isOldestTab = otherTabs.every((t) => t.openedAt >= myOpenedAt.current);

  // Should suppress reconnect: oldest tab, not focused, and there are other tabs open
  const suppressReconnect = isOldestTab && !isFocused && otherTabs.length > 0;

  return { myId: myId.current, otherTabs, isFocused, isOldestTab, suppressReconnect };
}
