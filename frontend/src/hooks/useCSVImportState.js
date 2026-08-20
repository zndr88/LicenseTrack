import { useCallback, useEffect, useRef, useState } from "react";
import { getLicenses } from "../api/licenses.js";
import { normalizeNumberFormatOptionValue } from "../constants/numberFormats.js";
import { useCSVImportAnalysis } from "./useCSVImportAnalysis.js";
import { useCSVImportPreview } from "./useCSVImportPreview.js";

export function useCSVImportState({ onImportComplete, userSettings, canManageImportMappings }) {
  const [step, setStep] = useState("upload");
  const [source, setSource] = useState("standard");
  const [csvFile, setCsvFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [importNumberFormatLocale, setImportNumberFormatLocale] = useState(
    normalizeNumberFormatOptionValue(userSettings?.numberFormatLocale)
  );
  const [importDateFormat, setImportDateFormat] = useState(
    userSettings?.dateFormat ?? "DD/MM/YYYY"
  );
  const [eligibleMaintenanceParents, setEligibleMaintenanceParents] = useState([]);
  const fileInputRef = useRef(null);
  const importFormats = {
    numberFormatLocale: importNumberFormatLocale,
    dateFormat: importDateFormat,
  };

  const refreshEligibleMaintenanceParents = useCallback(async () => {
    const { data } = await getLicenses({ includeRetired: false });
    if (!Array.isArray(data)) return;
    setEligibleMaintenanceParents(
      data
        .filter((license) => ["perpetual", "oem", "freeware"].includes(license.licenseType))
        .sort((a, b) => {
          const left = `${a.publisherName || ""} ${a.softwareDescription || ""} ${a.licenseRef || ""}`;
          const right = `${b.publisherName || ""} ${b.softwareDescription || ""} ${b.licenseRef || ""}`;
          return left.localeCompare(right);
        })
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLicenses({ includeRetired: false }).then(({ data }) => {
      if (cancelled || !Array.isArray(data)) return;
      setEligibleMaintenanceParents(
        data
          .filter((license) => ["perpetual", "oem", "freeware"].includes(license.licenseType))
          .sort((a, b) => {
            const left = `${a.publisherName || ""} ${a.softwareDescription || ""} ${a.licenseRef || ""}`;
            const right = `${b.publisherName || ""} ${b.softwareDescription || ""} ${b.licenseRef || ""}`;
            return left.localeCompare(right);
          })
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleImportComplete = useCallback(async () => {
    await onImportComplete?.();
    await refreshEligibleMaintenanceParents();
  }, [onImportComplete, refreshEligibleMaintenanceParents]);

  const preview = useCSVImportPreview({
    setStep,
    setLoading,
    setError,
    onImportComplete: handleImportComplete,
    importFormats,
    canManageImportMappings,
  });

  const analysis = useCSVImportAnalysis({
    active: source === "external",
    setStep,
    setLoading,
    setError,
    onImportComplete: handleImportComplete,
    importFormats,
    canManageImportMappings,
  });

  const handleFile = async (file) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please select a CSV file (.csv extension required)");
      return;
    }
    setError(null);
    setCsvFile(file);

    if (source === "external") {
      await analysis.handleAnalyze(file);
    } else {
      await preview.handleFilePreview(file);
    }
  };

  const handleConfirm = async () => {
    const hasImportWarnings = preview.previewData?.warningSummary?.hasWarnings ?? false;
    const rowOverrides = Object.entries(preview.rowOverrides).map(([rowNumber, override]) => ({
      rowNumber: Number(rowNumber),
      parentLicenseId: override.parentLicenseId,
    }));
    const referenceOverrides = Object.values(preview.referenceOverrides);
    if (source === "external" && analysis.analyzeData) {
      await analysis.handleExecuteImport(
        csvFile,
        preview.skippedRows,
        preview.setConfirmResult,
        hasImportWarnings,
        rowOverrides,
        referenceOverrides,
      );
      return;
    }
    await preview.handleConfirmImport(csvFile, hasImportWarnings);
  };

  const handleMappedPreview = async () => {
    await analysis.handleMappedPreview(csvFile, preview.setMappedPreviewData);
  };

  const onToggleUpdateExisting = async (next) => {
    if (source === "external") {
      analysis.setUpdateExisting(next);
      await analysis.handleMappedPreview(csvFile, preview.setMappedPreviewData, next);
      return;
    }
    await preview.handleUpdateExisting(csvFile, next);
  };

  const reset = () => {
    setStep("upload");
    setCsvFile(null);
    setError(null);
    setDragOver(false);
    preview.resetPreview();
    analysis.resetAnalysis();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return {
    // Step / flow
    step, source, setSource, loading, error, dragOver, setDragOver,
    fileInputRef, handleFile, reset,

    // Upload
    savedMappings: analysis.savedMappings,
    selectedMappingId: analysis.selectedMappingId,
    setSelectedMappingId: analysis.setSelectedMappingId,
    loadingMappings: analysis.loadingMappings,
    importNumberFormatLocale,
    setImportNumberFormatLocale,
    importDateFormat,
    setImportDateFormat,

    // Preview
    previewData: preview.previewData,
    skippedRows: preview.skippedRows,
    rowOverrides: preview.rowOverrides,
    referenceOverrides: preview.referenceOverrides,
    selectedRows: preview.selectedRows,
    duplicateWarningCount: preview.duplicateWarningCount,
    importableRowsCount: preview.importableRowsCount,
    allSelectableSelected: preview.allSelectableSelected,
    selectableRows: preview.selectableRows,
    selectedImportableRows: preview.selectedImportableRows,
    selectedRowsToSkip: preview.selectedRowsToSkip,
    selectedRowsToRestore: preview.selectedRowsToRestore,
    toggleSelectedRow: preview.toggleSelectedRow,
    toggleAllSelectableRows: preview.toggleAllSelectableRows,
    skipRows: preview.skipRows,
    restoreRows: preview.restoreRows,
    setMaintenanceParentOverride: preview.setMaintenanceParentOverride,
    setReferenceOverride: preview.setReferenceOverride,
    handleConfirm,
    updateExisting: source === "external" ? analysis.updateExisting : preview.updateExisting,
    onToggleUpdateExisting,
    showUpdateControls: (preview.previewData?.headersFound || []).includes("license_ref"),
    eligibleMaintenanceParents,

    // Mapping
    analyzeData: analysis.analyzeData,
    columnDecisions: analysis.columnDecisions,
    customFieldDefs: analysis.customFieldDefs,
    mappingName: analysis.mappingName,
    setMappingName: analysis.setMappingName,
    creatingFields: analysis.creatingFields,
    showMatched: analysis.showMatched,
    setShowMatched: analysis.setShowMatched,
    activeMatchedColumns: analysis.activeMatchedColumns,
    allUnrecognizedColumns: analysis.allUnrecognizedColumns,
    matchedInternalFields: analysis.matchedInternalFields,
    allResolved: analysis.allResolved,
    updateDecision: analysis.updateDecision,
    handleUnmatch: analysis.handleUnmatch,
    handleCreateField: analysis.handleCreateField,
    handleMappedPreview,

    // Done
    confirmResult: preview.confirmResult,
  };
}
