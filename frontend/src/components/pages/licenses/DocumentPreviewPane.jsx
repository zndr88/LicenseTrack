import Icon from "../../ui/Icon.jsx";
import { getPreviewFilename } from "../../../utils/documentPreview.js";

export default function DocumentPreviewPane({
  preview,
  onClose,
  onDownload,
}) {
  if (!preview) return null;

  const filename = getPreviewFilename(preview.document);
  const isLoading = preview.loading || !preview.url;

  return (
    <section className="lp-document-preview" aria-label="PDF preview">
      <div className="lp-document-preview-hd">
        <div className="lp-document-preview-title">
          <span>PDF Preview</span>
          <small title={filename}>
            <Icon name="file" size={13} />
            {filename}
          </small>
        </div>
        <div className="lp-document-preview-actions">
          <button
            className="doc-action-btn download"
            title="Download"
            aria-label="Download previewed PDF"
            disabled={!preview.document}
            onClick={() => onDownload(preview.document)}
          >
            <Icon name="download" size={14} />
          </button>
          <button
            className="doc-action-btn"
            title="Close preview"
            aria-label="Close PDF preview"
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
      {isLoading ? (
        <div className="lp-document-preview-loading">
          <Icon name="clock" size={16} />
          <span>Loading preview...</span>
        </div>
      ) : (
        <iframe
          className="lp-document-preview-frame"
          src={preview.url}
          title={`PDF preview: ${filename}`}
        />
      )}
    </section>
  );
}
