import { useMemo } from "react";
import { formatDateTime, formatFileSize } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import CustomFieldRows from "./CustomFieldRows.jsx";
import PluginSlot from "../../plugins/PluginSlot.jsx";
import {
  documentAvailabilityHelp,
  documentAvailabilityLabel,
  isFileAvailable,
} from "../../../utils/documentAvailability.js";
import { isPreviewablePdf } from "../../../utils/documentPreview.js";
import SuggestionReviewCard from "./SuggestionReviewCard.jsx";

const DOC_CATEGORIES = [
  { key: "quote", label: "Quote", icon: "file", color: "var(--purple-text)" },
  { key: "purchase_order", label: "Purchase Order", icon: "file", color: "var(--accent)" },
  { key: "invoice", label: "Invoice", icon: "file", color: "var(--green-text)" },
  { key: "eula", label: "EULA Documents", icon: "shield", color: "var(--green)" },
  { key: "entitlement", label: "Proof of Entitlement / Serial Keys", icon: "key", color: "var(--orange)" },
];

const PROCUREMENT_CATEGORIES = new Set(["quote", "purchase_order", "invoice"]);

function fileIconColor(name) {
  if (name.endsWith(".pdf")) return "var(--red)";
  if (name.endsWith(".txt") || name.endsWith(".lic")) return "var(--text-2)";
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "var(--accent)";
  return "var(--text-3)";
}

function documentTypeFor(doc) {
  return doc.scope === "po" ? "procurement_document" : "license_document";
}

function formatProcessingStatus(status) {
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  if (status === "superseded") return "Superseded";
  return "Pending";
}

