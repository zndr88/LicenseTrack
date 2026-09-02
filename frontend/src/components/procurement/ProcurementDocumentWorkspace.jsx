import { useEffect, useRef, useState } from "react";
import Icon from "../ui/Icon.jsx";
import DocumentPreviewPanel from "../ui/DocumentPreviewPanel.jsx";
import LocalDocumentPreviewPanel from "../ui/LocalDocumentPreviewPanel.jsx";

const filenameFor = (document) => document.originalFilename ?? document.original_filename ?? "Document";
const isPdf = (document) => {
  const mimeType = document.mimeType ?? document.mime_type ?? "";
  return mimeType === "application/pdf" || filenameFor(document).toLowerCase().endsWith(".pdf");
};

export default function ProcurementDocumentWorkspace({
  documents = [],
  file,
  inputId,
  label,
  onFileChange,
  previewDocument,
  children,
}) {
  const documentKind = label.replace(/ Document$/, "");
  const [preview, setPreview] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const previewUrlRef = useRef(null);
  const requestRef = useRef(0);

  const clearPreview = () => {
    requestRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
    setExpanded(false);
  };

  useEffect(() => () => {
    requestRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (file) clearPreview();
  // A selected local file deliberately replaces the stored-document preview.
  }, [file]);

  const openPreview = async (document) => {
    if (!isPdf(document) || !previewDocument) return;
    clearPreview();
    const requestId = ++requestRef.current;
    setPreview({ document, loading: true, url: null });
    const { data, error } = await previewDocument(document.id);
    if (requestId !== requestRef.current) {
      if (data?.url) URL.revokeObjectURL(data.url);
      return;
    }
    if (error || !data?.url) {
      setPreview({ document, loading: false, url: null, error: error ?? "Preview failed" });
      return;
    }
    previewUrlRef.current = data.url;
    setPreview({ document, loading: false, url: data.url });
  };

  return (
    <aside className="procurement-document-workspace" aria-label="Document workspace">
      <div className="procurement-document-workspace-header">
        <Icon name="upload" size={14} color="var(--text-2)" />
        <h3>Documents</h3>
      </div>

      {children && <div className="procurement-document-tools">{children}</div>}

      <div className="procurement-document-upload">
        <Icon name={file ? "file" : "upload"} size={18} color="var(--text-2)" />
        <div className="procurement-document-upload-copy">
          <span>{file ? file.name : `Attach ${label}`}</span>
          <small>PDF, image, or text file</small>
        </div>
        {file ? (
          <button type="button" className="btn btn-g" onClick={() => onFileChange(null)}>Remove</button>
        ) : (
          <label className="btn btn-g" htmlFor={inputId}>Choose file</label>
        )}
        <input
          id={inputId}
          type="file"
          aria-label={`Upload ${label}`}
          accept=".pdf,.png,.jpg,.jpeg,.txt"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
      </div>

      {documents.length > 0 && (
        <div className="procurement-document-list">
          <span className="procurement-document-list-label">Attached to this workflow</span>
          {documents.map((document) => (
            <button
              key={document.id}
              type="button"
              className="procurement-document-row"
              disabled={!isPdf(document)}
              title={isPdf(document) ? `Preview ${filenameFor(document)}` : "Preview is available for PDF documents"}
              onClick={() => openPreview(document)}
            >
              <Icon name="file" size={13} />
              <span>{filenameFor(document)}</span>
              {isPdf(document) && <Icon name="eye" size={13} />}
            </button>
          ))}
        </div>
      )}

      {file && (
        <LocalDocumentPreviewPanel
          ariaLabel={`Attached ${documentKind} preview`}
          file={file}
          label={`${label} Preview`}
        />
      )}
      {preview && (
        <DocumentPreviewPanel
          ariaLabel={`${documentKind} preview`}
          className="document-assisted-preview"
          expanded={expanded}
          filename={filenameFor(preview.document)}
          kind={preview.error ? null : "pdf"}
          label={`${label} Preview`}
          loading={preview.loading}
          onClose={clearPreview}
          onToggleExpanded={() => setExpanded((value) => !value)}
          url={preview.url}
        />
      )}
    </aside>
  );
}
