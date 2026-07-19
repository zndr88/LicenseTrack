import { useState } from "react";
import { confirmCsvImport, previewCsvImport } from "../api/csvImport.js";

export function useCSVImportPreview({ setStep, setLoading, setError, onImportComplete, importFormats }) {
  const [previewData, setPreviewData] = useState(null);
  const [confirmResult, setConfirmResult] = useState(null);
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const [skippedRows, setSkippedRows] = useState(() => new Set());
  const [updateExisting, setUpdateExisting] = useState(false);

  const duplicateWarningCount = previewData?.rows?.reduce(
    (count, row) => count + (row.duplicateWarnings?.length || 0), 0
  ) || 0;

  const previewRows = previewData?.rows || [];
  const selectableRows = previewRows.filter(row => row.importStatus !== "error");
  const selectedRowNumbers = Array.from(selectedRows);
  const selectedImportableRows = selectedRowNumbers.filter(rowNumber =>
    selectableRows.some(row => row.rowNumber === rowNumber)
  );
  const selectedRowsToSkip = selectedImportableRows.filter(rowNumber => !skippedRows.has(rowNumber));
  const selectedRowsToRestore = selectedImportableRows.filter(rowNumber => skippedRows.has(rowNumber));
  const importableRowsCount = previewData ? Math.max(previewData.validRows - skippedRows.size, 0) : 0;
  const allSelectableSelected = selectableRows.length > 0
    && selectableRows.every(row => selectedRows.has(row.rowNumber));

  const resetSelection = () => {
    setSelectedRows(new Set());
    setSkippedRows(new Set());
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
      csvFile, Array.from(skippedRows), acknowledgeWarnings, importFormats, updateExisting
    );
    if (err) { setError(err); setStep("preview"); return; }
    setConfirmResult(data);
    setStep("done");
    onImportComplete?.();
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
    setSelectedRows(new Set());
  };

  const restoreRows = (rowNumbers) => {
    setSkippedRows(prev => { const next = new Set(prev); rowNumbers.forEach(r => next.delete(r)); return next; });
    setSelectedRows(new Set());
  };

  const resetPreview = () => {
    setPreviewData(null);
    setConfirmResult(null);
    resetSelection();
    setUpdateExisting(false);
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
    handleFilePreview,
    handleConfirmImport,
    handleUpdateExisting,
    setMappedPreviewData,
    resetPreview,
  };
}
