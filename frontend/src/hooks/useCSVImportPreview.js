import { useState } from "react";
import { confirmCsvImport, previewCsvImport } from "../api/csvImport.js";

function rowNeedsMaintenanceParent(row) {
  if (row.licenseType !== "maintenance" || row.importStatus !== "error") return false;
  return (row.validationErrors || []).some((error) => (
    error.includes("parent_license_ref") || error.toLowerCase().includes("maintenance parent")
  ));
}

function rowHasOnlyMaintenanceParentError(row) {
  if (!rowNeedsMaintenanceParent(row)) return false;
  return (row.validationErrors || []).every((error) => (
    error.includes("parent_license_ref") || error.toLowerCase().includes("maintenance parent")
  ));
}

function rowHasMaintenanceParentOverride(row, rowOverrides) {
  const override = rowOverrides[row.rowNumber];
  return rowHasOnlyMaintenanceParentError(row) && (
    override?.action === "import_legacy_unlinked"
    || (override?.action === "link_existing" && Number(override.parentLicenseId) > 0)
  );
}

export function serializeImportRowOverrides(rowOverrides, skippedRows = new Set()) {
  const skipped = new Set(skippedRows);
  return Object.entries(rowOverrides)
    .filter(([rowNumber]) => !skipped.has(Number(rowNumber)))
    .map(([rowNumber, override]) => ({
    rowNumber: Number(rowNumber),
    action: override.action || "link_existing",
    ...(override.parentLicenseId ? { parentLicenseId: Number(override.parentLicenseId) } : {}),
    }));
}

