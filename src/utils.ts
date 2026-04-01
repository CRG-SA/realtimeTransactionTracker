import type { AppConfig } from "./types";

export const defaultConfig: AppConfig = { wsPort: 8765 };

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

export function buildWsUrl(cfg: AppConfig): string {
  const loc = window.location;
  const isHttps = loc.protocol === "https:";
  const proto = isHttps ? "wss" : "ws";
  const host = cfg.wsHost ?? loc.hostname ?? "localhost";
  const port = cfg.wsPort ?? 8765;
  return `${proto}://${host}:${port}`;
}
