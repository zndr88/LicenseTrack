import { useRef, useState } from "react";
import { useCSVImportAnalysis } from "./useCSVImportAnalysis.js";
import { useCSVImportPreview } from "./useCSVImportPreview.js";

export function useCSVImportState({ onImportComplete, userSettings }) {
  const [step, setStep] = useState("upload");
  const [source, setSource] = useState("standard");
  const [csvFile, setCsvFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [importNumberFormatLocale, setImportNumberFormatLocale] = useState(
    userSettings?.numberFormatLocale ?? "en-US"
  );
  const [importDateFormat, setImportDateFormat] = useState(
    userSettings?.dateFormat ?? "DD/MM/YYYY"
  );
  const fileInputRef = useRef(null);
  const importFormats = {
    numberFormatLocale: importNumberFormatLocale,
    dateFormat: importDateFormat,
  };

  const preview = useCSVImportPreview({
    setStep,
    setLoading,
    setError,
    onImportComplete,
    importFormats,
  });

  const analysis = useCSVImportAnalysis({
    active: source === "external",
    setStep,
    setLoading,
    setError,
    onImportComplete,
    importFormats,
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
    if (source === "external" && analysis.analyzeData) {
      await analysis.handleExecuteImport(csvFile, preview.skippedRows, preview.setConfirmResult, hasImportWarnings);
      return;
    }
    await preview.handleConfirmImport(csvFile, hasImportWarnings);
  };

  const handleMappedPreview = async () => {
    await analysis.handleMappedPreview(csvFile, preview.setMappedPreviewData);
  };

  const onToggleUpdateExisting = async (next) => {
    analysis.setUpdateExisting(next);
    await analysis.handleMappedPreview(csvFile, preview.setMappedPreviewData, next);
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
    handleConfirm,
    updateExisting: analysis.updateExisting,
    onToggleUpdateExisting,
    showUpdateControls: source === "external",

    // Mapping
    analyzeData: analysis.analyzeData,
    columnDecisions: analysis.columnDecisions,
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