export function useCSVImportPreview({ setStep, setLoading, setError, onImportComplete, importFormats }) {
  const [previewData, setPreviewData] = useState(null);
  const [confirmResult, setConfirmResult] = useState(null);
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const [skippedRows, setSkippedRows] = useState(() => new Set());
  const [rowOverrides, setRowOverrides] = useState({});
  const [referenceOverrides, setReferenceOverrides] = useState({});
  const [updateExisting, setUpdateExisting] = useState(false);

  const duplicateWarningCount = previewData?.rows?.reduce(
    (count, row) => count + (row.duplicateWarnings?.length || 0), 0
  ) || 0;

  const previewRows = previewData?.rows || [];
  const selectableRows = previewRows.filter(row => (
    row.importStatus !== "error" || rowHasMaintenanceParentOverride(row, rowOverrides)
  ));
  const selectedRowNumbers = Array.from(selectedRows);
  const selectedImportableRows = selectedRowNumbers.filter(rowNumber =>
    selectableRows.some(row => row.rowNumber === rowNumber)
  );
  const selectedRowsToSkip = selectedImportableRows.filter(rowNumber => !skippedRows.has(rowNumber));
  const selectedRowsToRestore = selectedImportableRows.filter(rowNumber => skippedRows.has(rowNumber));
  const importableRowsCount = previewData
    ? Math.max(selectableRows.filter(row => !skippedRows.has(row.rowNumber)).length, 0)
    : 0;
  const allSelectableSelected = selectableRows.length > 0
    && selectableRows.every(row => selectedRows.has(row.rowNumber));

  const resetSelection = () => {
    setSelectedRows(new Set());
    setSkippedRows(new Set());
    setRowOverrides({});
    setReferenceOverrides({});
  };

  const setMappedPreviewData = (data) => {
    setPreviewData(data);
    resetSelection();
  };

  const handleFilePreview = async (file, updateExistingOverride = true) => {
    setLoading(true);
    const { data, error: err } = await previewCsvImport(file, importFormats, updateExistingOverride);
    setLoading(false);
    if (err) { setError(err); return; }
    setUpdateExisting((data?.headersFound || []).includes("license_ref") && updateExistingOverride);
    setPreviewData(data);
    resetSelection();
    setStep("preview");
  };

  const handleConfirmImport = async (csvFile, acknowledgeWarnings = false) => {
    if (!csvFile) return;
    setStep("importing");
    const { data, error: err } = await confirmCsvImport(
      csvFile,
      Array.from(skippedRows),
      acknowledgeWarnings,
      importFormats,
      updateExisting,
      serializeImportRowOverrides(rowOverrides, skippedRows),
      Object.values(referenceOverrides),
    );
    if (err) { setError(err); setStep("preview"); return; }
    setConfirmResult(data);
    setStep("done");
    await onImportComplete?.();
  };

  const toggleSelectedRow = (rowNumber) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  };

  const toggleAllSelectableRows = () => {
    setSelectedRows(prev => {
      if (allSelectableSelected) return new Set();
      const next = new Set(prev);
      selectableRows.forEach(row => next.add(row.rowNumber));
      return next;
    });
  };

  const skipRows = (rowNumbers) => {
    setSkippedRows(prev => { const next = new Set(prev); rowNumbers.forEach(r => next.add(r)); return next; });
    setRowOverrides(prev => {
      const next = { ...prev };
      rowNumbers.forEach((rowNumber) => { delete next[rowNumber]; });
      return next;
    });
    setSelectedRows(new Set());
  };

  const restoreRows = (rowNumbers) => {
    setSkippedRows(prev => { const next = new Set(prev); rowNumbers.forEach(r => next.delete(r)); return next; });
    setSelectedRows(new Set());
  };

  const setMaintenanceParentOverride = (rowNumber, parentLicenseId) => {
    const override = typeof parentLicenseId === "object"
      ? parentLicenseId
      : (parentLicenseId ? { action: "link_existing", parentLicenseId: Number(parentLicenseId) } : null);
    if (!override?.action) {
      setSkippedRows(current => {
        const skipped = new Set(current);
        skipped.delete(rowNumber);
        return skipped;
      });
      setSelectedRows(current => {
        const selected = new Set(current);
        selected.delete(rowNumber);
        return selected;
      });
    }
    setRowOverrides(prev => {
      const next = { ...prev };
      if (!override?.action) {
        delete next[rowNumber];
      } else {
        next[rowNumber] = override.action === "import_legacy_unlinked"
          ? { action: "import_legacy_unlinked" }
          : { action: "link_existing", parentLicenseId: override.parentLicenseId ? Number(override.parentLicenseId) : null };
      }
      return next;
    });
  };

  const setMaintenanceParentAction = (rowNumber, action, parentLicenseId) => {
    if (action === "link_existing") {
      setMaintenanceParentOverride(rowNumber, { action, parentLicenseId });
    } else if (action === "import_legacy_unlinked") {
      setMaintenanceParentOverride(rowNumber, { action });
    } else {
      setMaintenanceParentOverride(rowNumber, null);
    }
  };

  const legacyUnlinkedRows = previewRows.filter((row) => (
    row.licenseType === "maintenance"
    && row.importAction !== "update"
    && !skippedRows.has(row.rowNumber)
    && (row.importStatus !== "error" || rowHasOnlyMaintenanceParentError(row))
  ));
  const legacyUnlinkedEligibleCount = legacyUnlinkedRows.length;
  const legacyUnlinkedSelectedCount = Object.entries(rowOverrides).filter(
    ([rowNumber, override]) => override.action === "import_legacy_unlinked" && !skippedRows.has(Number(rowNumber))
  ).length;
  const applyLegacyUnlinkedToEligible = () => {
    legacyUnlinkedRows.forEach((row) => setMaintenanceParentAction(row.rowNumber, "import_legacy_unlinked"));
  };
  const clearLegacyUnlinkedSelections = () => {
    legacyUnlinkedRows.forEach((row) => {
      if (rowOverrides[row.rowNumber]?.action === "import_legacy_unlinked") setMaintenanceParentAction(row.rowNumber, "");
    });
  };

  const resetPreview = () => {
    setPreviewData(null);
    setConfirmResult(null);
    resetSelection();
    setUpdateExisting(false);
  };

  const setReferenceOverride = (candidateKey, override) => {
    setReferenceOverrides((current) => {
      const next = { ...current };
      if (!override?.action) delete next[candidateKey];
      else next[candidateKey] = { candidateKey, ...override };
      return next;
    });
  };

  const handleUpdateExisting = async (csvFile, next) => {
    setUpdateExisting(next);
    await handleFilePreview(csvFile, next);
  };

  return {
    previewData,
    confirmResult,
    setConfirmResult,
    skippedRows,
    rowOverrides,
    referenceOverrides,
    selectedRows,
    duplicateWarningCount,
    importableRowsCount,
    allSelectableSelected,
    selectableRows,
    selectedImportableRows,
    selectedRowsToSkip,
    selectedRowsToRestore,
    updateExisting,
    toggleSelectedRow,
    toggleAllSelectableRows,
    skipRows,
    restoreRows,
    setMaintenanceParentOverride,
    setMaintenanceParentAction,
    applyLegacyUnlinkedToEligible,
    clearLegacyUnlinkedSelections,
    legacyUnlinkedSelectedCount,
    legacyUnlinkedEligibleCount,
    setReferenceOverride,
    handleFilePreview,
    handleConfirmImport,
    handleUpdateExisting,
    setMappedPreviewData,
    resetPreview,
  };
}
