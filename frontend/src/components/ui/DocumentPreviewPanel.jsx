import Icon from "./Icon.jsx";

export default function DocumentPreviewPanel({
  as: Root = "aside",
  ariaLabel = "Attached document preview",
  className = "",
  expanded = false,
  filename,
  kind,
  label = "Document Preview",
  loading = false,
  onClose,
  onDownload,
  onToggleExpanded,
  text = "",
  url,
}) {
  const classes = [
    "lp-document-preview",
    "document-preview-panel",
    expanded ? "is-expanded" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <Root className={classes} aria-label={ariaLabel}>
      <div className="lp-document-preview-hd">
        <div className="lp-document-preview-title">
          <span>{label}</span>
          <small title={filename}>
            <Icon name="file" size={13} />
            {filename}
          </small>
        </div>
        <div className="lp-document-preview-actions">
          {onDownload && (
            <button
              type="button"
              className="doc-action-btn download"
              title="Download"
              aria-label={`Download ${filename}`}
              onClick={onDownload}
            >
              <Icon name="download" size={14} />
            </button>
          )}
          {onToggleExpanded && (
            <button
              type="button"
              className="doc-action-btn"
              title={expanded ? "Restore split view" : "Expand document preview"}
              aria-label={expanded ? "Restore split view" : "Expand document preview"}
              onClick={onToggleExpanded}
            >
              <Icon name={expanded ? "minimize" : "maximize"} size={14} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="doc-action-btn"
              title="Close preview"
              aria-label="Close document preview"
              onClick={onClose}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="document-preview-body lp-document-preview-frame">
        {loading && (
          <div className="lp-document-preview-loading">
            <Icon name="clock" size={16} />
            <span>Loading preview...</span>
          </div>
        )}
        {!loading && kind === "pdf" && url && (
          <iframe title={`Preview of ${filename}`} src={`${url}#zoom=page-width`} />
        )}
        {!loading && kind === "image" && url && (
          <img src={url} alt={`Preview of ${filename}`} />
        )}
        {!loading && kind === "text" && (
          <pre>{text || "Loading document..."}</pre>
        )}
        {!loading && (!kind || ((kind === "pdf" || kind === "image") && !url)) && (
          <div className="document-preview-empty">
            <Icon name="file" size={22} color="var(--text-3)" />
            <span>Preview is not available for this file type.</span>
          </div>
        )}
      </div>
    </Root>
  );
}
