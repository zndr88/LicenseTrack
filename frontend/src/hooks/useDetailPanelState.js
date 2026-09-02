import { useState, useEffect, useRef } from "react";
import { formatPriceInput, getCompleteness, getExpirationPresentation, normalizeLicense } from "../utils/helpers.js";
import { ROLE_PERMISSIONS } from "../constants/permissions.js";
import {
  getLicense,
  getCoverageHistory,
  getMaintenanceForParent,
  markLicenseNoticeHandled,
  upsertCustomFieldValues,
} from "../api/licenses.js";
import {
  acceptPluginSuggestion,
  listPluginSuggestions,
  rejectPluginSuggestion,
} from "../api/pluginSuggestions.js";
import { useLicenseDocuments } from "./useLicenseDocuments.js";
import { useCustomFields } from "./useCustomFields.js";
import { parseLocalizedNumber } from "../utils/formatting.js";
import { buildCustomFieldValuePayload, customFieldValueMap } from "../utils/customFieldFormValues.js";

/**
 * Encapsulates all state, effects, handlers, and derived values for DetailPanel.
 * The component itself is left as a pure render layer.
 */
export function useDetailPanelState({
  license,
  onUpdate,
  userSettings,
  globalSettings,
  user,
  onPreviewDocument,
}) {
  const [confirmAction, setConfirmAction] = useState(null);
  const [fieldEdit, setFieldEdit] = useState(null);
  const [invoiceNumbersEdit, setInvoiceNumbersEdit] = useState(false);
  const [secondaryContactsEdit, setSecondaryContactsEdit] = useState(false);
  const [displayUnitPrice, setDisplayUnitPrice] = useState("");
  const [editingLicense, setEditingLicense] = useState(false);
  const [editFields, setEditFields] = useState({});
  const [savingLicense, setSavingLicense] = useState(false);
  const [noticeActionBusy, setNoticeActionBusy] = useState(false);
  const [editError, setEditError] = useState(null);
  const [toast, setToast] = useState(null);

  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceHistory, setMaintenanceHistory] = useState([]);
  const [coverageHistory, setCoverageHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const latestLicenseIdRef = useRef(license.id);
  const maintenanceRequestRef = useRef(0);
  const pluginSuggestionsRequestRef = useRef(0);
  latestLicenseIdRef.current = license.id;

  const [openSections, setOpenSections] = useState({
    identity:     true,
    dates:        false,
    maintenance:  false,
    commercial:   false,
    people:       false,
    documents:    false,
    pluginSuggestions: false,
    completeness: false,
    notes:        false,
    customFields: false,
    history:      false,
  });

  const fetchMaintenanceHistory = async (id) => {
    if (!["perpetual", "oem", "freeware"].includes(license.licenseType)) return;
    const targetId = id ?? license.id;
    const requestId = ++maintenanceRequestRef.current;
    setHistoryLoading(true);
    const [{ data }, { data: coverageData }] = await Promise.all([
      getMaintenanceForParent(targetId),
      getCoverageHistory(targetId),
    ]);
    if (requestId !== maintenanceRequestRef.current || latestLicenseIdRef.current !== targetId) return;
    setHistoryLoading(false);
    if (data) setMaintenanceHistory(data);
    if (coverageData) setCoverageHistory(coverageData);
  };

  const toggleSection = (key) =>
    setOpenSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === "maintenance" && next.maintenance && maintenanceHistory.length === 0) {
        fetchMaintenanceHistory(license.id);
      }
      return next;
    });

  useEffect(() => {
    setMaintenanceHistory([]);
    setCoverageHistory([]);
    setHistoryLoading(false);
    setShowMaintenanceModal(false);
  }, [license.id]);

  // Custom fields
  const {
    customFieldValues,
    customFieldDefs,
    setCustomFieldValues,
    refreshCustomFields,
    customFieldsBySection,
    customFieldsLoading,
  } = useCustomFields(license?.id);

  // Document management
  const {
    documents,
    docsLoading,
    uploadingCategory,
    liveDocs,
    docCount,
    docAvailabilitySummary,
    documentActions,
    documentActionBusy,
    processingResults,
    processingResultHistory,
    processingResultsLoading,
    processingRequestPending,
    processingReviewBusy,
    handleFileUpload,
    handleFileRemove,
    handleFileDownload,
    handleFilePreview,
    handleDocumentAction,
    handleAcceptProcessingResult,
    handleRejectProcessingResult,
  } = useLicenseDocuments({
    license,
    onUpdate,
    setConfirmAction,
    setToast,
    onProcessingAccepted: refreshCustomFields,
    onPreviewDocument,
  });

  const [pluginSuggestions, setPluginSuggestions] = useState([]);
  const [pluginSuggestionsLoading, setPluginSuggestionsLoading] = useState(false);
  const [pluginSuggestionReviewBusy, setPluginSuggestionReviewBusy] = useState(null);

  const loadPluginSuggestions = async ({ showLoading = true } = {}) => {
    const licenseId = license.id;
    const requestId = ++pluginSuggestionsRequestRef.current;
    if (showLoading) setPluginSuggestionsLoading(true);
    const { data } = await listPluginSuggestions({ licenseId });
    if (requestId !== pluginSuggestionsRequestRef.current || latestLicenseIdRef.current !== licenseId) return [];
    if (showLoading) setPluginSuggestionsLoading(false);
    if (data) {
      const pending = data.filter((suggestion) => suggestion.status === "pending");
      setPluginSuggestions(pending);
      if (pending.length > 0) {
        setOpenSections((prev) => (
          prev.pluginSuggestions ? prev : { ...prev, pluginSuggestions: true }
        ));
      }
      return pending;
    }
    return [];
  };

  useEffect(() => {
    setPluginSuggestions([]);
    loadPluginSuggestions();
  }, [license.id]); // eslint-disable-line react-hooks/exhaustive-deps -- license-scoped fetch guarded by latestLicenseIdRef

  useEffect(() => {
    const handlePluginSuggestionsChanged = (event) => {
      const eventLicenseId = event?.detail?.licenseId;
      if (eventLicenseId && Number(eventLicenseId) !== Number(license.id)) return;
      loadPluginSuggestions({ showLoading: false });
    };
    window.addEventListener("plugin-suggestions:changed", handlePluginSuggestionsChanged);
    return () => {
      window.removeEventListener("plugin-suggestions:changed", handlePluginSuggestionsChanged);
    };
  }, [license.id]); // eslint-disable-line react-hooks/exhaustive-deps -- license-scoped listener guarded by latestLicenseIdRef

  const refreshAfterPluginSuggestionReview = async () => {
    const { data: freshLicense } = await getLicense(license.id);
    if (freshLicense) onUpdate(license.id, normalizeLicense(freshLicense));
    await refreshCustomFields();
    await loadPluginSuggestions();
  };

  const handleAcceptPluginSuggestion = async (suggestion, suggestedFieldIndexes = null) => {
    setPluginSuggestionReviewBusy(`accept:${suggestion.id}`);
    const { data, error } = await acceptPluginSuggestion(suggestion.id, suggestedFieldIndexes);
    setPluginSuggestionReviewBusy(null);
    if (error) {
      setToast(`Accept failed: ${error}`);
      return;
    }
    await refreshAfterPluginSuggestionReview();
    const fields = data?.appliedFields?.join(", ");
    setToast(fields ? `Applied Official Extension suggestions: ${fields}.` : "Official Extension suggestions applied.");
    setTimeout(() => setToast(null), 5000);
  };

  const handleRejectPluginSuggestion = async (suggestion) => {
    setConfirmAction({
      title: "Reject Official Extension Suggestions",
      message: "Reject these Official Extension suggestions? No license fields will be changed.",
      confirmLabel: "Reject",
      danger: true,
      onConfirm: async () => {
        setConfirmAction(null);
        setPluginSuggestionReviewBusy(`reject:${suggestion.id}`);
        const { error } = await rejectPluginSuggestion(suggestion.id);
        setPluginSuggestionReviewBusy(null);
        if (error) {
          setToast(`Reject failed: ${error}`);
          return;
        }
        await loadPluginSuggestions();
        setToast("Official Extension suggestions rejected.");
        setTimeout(() => setToast(null), 5000);
      },
    });
  };

  // Derived / computed
  const comp = license.isCompletenessExempt
    ? { percentage: null, checks: [], isComplete: false, isPending: false, isExempt: true }
    : getCompleteness({ ...license, documents: liveDocs }, globalSettings.mandatoryFields);

  const exp = getExpirationPresentation(license);

  const perms = ROLE_PERMISSIONS[user.role];
  const vis = userSettings.visibleInDetail;

  // Field edit modal
  const openFieldEdit = (config) => setFieldEdit(config);
  const closeFieldEdit = () => setFieldEdit(null);
  const openInvoiceNumbersEdit = () => setInvoiceNumbersEdit(true);
  const closeInvoiceNumbersEdit = () => setInvoiceNumbersEdit(false);
  const openSecondaryContactsEdit = () => setSecondaryContactsEdit(true);
  const closeSecondaryContactsEdit = () => setSecondaryContactsEdit(false);

  const handleFieldSaved = (updatedLicense) => {
    if (fieldEdit) {
      onUpdate(license.id, normalizeLicense(updatedLicense));
    }
    closeFieldEdit();
  };

  const handleMarkNoticeHandled = async () => {
    setNoticeActionBusy(true);
    const { data, error } = await markLicenseNoticeHandled(license.id);
    setNoticeActionBusy(false);
    if (error) {
      setToast(`Notice update failed: ${error}`);
      return;
    }
    onUpdate(license.id, normalizeLicense(data));
    setToast("Notice deadline marked handled.");
    setTimeout(() => setToast(null), 5000);
  };

  // Full edit
  const handleFullEditSave = async () => {
    setSavingLicense(true);
    setEditError(null);
    const ok = await onUpdate(license.id, {
      ...editFields,
      secondaryContacts: String(editFields.secondaryContacts || "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
      customFieldValues: buildCustomFieldValuePayload(customFieldDefs, editFields.customFieldValues, userSettings),
    });
    setSavingLicense(false);
    if (ok === false) {
      setEditError("Save failed. Review the message above and try again.");
      return;
    }
    await refreshCustomFields();
    setEditingLicense(false);
  };

  const handleStartFullEdit = () => {
    setEditFields({
      publisherName: license.publisherName || "",
      softwareDescription: license.softwareDescription || "",
      startDate: license.startDate || "",
      endDate: license.endDate || "",
      noticeDate: license.noticeDate || "",
      purchaseDate: license.purchaseDate?.slice?.(0, 10) || "",
      contractNumber: license.contractNumber || "",
      poNumber: license.poNumber || "",
      procurementReference: license.procurementReference || "",
      invoiceNumber: license.invoiceNumber || "",
      externalRef: license.externalRef || "",
      contactEmail: license.contactEmail || "",
      budgetOwnerEmail: license.budgetOwnerEmail || "",
      secondaryContacts: (license.secondaryContacts || []).join(", "),
      supplier: license.supplier || "",
      costCentre: license.costCentre || "",
      licenseType: license.licenseType || "",
      licenseMetric: license.licenseMetric || "",
      portalUrl: license.portalUrl || "",
      quantity: license.quantity || "",
      quantityPerUnit: license.quantityPerUnit || "1",
      skuCode: license.skuCode || "",
      unitPrice: license.unitPrice || "",
      totalPoPrice: license.totalPoPrice || "",
      currency: license.currency || "EUR",
      maintenanceCoverage: license.maintenanceCoverage || "unknown",
      notes: license.notes || "",
      customFieldValues: customFieldValueMap(customFieldValues),
    });
    setDisplayUnitPrice(
      formatPriceInput(license.unitPrice || "", userSettings?.numberFormatLocale ?? "en-US")
    );
    setEditingLicense(true);
  };

  // Custom field save factory
  const makeCustomFieldSaveFn = (fieldDef) => async (rawValue) => {
    const normalizedValue = fieldDef.fieldType === "currency"
      ? (parseLocalizedNumber(rawValue, userSettings) ?? rawValue)
      : rawValue;
    const item =
      fieldDef.fieldType === "currency"
        ? { customFieldDefId: fieldDef.id, valueCurrency: normalizedValue || null }
        : { customFieldDefId: fieldDef.id, valueText: normalizedValue || null };

    const { data, error } = await upsertCustomFieldValues(license.id, { values: [item] });
    if (error) return { data: null, error };

    const updated = data.values ?? [];
    setCustomFieldValues((prev) => {
      const merged = [...prev];
      updated.forEach((uv) => {
        const idx = merged.findIndex((v) => v.customFieldDefId === uv.customFieldDefId);
        if (idx >= 0) merged[idx] = uv;
        else merged.push(uv);
      });
      return merged;
    });

    return { data, error: null };
  };

  return {
    // Modal / action state
    confirmAction, setConfirmAction,
    showMaintenanceModal, setShowMaintenanceModal,

    // Field edit
    fieldEdit, openFieldEdit, closeFieldEdit, handleFieldSaved,
    invoiceNumbersEdit, openInvoiceNumbersEdit, closeInvoiceNumbersEdit,
    secondaryContactsEdit, openSecondaryContactsEdit, closeSecondaryContactsEdit,

    // Toast
    toast, setToast,

    // Full edit
    editingLicense, setEditingLicense,
    editFields, setEditFields,
    savingLicense,
    noticeActionBusy,
    editError,
    displayUnitPrice, setDisplayUnitPrice,
    handleFullEditSave, handleStartFullEdit,
    handleMarkNoticeHandled,

    // Sections
    openSections, setOpenSections, toggleSection,

    // Maintenance history
    maintenanceHistory, setMaintenanceHistory,
    coverageHistory,
    historyLoading,
    fetchMaintenanceHistory,

    // Documents (from useLicenseDocuments)
    documents, docsLoading, uploadingCategory, liveDocs, docCount, docAvailabilitySummary,
    documentActions, documentActionBusy,
    processingResults, processingResultHistory, processingResultsLoading, processingRequestPending, processingReviewBusy,
    handleFileUpload, handleFileRemove, handleFileDownload, handleFilePreview, handleDocumentAction,
    handleAcceptProcessingResult, handleRejectProcessingResult,
    pluginSuggestions, pluginSuggestionsLoading, pluginSuggestionReviewBusy,
    handleAcceptPluginSuggestion, handleRejectPluginSuggestion,

    // Custom fields (from useCustomFields)
    customFieldValues,
    customFieldDefs,
    customFieldsLoading,
    cfBySection: customFieldsBySection,
    makeCustomFieldSaveFn,

    // Computed / derived
    comp, exp, perms, vis,
  };
}
