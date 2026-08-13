export default function LicenseAttentionPanel({ attentionItems, setSelectedId, onDismissAll }) {
  if (attentionItems.length === 0) return null;
  return (
    <div className="attention-banner">
      <span className="attention-label">ATTENTION</span>
      <div className="attention-items">
        {attentionItems.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`attention-pill${l.expiration.days < 0 ? " attention-pill--expired" : ""}`}
            onClick={() => setSelectedId(l.id)}
            title="Open license"
          >
            {l.publisherName} — {l.softwareDescription}
            {" · "}
            {l.expiration.days < 0
              ? `expired ${Math.abs(l.expiration.days)}d ago`
              : `expires in ${l.expiration.days}d`}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="attention-dismiss-all"
        aria-label="Dismiss all attention items"
        onClick={() => onDismissAll(attentionItems.map((l) => l.id))}
      >
        dismiss ×
      </button>
    </div>
  );
}
