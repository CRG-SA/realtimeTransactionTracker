import type { AppConfig } from "./types";

export const defaultConfig: AppConfig = {
  wsPort: 8765,
  thresholdSeconds: 1,
  staleMinutes: 2,
  lingerSeconds: 0,
  autoRemoveOnEnd: true,
  tpsInnerDotThreshold: 1,
  busyPctInnerDotThreshold: 60,
  busyLingerMs: 500,
  busyWindowMs: 30000,
  busyWindowTxns: 10,
};

export async function readRuntimeConfig(): Promise<AppConfig> {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) return defaultConfig;
    const cfg = await res.json();
    return { ...defaultConfig, ...cfg };
  } catch {
    return defaultConfig;
  }
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function colorForSeconds(sec: number, thresholdSeconds: number): string {
  const safeThreshold = Math.max(0, thresholdSeconds || 0);
  const baseRedSeconds = Math.max(safeThreshold + 1, 60);
  const t = clamp((sec - safeThreshold) / (baseRedSeconds - safeThreshold), 0, 1);
  const g0 = { r: 22, g: 163, b: 74 };
  const g1 = { r: 220, g: 38, b: 38 };
  const r = Math.round(g0.r + (g1.r - g0.r) * t);
  const g = Math.round(g0.g + (g1.g - g0.g) * t);
  const b = Math.round(g0.b + (g1.b - g0.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function colorForSecondsHighLoad(sec: number, thresholdSeconds: number): string {
  const safeThreshold = Math.max(0, thresholdSeconds || 0);
  const baseRedSeconds = Math.max(safeThreshold + 1, 60);
  const t = clamp((sec - safeThreshold) / (baseRedSeconds - safeThreshold), 0, 1);
  const g0 = { r: 56, g: 189, b: 248 };
  const g1 = { r: 139, g: 92, b: 246 };
  const r = Math.round(g0.r + (g1.r - g0.r) * t);
  const g = Math.round(g0.g + (g1.g - g0.g) * t);
  const b = Math.round(g0.b + (g1.b - g0.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function human(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const mmm = ms % 1000;
  if (mm !== undefined) return `${mm}m ${ss}s`;
  return `${ss}.${String(Math.floor(mmm / 100)).padStart(1, "0")}s`;
}

export type ProcState = {
  statusUp: string;
  isDied: boolean;
  isCoredump: boolean;
  isShutdown: boolean;
  isTerminal: boolean;
  isError: boolean;
};

export function computeProcState(statusRaw: string | undefined): ProcState {
  const statusUp = (statusRaw ?? "").toUpperCase();
  const isDied = statusUp === "DIED";
  const isCoredump = statusUp === "COREDUMP";
  const isShutdown = statusUp === "SHUTDOWN";
  return {
    statusUp,
    isDied,
    isCoredump,
    isShutdown,
    isTerminal: isDied || isCoredump || isShutdown,
    isError: statusUp === "ERROR",
  };
}

export function dotClassFor(s: ProcState, stale: boolean, busy: boolean): string {
  if (s.isCoredump) return "dot-dead dot-coredump";
  if (s.isDied || s.isShutdown) return "dot-dead";
  if (stale) return "dot-stale";
  if (busy) return "dot-busy";
  return "dot-idle";
}

export function statusLabelFor(s: ProcState, stale: boolean, busy: boolean): string {
  if (s.isCoredump) return "coredump";
  if (s.isDied) return "died";
  if (s.isShutdown) return "shutdown";
  if (stale) return "stale";
  if (busy) return "busy";
  return "idle";
}

export function statusClassFor(s: ProcState, stale: boolean, busy: boolean): string {
  if (s.isCoredump) return "status-coredump";
  if (s.isDied) return "status-died";
  if (s.isShutdown) return "status-shutdown";
  if (stale) return "status-stale";
  if (busy) return "status-busy";
  return "status-idle";
}

export function buildWsUrl(cfg: AppConfig): string {
  const loc = window.location;
  const isHttps = loc.protocol === "https:";
  const proto = isHttps ? "wss" : "ws";
  const host = cfg.wsHost ?? loc.hostname ?? "localhost";
  const port = cfg.wsPort ?? 8765;
  return `${proto}://${host}:${port}`;
}
