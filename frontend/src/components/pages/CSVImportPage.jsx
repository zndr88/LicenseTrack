import { useCSVImportState } from "../../hooks/useCSVImportState.js";
import UploadStep from "../csv-import/UploadStep.jsx";
import PreviewStep from "../csv-import/PreviewStep.jsx";
import MappingStep from "../csv-import/MappingStep.jsx";
import DoneStep from "../csv-import/DoneStep.jsx";

const CSVImportPage = ({
  onImportComplete,
  onGoToLicenses,
  userSettings,
  canManageImportMappings = false,
}) => {
  const state = useCSVImportState({ onImportComplete, userSettings, canManageImportMappings });

  return (
    <>
      <div className="page-header">
        <h2>Import Licenses</h2>
        <p>Import existing licenses from a CSV file. The importer automatically classifies active and legacy records based on their end dates.</p>
      </div>
      <div className="page-content">

        {state.step === "upload" && (
          <UploadStep
            source={state.source}
            setSource={state.setSource}
            savedMappings={state.savedMappings}
            selectedMappingId={state.selectedMappingId}
            setSelectedMappingId={state.setSelectedMappingId}
            loadingMappings={state.loadingMappings}
            importNumberFormatLocale={state.importNumberFormatLocale}
            setImportNumberFormatLocale={state.setImportNumberFormatLocale}
            importDateFormat={state.importDateFormat}
            setImportDateFormat={state.setImportDateFormat}
            error={state.error}
            setError={() => {}}
            dragOver={state.dragOver}
            setDragOver={state.setDragOver}
            loading={state.loading}
            fileInputRef={state.fileInputRef}
            handleFile={state.handleFile}
          />
        )}

        {state.step === "preview" && (
          <PreviewStep
            previewData={state.previewData}
            skippedRows={state.skippedRows}
            selectedRows={state.selectedRows}
            duplicateWarningCount={state.duplicateWarningCount}
            importableRowsCount={state.importableRowsCount}
            allSelectableSelected={state.allSelectableSelected}
            selectableRows={state.selectableRows}
            selectedImportableRows={state.selectedImportableRows}
            selectedRowsToSkip={state.selectedRowsToSkip}
            selectedRowsToRestore={state.selectedRowsToRestore}
            toggleSelectedRow={state.toggleSelectedRow}
            toggleAllSelectableRows={state.toggleAllSelectableRows}
            skipRows={state.skipRows}
            restoreRows={state.restoreRows}
            rowOverrides={state.rowOverrides}
            referenceOverrides={state.referenceOverrides}
            setMaintenanceParentOverride={state.setMaintenanceParentOverride}
            setReferenceOverride={state.setReferenceOverride}
            eligibleMaintenanceParents={state.eligibleMaintenanceParents}
            showUpdateControls={state.showUpdateControls}
            updateExisting={state.updateExisting}
            onToggleUpdateExisting={state.onToggleUpdateExisting}
            handleConfirm={state.handleConfirm}
            reset={state.reset}
          />
        )}

        {state.step === "mapping" && (
          <MappingStep
            analyzeData={state.analyzeData}
            error={state.error}
            showMatched={state.showMatched}
            setShowMatched={state.setShowMatched}
            activeMatchedColumns={state.activeMatchedColumns}
            allUnrecognizedColumns={state.allUnrecognizedColumns}
            matchedInternalFields={state.matchedInternalFields}
            columnDecisions={state.columnDecisions}
            customFieldDefs={state.customFieldDefs}
            allResolved={state.allResolved}
            updateDecision={state.updateDecision}
            handleUnmatch={state.handleUnmatch}
            handleCreateField={state.handleCreateField}
            creatingFields={state.creatingFields}
            loading={state.loading}
            mappingName={state.mappingName}
            setMappingName={state.setMappingName}
            canManageImportMappings={canManageImportMappings}
            canCreateCustomFields={canManageImportMappings}
            handleMappedPreview={state.handleMappedPreview}
            reset={state.reset}
          />
        )}

        {state.step === "importing" && (
          <div className="csv-importing">
            <div className="spinner" style={{ width: 22, height: 22, margin: 0 }} />
            Importing licenses...
          </div>
        )}

        {state.step === "done" && (
          <DoneStep
            confirmResult={state.confirmResult}
            onGoToLicenses={onGoToLicenses}
            reset={state.reset}
          />
        )}

      </div>
    </>
  );
};

export default CSVImportPage;
