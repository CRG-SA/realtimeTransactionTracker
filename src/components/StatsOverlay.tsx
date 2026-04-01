import type { ServerStats } from "../types";

export function StatsOverlay({ stats }: { stats: ServerStats }) {
  const hasDrops = stats.udp_drop_total > 0 || stats.ws_drop_total > 0;
  return (
    <div className={`stats-overlay ${hasDrops ? "stats-overlay-warn" : ""}`}>
      <span className="stats-overlay-item">
        {stats.pkts_per_sec.toFixed(1)} <span className="stats-overlay-label">pkt/s</span>
      </span>
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
