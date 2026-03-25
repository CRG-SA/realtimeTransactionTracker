export function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-value" title={v}>{v}</span>
    </div>
  );
}
