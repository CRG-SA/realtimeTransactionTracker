type NumericRowProps = {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  step?: number;
  onChange: (v: number) => void;
};

function NumericRow({ label, value, unit = "", min = 0, step = 1, onChange }: NumericRowProps) {
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <div className="settings-control">
        <button className="settings-btn" onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <span className="settings-value">{value}{unit}</span>
        <button className="settings-btn" onClick={() => onChange(value + step)}>+</button>
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <button
        className={`settings-toggle ${value ? "settings-toggle-on" : "settings-toggle-off"}`}
        onClick={() => onChange(!value)}
      >
        {value ? "On" : "Off"}
      </button>
    </div>
  );
}

type SettingsProps = {
  thresholdSeconds: number; setThresholdSeconds: (v: number) => void;
  staleMinutes: number; setStaleMinutes: (v: number) => void;
  lingerSeconds: number; setLingerSeconds: (v: number) => void;
  autoRemoveOnEnd: boolean; setAutoRemoveOnEnd: (v: boolean) => void;
  tpsInnerDotThreshold: number; setTpsInnerDotThreshold: (v: number) => void;
  busyPctInnerDotThreshold: number; setBusyPctInnerDotThreshold: (v: number) => void;
  busyLingerMs: number; setBusyLingerMs: (v: number) => void;
  busyWindowMs: number; setBusyWindowMs: (v: number) => void;
  busyWindowTxns: number; setBusyWindowTxns: (v: number) => void;
  onClose: () => void;
};

export function SettingsPanel(props: SettingsProps) {
  const {
    thresholdSeconds, setThresholdSeconds,
    staleMinutes, setStaleMinutes,
    lingerSeconds, setLingerSeconds,
    autoRemoveOnEnd, setAutoRemoveOnEnd,
    tpsInnerDotThreshold, setTpsInnerDotThreshold,
    busyPctInnerDotThreshold, setBusyPctInnerDotThreshold,
    busyLingerMs, setBusyLingerMs,
    busyWindowMs, setBusyWindowMs,
    busyWindowTxns, setBusyWindowTxns,
    onClose,
  } = props;

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span className="settings-title">Settings</span>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>

      <div className="settings-section-title">Display</div>
      <NumericRow label="Show if ≥" value={thresholdSeconds} unit="s" min={0} onChange={setThresholdSeconds} />
      <NumericRow label="Stale after" value={staleMinutes} unit="m" min={1} onChange={setStaleMinutes} />
      <ToggleRow label="Auto-remove on end" value={autoRemoveOnEnd} onChange={setAutoRemoveOnEnd} />
      <NumericRow label="Linger after end" value={lingerSeconds} unit="s" min={0} onChange={setLingerSeconds} />

      <div className="settings-section-title">Robot tab — dot indicators</div>
      <NumericRow label="Inner dot Tx/s threshold" value={tpsInnerDotThreshold} min={0} step={0.5} onChange={setTpsInnerDotThreshold} />
      <NumericRow label="Inner dot %Busy threshold" value={busyPctInnerDotThreshold} unit="%" min={0} onChange={setBusyPctInnerDotThreshold} />
      <NumericRow label="Busy linger" value={busyLingerMs} unit="ms" min={0} step={100} onChange={setBusyLingerMs} />

      <div className="settings-section-title">Robot tab — %Busy window</div>
      <NumericRow label="Window duration" value={busyWindowMs / 1000} unit="s" min={1} onChange={(v) => setBusyWindowMs(v * 1000)} />
      <NumericRow label="Window transactions" value={busyWindowTxns} min={1} onChange={setBusyWindowTxns} />
    </div>
  );
}
