import DocumentPreviewPanel from "../../ui/DocumentPreviewPanel.jsx";
import { getPreviewFilename } from "../../../utils/documentPreview.js";

export default function DocumentPreviewPane({
  preview,
  onClose,
  onDownload,
}) {
  if (!preview) return null;

  const filename = getPreviewFilename(preview.document);
  return (
    <DocumentPreviewPanel
      as="section"
      ariaLabel="PDF preview"
      filename={filename}
      kind="pdf"
      label="PDF Preview"
      loading={preview.loading || !preview.url}
      onClose={onClose}
      onDownload={preview.document ? () => onDownload(preview.document) : undefined}
      url={preview.url}
    />
  );
}
