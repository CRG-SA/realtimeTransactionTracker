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
  messages: WireMsg[];
  endAt?: number;
  finalStatus?: string;
};

export type AppConfig = {
  wsPort: number;
  wsHost?: string;
  // Display thresholds
  thresholdSeconds?: number;
  staleMinutes?: number;
  lingerSeconds?: number;
  autoRemoveOnEnd?: boolean;
  // Robot tab dot indicators
  tpsInnerDotThreshold?: number;
  busyPctInnerDotThreshold?: number;
  busyLingerMs?: number;
  // Busy % calculation window
  busyWindowMs?: number;
  busyWindowTxns?: number;
};

export type ServerStats = {
  pkts_per_sec: number;
  rx_total: number;
  udp_drop_interval: number;
  udp_drop_total: number;
  ws_drop_total: number;
  q_size: number;
  clients: number;
  client_ips?: string[];
  my_ip?: string;
};
