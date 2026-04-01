export function SummaryItem({
  label,
  value,
  onMinus,
  onPlus, 
  toggle,
}: {
  label: string;
  value: string;
  onMinus?: (() => void) | undefined;
  onPlus?: (() => void) | undefined;
  toggle?: (() => void) | undefined;
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
          <button className="mini-btn" onClick={onMinus}>–</button>
        )}
        {!isDisabled && onPlus && (
          <button className="mini-btn" onClick={onPlus}>+</button>
        )}
      </div>
    </div>
  );
}
