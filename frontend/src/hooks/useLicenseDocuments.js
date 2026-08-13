import { useState, useEffect, useRef } from "react";
import {
  getDocuments,
  uploadDocument,
  deleteDocument,
  deleteProcurementDocument,
  downloadDocument,
  downloadProcurementDocument,
  invokeDocumentAction,
  listDocumentActions,
  listDocumentProcessingResults,
  acceptDocumentProcessingResult,
  rejectDocumentProcessingResult,
} from "../api/documents.js";
import { getLicense } from "../api/licenses.js";
import { documentAvailabilityHelp, documentAvailabilitySummary, isFileAvailable } from "../utils/documentAvailability.js";
import { isPreviewablePdf } from "../utils/documentPreview.js";

export function useLicenseDocuments({ license, onUpdate, setConfirmAction, setToast, onProcessingAccepted, onPreviewDocument }) {
  const [documents, setDocuments] = useState(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploadingCategory, setUploadingCategory] = useState(null);
  const [documentActions, setDocumentActions] = useState([]);
  const [documentActionBusy, setDocumentActionBusy] = useState(null);
  const [processingResults, setProcessingResults] = useState([]);
  const [processingResultHistory, setProcessingResultHistory] = useState([]);
  const [processingResultsLoading, setProcessingResultsLoading] = useState(false);
  const [processingReviewBusy, setProcessingReviewBusy] = useState(null);
  const [processingRequestPending, setProcessingRequestPending] = useState(false);
  const processingPollRef = useRef(null);
  const latestLicenseIdRef = useRef(license.id);
  const documentsRequestRef = useRef(0);
  const processingRequestRef = useRef(0);
  latestLicenseIdRef.current = license.id;

  const isStaleDocumentRequest = (licenseId, requestId) =>
    requestId !== documentsRequestRef.current || latestLicenseIdRef.current !== licenseId;

  const stopProcessingPoll = () => {
    if (processingPollRef.current) {
      clearInterval(processingPollRef.current);
      processingPollRef.current = null;
    }
  };

  const loadDocuments = async () => {
    const licenseId = license.id;
    const requestId = ++documentsRequestRef.current;
    setDocsLoading(true);
    const { data } = await getDocuments(licenseId);
    if (isStaleDocumentRequest(licenseId, requestId)) return;
    setDocsLoading(false);
    if (data) setDocuments(data);
  };

  const loadProcessingResults = async ({ showLoading = true } = {}) => {
    const licenseId = license.id;
    const requestId = ++processingRequestRef.current;
    if (showLoading) setProcessingResultsLoading(true);
    const { data } = await listDocumentProcessingResults({ licenseId });
    if (requestId !== processingRequestRef.current || latestLicenseIdRef.current !== licenseId) return [];
    if (showLoading) setProcessingResultsLoading(false);
    if (data) {
      const pending = data.filter((result) => result.status === "pending");
      const history = data.filter((result) => result.status !== "pending");
      setProcessingResults(pending);
      setProcessingResultHistory(history);
      if (pending.length > 0) {
        setProcessingRequestPending(false);
        stopProcessingPoll();
      }
    }
    return data?.filter((result) => result.status === "pending") || [];
  };

  useEffect(() => {
    stopProcessingPoll();
    setDocuments(null);
    setProcessingResults([]);
    setProcessingResultHistory([]);
    setProcessingRequestPending(false);
    loadDocuments();
    loadProcessingResults();
  }, [license.id]); // eslint-disable-line react-hooks/exhaustive-deps -- license-scoped fetch guarded by request refs

  useEffect(() => {
    listDocumentActions().then(({ data }) => {
      if (data) setDocumentActions(data);
    });
  }, []);

  useEffect(() => () => {
    if (processingPollRef.current) {
      clearInterval(processingPollRef.current);
      processingPollRef.current = null;
    }
  }, []);

  const pollProcessingResults = () => {
    stopProcessingPoll();
    let attempts = 0;
    processingPollRef.current = setInterval(async () => {
      attempts += 1;
      const data = await loadProcessingResults({ showLoading: false });
      if (data.length > 0 || attempts >= 12) {
        setProcessingRequestPending(false);
        stopProcessingPoll();
      }
    }, 5000);
  };

  const refreshDocumentsAndLicense = async () => {
    const licenseId = license.id;
    const requestId = ++documentsRequestRef.current;
    const { data } = await getDocuments(licenseId);
    const { data: freshLicense } = await getLicense(licenseId);
    if (isStaleDocumentRequest(licenseId, requestId)) return;
    await loadProcessingResults();
    if (isStaleDocumentRequest(licenseId, requestId)) return;
    if (data) {
      setDocuments(data);
      const summary = documentAvailabilitySummary(data);
      onUpdate(licenseId, {
        documentCount: summary.total,
        availableDocumentCount: summary.available,
        missingDocumentCount: summary.missing,
        unavailableDocumentCount: summary.unavailable,
        completenessPct: freshLicense?.completenessPct,
      });
    }
  };

  const refreshAfterProcessingReview = async () => {
    const licenseId = license.id;
    const { data: freshLicense } = await getLicense(licenseId);
    if (latestLicenseIdRef.current !== licenseId) return;
    if (freshLicense) onUpdate(licenseId, freshLicense);
    await loadProcessingResults();
    if (latestLicenseIdRef.current !== licenseId) return;
    await onProcessingAccepted?.();
  };

  const handleFileUpload = (category) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".pdf,.doc,.docx,.txt,.lic,.png,.jpg,.jpeg,.xlsx,.csv";
    input.onchange = async (e) => {
      const files = Array.from(e.target.files);
      setUploadingCategory(category);
      let anyError = null;
      for (const file of files) {
        const { error } = await uploadDocument(license.id, file, category);
        if (error) { anyError = error; break; }
      }
      setUploadingCategory(null);
      if (anyError) {
        setToast(`Upload failed: ${anyError}`);
        return;
      }
      await refreshDocumentsAndLicense();
    };
    input.click();
  };

  const handleFileRemove = (doc) => {
    const sharedBundleWarning = doc?.procurement_bundle_id
      ? " It will be removed from every license in this manual batch."
      : "";
    setConfirmAction({
      title: "Remove Document",
      message: `Are you sure you want to remove "${doc.original_filename}"?${sharedBundleWarning} This action cannot be undone.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        setConfirmAction(null);
        const { error } = doc?.scope === "po"
          ? await deleteProcurementDocument(doc.id)
          : await deleteDocument(doc.id);
        if (!error) {
          await refreshDocumentsAndLicense();
        }
      },
    });
  };

  const handleFileDownload = async (doc) => {
    if (!isFileAvailable(doc)) {
      setToast(documentAvailabilityHelp(doc));
      return;
    }
    const { error } = doc.scope === "po"
      ? await downloadProcurementDocument(doc.id, doc.original_filename)
      : await downloadDocument(doc.id, doc.original_filename);
    if (error) {
      setToast(String(error).includes("document record exists") ? error : `Download failed: ${error}`);
    }
  };

  const handleFilePreview = async (doc) => {
    if (!isPreviewablePdf(doc)) {
      setToast(!isFileAvailable(doc) ? documentAvailabilityHelp(doc) : "Only PDF documents can be previewed.");
      return;
    }
    onPreviewDocument?.(doc);
  };

  const handleDocumentAction = async (action, doc) => {
    const documentType = doc.scope === "po" ? "procurement_document" : "license_document";
    const busyKey = `${action.key}:${documentType}:${doc.id}`;
    setDocumentActionBusy(busyKey);
    const { error } = await invokeDocumentAction(action.key, {
      documentType,
      documentId: doc.id,
    });
    setDocumentActionBusy(null);
    if (error) {
      setToast(`${action.label} failed: ${error}`);
      return;
    }
    setProcessingRequestPending(true);
    const pendingResults = await loadProcessingResults({ showLoading: false });
    if (pendingResults.length === 0) pollProcessingResults();
    setToast(`${action.label} requested.`);
    setTimeout(() => setToast(null), 5000);
  };

  const handleAcceptProcessingResult = async (result, suggestedFieldIndexes = null) => {
    setProcessingReviewBusy(`accept:${result.id}`);
    const { data, error } = await acceptDocumentProcessingResult(result.id, suggestedFieldIndexes);
    setProcessingReviewBusy(null);
    if (error) {
      setToast(`Accept failed: ${error}`);
      return;
    }
    await refreshAfterProcessingReview();
    const fields = data?.appliedFields?.join(", ");
    setToast(fields ? `Applied suggested fields: ${fields}.` : "Suggested fields applied.");
    setTimeout(() => setToast(null), 5000);
  };

  const handleRejectProcessingResult = async (result) => {
    setConfirmAction({
      title: "Reject Suggestions",
      message: "Reject these document processing suggestions? No license fields will be changed.",
      confirmLabel: "Reject",
      danger: true,
      onConfirm: async () => {
        setConfirmAction(null);
        setProcessingReviewBusy(`reject:${result.id}`);
        const { error } = await rejectDocumentProcessingResult(result.id);
        setProcessingReviewBusy(null);
        if (error) {
          setToast(`Reject failed: ${error}`);
          return;
        }
        await loadProcessingResults();
        setToast("Document processing suggestions rejected.");
        setTimeout(() => setToast(null), 5000);
      },
    });
  };

  return {
    documents,
    docsLoading,
    uploadingCategory,
    documentActions,
    documentActionBusy,
    processingResults,
    processingResultHistory,
    processingResultsLoading,
    processingRequestPending,
    processingReviewBusy,
    liveDocs: documents !== null
      ? {
          invoice: documents.filter((d) => d.category === "invoice"),
          quote: documents.filter((d) => d.category === "quote"),
          purchase_order: documents.filter((d) => d.category === "purchase_order"),
          eula: documents.filter((d) => d.category === "eula"),
          entitlement: documents.filter((d) => d.category === "entitlement"),
        }
      : license.documents,
    docCount: documents?.length ?? 0,
    docAvailabilitySummary: documentAvailabilitySummary(documents ?? []),
    handleFileUpload,
    handleFileRemove,
    handleFileDownload,
    handleFilePreview,
    handleDocumentAction,
    handleAcceptProcessingResult,
    handleRejectProcessingResult,
  };
}
