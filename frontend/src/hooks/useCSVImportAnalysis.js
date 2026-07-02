import { useEffect, useState } from "react";
import { analyzeImport, executeImport, listImportMappings, previewMappedImport } from "../api/csvImport.js";
import { listCustomFields, createCustomField } from "../api/settings.js";

function isRowResolved(decision) {
  if (!decision) return false;
  if (decision.action === "map") return !!decision.targetField;
  if (decision.action === "create") return !!decision.cfKey;
  if (decision.action === "skip") return true;
  return false;
}

export function useCSVImportAnalysis({ active, setStep, setLoading, setError, onImportComplete, importFormats }) {
  const [analyzeData, setAnalyzeData] = useState(null);
  const [columnDecisions, setColumnDecisions] = useState({});
  const [mappingName, setMappingName] = useState("");
  const [creatingFields, setCreatingFields] = useState(false);
  const [showMatched, setShowMatched] = useState(false);
  const [unmatchedColumns, setUnmatchedColumns] = useState([]);
  const [savedMappings, setSavedMappings] = useState([]);
  const [selectedMappingId, setSelectedMappingId] = useState(null);
  const [loadingMappings, setLoadingMappings] = useState(false);

  useEffect(() => {
    if (!active) return;
    setLoadingMappings(true);
    listImportMappings().then(({ data, error: err }) => {
      setLoadingMappings(false);
      if (!err && data) setSavedMappings(data);
    });
  }, [active]);

  const activeMatchedColumns = (analyzeData?.matchedColumns || [])
    .filter(c => !unmatchedColumns.includes(c.rawHeader));

  const matchedInternalFields = new Set(activeMatchedColumns.map(c => c.internalField));

  const unmatchedColumnObjects = (analyzeData?.matchedColumns || [])
    .filter(c => unmatchedColumns.includes(c.rawHeader))
    .map(c => ({ rawHeader: c.rawHeader, sampleValues: c.sampleValues || [] }));

  const allUnrecognizedColumns = [
    ...(analyzeData?.unrecognizedColumns || []),
    ...unmatchedColumnObjects,
  ];

  const allResolved = analyzeData
    ? Object.values(columnDecisions).every(d => isRowResolved(d))
    : false;

  const buildMappingPayload = () => {
    const mapping = [];
    activeMatchedColumns.forEach(col => {
      mapping.push({ rawHeader: col.rawHeader, target: col.internalField });
    });
    Object.entries(columnDecisions).forEach(([rawHeader, decision]) => {
      if (decision.action === "map" && decision.targetField) {
        mapping.push({ rawHeader, target: decision.targetField });
      } else if (decision.action === "create" && decision.cfKey) {
        mapping.push({ rawHeader, target: decision.cfKey });
      } else if (decision.action === "skip") {
        mapping.push({ rawHeader, target: "skip" });
      }
    });
    return { mapping, mappingName: mappingName.trim() || null };
  };

  const handleAnalyze = async (file) => {
    setLoading(true);
    const { data, error: err } = await analyzeImport(file);
    setLoading(false);
    if (err) { setError(err); return; }
    setAnalyzeData(data);
    const initial = {};
    (data.unrecognizedColumns || []).forEach(col => {
      initial[col.rawHeader] = { action: null, targetField: "", cfName: col.rawHeader, cfType: "text", cfKey: null };
    });
    const presetDecisions = { ...initial };
    if (selectedMappingId) {
      const preset = savedMappings.find(m => m.id === selectedMappingId);
      if (preset && Array.isArray(preset.mapping)) {
        preset.mapping.forEach(entry => {
          if (presetDecisions[entry.rawHeader] === undefined) return;
          if (entry.target === "skip") {
            presetDecisions[entry.rawHeader] = { ...presetDecisions[entry.rawHeader], action: "skip" };
          } else if (entry.target.startsWith("cf_")) {
            presetDecisions[entry.rawHeader] = { ...presetDecisions[entry.rawHeader], action: "create", cfKey: entry.target, cfName: entry.rawHeader, cfType: "text" };
          } else {
            presetDecisions[entry.rawHeader] = { ...presetDecisions[entry.rawHeader], action: "map", targetField: entry.target };
          }
        });
        setMappingName(preset.name);
      }
    }
    setColumnDecisions(presetDecisions);
    setStep("mapping");
  };

  const handleMappedPreview = async (csvFile, setMappedPreviewData) => {
    if (!csvFile || !analyzeData) return;
    const payload = buildMappingPayload();
    setLoading(true);
    const { data, error: err } = await previewMappedImport(csvFile, JSON.stringify(payload), importFormats);
    setLoading(false);
    if (err) { setError(err); return; }
    setMappedPreviewData(data);
    setStep("preview");
  };

  const handleExecuteImport = async (csvFile, skippedRows, setConfirmResult, acknowledgeWarnings = false) => {
    if (!csvFile || !analyzeData) return;
    const payload = buildMappingPayload();
    setStep("importing");
    const { data, error: err } = await executeImport(
      csvFile, JSON.stringify(payload), Array.from(skippedRows), acknowledgeWarnings, importFormats
    );
    if (err) { setError(err); setStep("mapping"); return; }
    setConfirmResult(data);
    setStep("done");
    onImportComplete?.();
  };

  const updateDecision = (rawHeader, updates) => {
    setColumnDecisions(prev => ({ ...prev, [rawHeader]: { ...prev[rawHeader], ...updates } }));
  };

  const handleUnmatch = (col) => {
    setColumnDecisions(prev => ({
      ...prev,
      [col.rawHeader]: { action: null, targetField: "", cfName: col.rawHeader, cfType: "text", cfKey: null },
    }));
    setUnmatchedColumns(prev => [...prev, col.rawHeader]);
  };

  const handleCreateField = async (rawHeader) => {
    const decision = columnDecisions[rawHeader];
    if (!decision) return;
    setCreatingFields(true);
    const { data: defs, error: defsErr } = await listCustomFields();
    const displayOrder = (!defsErr && Array.isArray(defs)) ? defs.length : 0;
    const { data, error: err } = await createCustomField({
      name: decision.cfName, field_type: decision.cfType, display_order: displayOrder,
    });
    setCreatingFields(false);
    if (err) { setError(err); return; }
    updateDecision(rawHeader, { cfKey: data.fieldKey });
  };

  const resetAnalysis = () => {
    setAnalyzeData(null);
    setColumnDecisions({});
    setMappingName("");
    setShowMatched(false);
    setUnmatchedColumns([]);
    setSavedMappings([]);
    setSelectedMappingId(null);
  };

  return {
    savedMappings,
    selectedMappingId,
    setSelectedMappingId,
    loadingMappings,
    analyzeData,
    columnDecisions,
    mappingName,
    setMappingName,
    creatingFields,
    showMatched,
    setShowMatched,
    activeMatchedColumns,
    allUnrecognizedColumns,
    matchedInternalFields,
    allResolved,
    updateDecision,
    handleUnmatch,
    handleCreateField,
    handleAnalyze,
    handleMappedPreview,
    handleExecuteImport,
    resetAnalysis,
  };
}
