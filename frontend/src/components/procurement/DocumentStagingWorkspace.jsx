import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../ui/Icon.jsx";
import DocumentPreviewPanel from "../ui/DocumentPreviewPanel.jsx";
import LocalDocumentPreviewPanel from "../ui/LocalDocumentPreviewPanel.jsx";
import LicenseFormSection from "../licenses/LicenseFormSection.jsx";
import { formatFileSize } from "../../utils/formatting.js";
import {
  DOCUMENT_CATEGORIES,
  documentFileIconColor,
  isProcurementDocumentCategory,
} from "../../utils/documentCategories.js";

const filenameFor = (document) => document.originalFilename ?? document.original_filename ?? "Document";
const categoryFor = (document) => document.category ?? document.documentCategory ?? document.document_category ?? "purchase_order";
const isPdf = (document) => {
  const mimeType = document.mimeType ?? document.mime_type ?? "";
  return mimeType === "application/pdf" || filenameFor(document).toLowerCase().endsWith(".pdf");
};

export default function DocumentStagingWorkspace({
  attachments,
  documents = [],
  inputIdPrefix,
  onAddFiles,
  onRemoveAttachment,
  onTargetChange,
  previewDocument,
  targetOptions = [],
  userSettings,
  defaultOpen = false,
}) {
  const [localPreviewId, setLocalPreviewId] = useState(null);
  const [storedPreview, setStoredPreview] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const previewUrlRef = useRef(null);
  const requestRef = useRef(0);
  const previousAttachmentCountRef = useRef(attachments.length);

  const clearStoredPreview = useCallback(() => {
    requestRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setStoredPreview(null);
    setExpanded(false);
  }, []);

  useEffect(() => () => {
    requestRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (attachments.length > previousAttachmentCountRef.current) {
      setLocalPreviewId(attachments.at(-1)?.id ?? null);
      clearStoredPreview();
    }
    previousAttachmentCountRef.current = attachments.length;
  }, [attachments, clearStoredPreview]);

  const openStoredPreview = async (document) => {
    if (!isPdf(document) || !previewDocument) return;
    setLocalPreviewId(null);
    clearStoredPreview();
    const requestId = ++requestRef.current;
    setStoredPreview({ document, loading: true, url: null });
    const { data, error } = await previewDocument(document.id);
    if (requestId !== requestRef.current) {
      if (data?.url) URL.revokeObjectURL(data.url);
      return;
    }
    if (error || !data?.url) {
      setStoredPreview({ document, loading: false, url: null, error: error ?? "Preview failed" });
      return;
    }
    previewUrlRef.current = data.url;
    setStoredPreview({ document, loading: false, url: data.url });
  };

  const openLocalPreview = (id) => {
    clearStoredPreview();
    setLocalPreviewId(id);
  };

  const localPreview = attachments.find((attachment) => attachment.id === localPreviewId);

  return (
    <aside className="procurement-document-workspace document-staging-workspace" aria-label="Document workspace">
      <LicenseFormSection
        title={attachments.length ? `Documents · ${attachments.length} ready` : "Documents"}
        icon="upload"
        defaultOpen={defaultOpen}
        className="document-staging-section"
      >
        <p className="document-staging-intro">
          Add everything available now. Purchase documents are shared across the batch; license documents stay with one created license.
        </p>

        <div className="dp-docs">
        {DOCUMENT_CATEGORIES.map((category) => {
          const staged = attachments.filter((attachment) => attachment.category === category.key);
          const existing = documents.filter((document) => categoryFor(document) === category.key);
          const shared = isProcurementDocumentCategory(category.key);
          const count = staged.length + existing.length;
          const inputId = `${inputIdPrefix}-${category.key}`;

          return (
            <section key={category.key} className="doc-cat document-staging-category">
              <div className="doc-cat-hd">
                <h5>
                  <Icon name={category.icon} size={13} color={category.color} />
                  {category.label}
                  <span
                    className="doc-count"
                    style={{
                      background: count > 0 ? "var(--green-m)" : "var(--orange-m)",
                      color: count > 0 ? "var(--green-text)" : "var(--orange-text)",
                    }}
                  >
                    {count}
                  </span>
                </h5>
                <span className="document-staging-scope">{shared ? "Shared across PO" : "One license"}</span>
              </div>

              {existing.map((document) => (
                <div key={`existing-${document.id}`} className="doc-file">
                  <div className="doc-file-icon" style={{ background: "var(--bg-3)" }}>
                    <Icon name="file" size={15} color={documentFileIconColor(filenameFor(document))} />
                  </div>
                  <div className="doc-file-info">
                    <div className="doc-file-name">{filenameFor(document)}</div>
                    <div className="doc-file-meta">Already attached · Shared across this PO</div>
                  </div>
                  {isPdf(document) && (
                    <div className="doc-file-actions">
                      <button type="button" className="doc-action-btn preview" aria-label={`Preview ${filenameFor(document)}`} onClick={() => openStoredPreview(document)}>
                        <Icon name="eye" size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {staged.map((attachment) => (
                <div key={attachment.id} className="doc-file document-staging-file">
                  <div className="doc-file-icon" style={{ background: "var(--bg-3)" }}>
                    <Icon name="file" size={15} color={documentFileIconColor(attachment.file.name)} />
                  </div>
                  <div className="doc-file-info">
                    <div className="doc-file-name">{attachment.file.name}</div>
                    <div className="doc-file-meta">{formatFileSize(attachment.file.size, userSettings)} · Ready to upload</div>
                    {!shared && targetOptions.length > 1 && (
                      <label className="document-staging-target">
                        <span>Attach to license</span>
                        <select
                          className="fi fi-select"
                          aria-label={`Attach ${attachment.file.name} to license`}
                          value={String(attachment.targetKey ?? targetOptions[0]?.value ?? "")}
                          onChange={(event) => onTargetChange(attachment.id, event.target.value)}
                        >
                          {targetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="doc-file-actions">
                    <button type="button" className="doc-action-btn preview" aria-label={`Preview ${attachment.file.name}`} onClick={() => openLocalPreview(attachment.id)}>
                      <Icon name="eye" size={14} />
                    </button>
                    <button
                      type="button"
                      className="doc-action-btn remove"
                      aria-label={`Remove ${attachment.file.name}`}
                      onClick={() => {
                        if (localPreviewId === attachment.id) setLocalPreviewId(null);
                        onRemoveAttachment(attachment.id);
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              ))}

              {count === 0 && <div className="doc-empty">No files selected yet</div>}
              <label className="doc-upload-btn" htmlFor={inputId}>
                <Icon name="upload" size={13} />
                Add {category.label.toLowerCase()}
              </label>
              <input
                id={inputId}
                className="document-staging-input"
                type="file"
                multiple
                aria-label={`Upload ${category.shortLabel} Document`}
                accept=".pdf,.png,.jpg,.jpeg,.txt"
                onChange={(event) => {
                  onAddFiles(category.key, Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </section>
          );
        })}
        </div>

        {localPreview && (
          <LocalDocumentPreviewPanel
            ariaLabel={`Attached ${localPreview.file.name} preview`}
            file={localPreview.file}
            label="Staged Document Preview"
            onClose={() => setLocalPreviewId(null)}
          />
        )}
        {storedPreview && (
          <DocumentPreviewPanel
            ariaLabel={`${filenameFor(storedPreview.document)} preview`}
            className="document-assisted-preview"
            expanded={expanded}
            filename={filenameFor(storedPreview.document)}
            kind={storedPreview.error ? null : "pdf"}
            label="Attached Document Preview"
            loading={storedPreview.loading}
            onClose={clearStoredPreview}
            onToggleExpanded={() => setExpanded((value) => !value)}
            url={storedPreview.url}
          />
        )}
      </LicenseFormSection>
    </aside>
  );
}