export default function DocumentsSection({
  license,
  perms,
  userSettings,
  isOpen,
  onToggle,
  documents,
  docsLoading,
  docCount,
  uploadingCategory,
  documentActions = [],
  documentActionBusy,
  processingResults = [],
  processingResultHistory = [],
  processingResultsLoading = false,
  processingRequestPending = false,
  processingReviewBusy,
  handleFileUpload,
  handleFileRemove,
  handleFileDownload,
  handleFilePreview,
  handleDocumentAction,
  handleAcceptProcessingResult,
  handleRejectProcessingResult,
  canDownloadDocuments = true,
  cfBySection,
  customFieldValues,
  vis,
  openFieldEdit,
  makeCustomFieldSaveFn,
  closeFieldEdit,
  customFieldsLoading,
}) {
  const customFieldDefs = useMemo(
    () => Object.values(cfBySection || {}).flat(),
    [cfBySection],
  );
  const allProcessingResults = useMemo(
    () => [...processingResults, ...processingResultHistory],
    [processingResults, processingResultHistory],
  );

  const latestProcessingByDocument = useMemo(() => {
    const byDocument = new Map();
    allProcessingResults.forEach((result) => {
      const key = `${result.documentType || result.document_type}:${result.documentId || result.document_id}`;
      if (!byDocument.has(key)) byDocument.set(key, result);
    });
    return byDocument;
  }, [allProcessingResults]);

  return (
    <>
      <DetailSectionHeader sectionKey="documents" isOpen={isOpen} onToggle={onToggle}>
        Documents{docCount > 0 ? ` (${docCount})` : ""}
      </DetailSectionHeader>

      {isOpen && (
        <div className="dp-section-body" id="dp-section-documents">
          <div className="dp-docs">
            {DOC_CATEGORIES.map((cat) => {
              const files = (documents || []).filter((d) => d.category === cat.key);
              const isUploading = uploadingCategory === cat.key;
              const isSharedProcurementCategory = Boolean(
                (license.pendingOrderId || license.procurementBundleId)
                && PROCUREMENT_CATEGORIES.has(cat.key)
              );
              return (
                <div key={cat.key} className="doc-cat">
                  <div className="doc-cat-hd">
                    <h5>
                      <Icon name={cat.icon} size={13} color={cat.color} />
                      {cat.label}
                      <span className="doc-count" style={{
                        background: files.length > 0 ? "var(--green-m)" : "var(--orange-m)",
                        color: files.length > 0 ? "var(--green-text)" : "var(--orange-text)"
                      }}>{files.length}</span>
                    </h5>
                  </div>

                  {files.map((doc) => (
                    <div key={doc.id} className={`doc-file ${isFileAvailable(doc) ? "" : "is-missing"}`}>
                      <div className="doc-file-icon" style={{ background: "var(--bg-3)" }}>
                        <Icon name="file" size={15} color={fileIconColor(doc.original_filename)} />
                      </div>
                      <div className="doc-file-info">
                        <div className="doc-file-title-row">
                          <div className="doc-file-name">{doc.original_filename}</div>
                          {!isFileAvailable(doc) && (
                            <span className="badge badge-orange doc-availability-badge" title={documentAvailabilityHelp(doc)}>
                              {documentAvailabilityLabel(doc)}
                            </span>
                          )}
                        </div>
                        <div className="doc-file-meta">
                          {formatFileSize(doc.file_size, userSettings)} · {formatDateTime(doc.uploaded_at, userSettings)}
                          {latestProcessingByDocument.has(`${documentTypeFor(doc)}:${doc.id}`) && (
                            <span className={`doc-processing-inline-status status-${latestProcessingByDocument.get(`${documentTypeFor(doc)}:${doc.id}`).status}`}>
                              {formatProcessingStatus(latestProcessingByDocument.get(`${documentTypeFor(doc)}:${doc.id}`).status)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="doc-file-actions">
                        {canDownloadDocuments && (
                          <button
                            className="doc-action-btn download"
                            title={isFileAvailable(doc) ? "Download" : documentAvailabilityHelp(doc)}
                            aria-label="Download"
                            disabled={!isFileAvailable(doc)}
                            onClick={() => handleFileDownload(doc)}
                          >
                            <Icon name="download" size={14} />
                          </button>
                        )}
                        {canDownloadDocuments && isPreviewablePdf(doc) && (
                          <button
                            className="doc-action-btn preview"
                            title="Preview"
                            aria-label="Preview"
                            onClick={() => handleFilePreview(doc)}
                          >
                            <Icon name="eye" size={14} />
                          </button>
                        )}
                        {perms.canEdit && documentActions.map((action) => {
                          const documentType = documentTypeFor(doc);
                          const busyKey = `${action.key}:${documentType}:${doc.id}`;
                          const isBusy = documentActionBusy === busyKey;
                          return (
                            <button
                              key={action.key}
                              className="doc-action-btn"
                              title={action.description || action.label}
                              aria-label={action.label}
                              disabled={isBusy}
                              onClick={() => handleDocumentAction(action, doc)}
                            >
                              <Icon name={isBusy ? "clock" : "activity"} size={14} />
                            </button>
                          );
                        })}
                        {perms.canEdit && (
                          <PluginSlot
                            slot="document.row.actions"
                            context={{
                              targetType: documentTypeFor(doc),
                              targetId: doc.id,
                              licenseId: license.id,
                            }}
                          />
                        )}
                        {perms.canEdit && (
                          <button className="doc-action-btn remove" title="Remove" aria-label="Remove" onClick={() => handleFileRemove(doc)}>
                            <Icon name="trash" size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {!docsLoading && files.length === 0 && <div className="doc-empty">No files uploaded yet</div>}
                  {docsLoading && files.length === 0 && <div className="doc-empty">Loading...</div>}

                  {perms.canEdit && (
                    <button className="doc-upload-btn" disabled={!!uploadingCategory} onClick={() => handleFileUpload(cat.key)}>
                      <Icon name={isUploading ? "clock" : "upload"} size={13} />
                      {isUploading
                        ? "Uploading..."
                        : `Upload ${cat.label.toLowerCase()}${isSharedProcurementCategory ? " (shared purchase)" : ""}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {(processingResultsLoading || processingRequestPending || processingResults.length > 0) && (
            <div className="doc-processing-results">
              <div className="doc-processing-hd">
                <Icon name="activity" size={14} />
                <span>Processing Suggestions</span>
              </div>
              {processingResultsLoading && processingResults.length === 0 && (
                <div className="doc-processing-empty">Loading suggestions...</div>
              )}
              {processingRequestPending && !processingResultsLoading && processingResults.length === 0 && (
                <div className="doc-processing-waiting">
                  <Icon name="clock" size={14} />
                  <span>Waiting for processor...</span>
                </div>
              )}
              {processingResults.map((result) => {
                const accepting = processingReviewBusy === `accept:${result.id}`;
                const rejecting = processingReviewBusy === `reject:${result.id}`;
                return (
                  <SuggestionReviewCard
                    key={result.id}
                    item={result}
                    license={license}
                    customFieldValues={customFieldValues}
                    customFieldDefs={customFieldDefs}
                    accepting={accepting}
                    rejecting={rejecting}
                    canEdit={perms.canEdit}
                    onAccept={handleAcceptProcessingResult}
                    onReject={handleRejectProcessingResult}
                    summaryFallback="Document processor suggested changes"
                    summaryMeta={result.capabilityKey}
                    status="Pending review"
                  />
                );
              })}
            </div>
          )}
          {processingResultHistory.length > 0 && (
            <div className="doc-processing-history">
              <div className="doc-processing-hd">
                <Icon name="history" size={14} />
                <span>Recent Processing History</span>
              </div>
              {processingResultHistory.slice(0, 5).map((result) => (
                <div key={result.id} className="doc-processing-history-row">
                  <span className={`doc-processing-history-status status-${result.status}`}>
                    {formatProcessingStatus(result.status)}
                  </span>
                  <span className="doc-processing-history-summary">
                    {result.summary || result.capabilityKey}
                  </span>
                  <span className="doc-processing-history-meta">
                    {result.capabilityKey}
                    {result.reviewedAt && ` · ${formatDateTime(result.reviewedAt, userSettings)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
          <CustomFieldRows
            fieldDefs={cfBySection["documents"] ?? []}
            values={customFieldValues}
            visibleInDetail={vis}
            license={license}
            userSettings={userSettings}
            canEdit={perms.canEdit}
            onOpenFieldEdit={openFieldEdit}
            makeCustomFieldSaveFn={makeCustomFieldSaveFn}
            onCloseFieldEdit={closeFieldEdit}
            loading={customFieldsLoading}
          />
        </div>
      )}
      <div className="dp-section-divider" />
    </>
  );
}
