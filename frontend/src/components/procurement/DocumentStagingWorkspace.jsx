import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../ui/Icon.jsx";
import DocumentPreviewPanel from "../ui/DocumentPreviewPanel.jsx";
import LocalDocumentPreviewPanel from "../ui/LocalDocumentPreviewPanel.jsx";
import LicenseFormSection from "../licenses/LicenseFormSection.jsx";
import Toggle from "../ui/Toggle.jsx";
import { formatFileSize } from "../../utils/formatting.js";
import {
  DOCUMENT_CATEGORIES,
  defaultDocumentScope,
  documentFileIconColor,
} from "../../utils/documentCategories.js";
import { getPreviewFilename, isPreviewablePdf } from "../../utils/documentPreview.js";

const categoryFor = (document) => document.category ?? document.documentCategory ?? document.document_category ?? "purchase_order";

export default function DocumentStagingWorkspace({
  attachments,
  categoryScopes,
  documents = [],
  inputIdPrefix,
  onAddFiles,
  onRemoveAttachment,
  onTargetChange,
  onCategoryScopeChange,
  previewDocument,
  onPreviewVisibilityChange,
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
    if (!isPreviewablePdf(document) || !previewDocument) return;
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

  useEffect(() => {
    onPreviewVisibilityChange?.(Boolean(localPreview || storedPreview));
  }, [localPreview, storedPreview, onPreviewVisibilityChange]);

  return (
    <aside className="procurement-document-workspace document-staging-workspace" aria-label="Document workspace">
      <LicenseFormSection
        title={attachments.length ? `Documents · ${attachments.length} ready` : "Documents"}
        icon="upload"
        defaultOpen={defaultOpen}
        className="document-staging-section"
      >
        <p className="document-staging-intro">
          Add everything available now. Set each category to Shared or Single before creating the licenses.
        </p>

        <div className="dp-docs">
        {DOCUMENT_CATEGORIES.map((category) => {
          const staged = attachments.filter((attachment) => attachment.category === category.key);
          const existing = documents.filter((document) => categoryFor(document) === category.key);
          const categoryScope = categoryScopes?.[category.key] ?? defaultDocumentScope(category.key);
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
                <div className="document-staging-scope-toggle">
                  <span className={categoryScope === "license" ? "active" : ""}>Single</span>
                  <Toggle
                    value={categoryScope === "shared"}
                    onChange={(isShared) => onCategoryScopeChange(
                      category.key,
                      isShared ? "shared" : "license",
                    )}
                    ariaLabel={`${category.shortLabel} document scope: ${categoryScope === "shared" ? "Shared" : "Single"}`}
                  />
                  <span className={categoryScope === "shared" ? "active" : ""}>Shared</span>
                </div>
              </div>

              {existing.map((document) => (
                <div key={`existing-${document.id}`} className="doc-file">
                  <div className="doc-file-icon" style={{ background: "var(--bg-3)" }}>
                    <Icon name="file" size={15} color={documentFileIconColor(getPreviewFilename(document))} />
                  </div>
                  <div className="doc-file-info">
                    <div className="doc-file-name">{getPreviewFilename(document)}</div>
                    <div className="doc-file-meta">Already attached · Shared across this PO</div>
                  </div>
                  {isPreviewablePdf(document) && (
                    <div className="doc-file-actions">
                      <button type="button" className="doc-action-btn preview" aria-label={`Preview ${getPreviewFilename(document)}`} onClick={() => openStoredPreview(document)}>
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
                    {(attachment.scope ?? defaultDocumentScope(attachment.category)) === "license" && targetOptions.length > 1 && (
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
            ariaLabel={`${getPreviewFilename(storedPreview.document)} preview`}
            className="document-assisted-preview"
            expanded={expanded}
            filename={getPreviewFilename(storedPreview.document)}
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
