import { useState } from "react";
import { getLicense } from "../../api/licenses.js";
import { useDetailPanelState } from "../../hooks/useDetailPanelState.js";
import LicenseEditForm from "./detail/LicenseEditForm.jsx";
import MaintenanceSection from "./detail/MaintenanceSection.jsx";
import DocumentsSection from "./detail/DocumentsSection.jsx";
import PluginSuggestionsSection from "./detail/PluginSuggestionsSection.jsx";
import CompletenessFlagsSection from "./detail/CompletenessFlagsSection.jsx";
import IdentitySection from "./detail/IdentitySection.jsx";
import RenewalWorkflowSection from "./detail/RenewalWorkflowSection.jsx";
import ContractDatesSection from "./detail/ContractDatesSection.jsx";
import CommercialSection from "./detail/CommercialSection.jsx";
import PeopleSection from "./detail/PeopleSection.jsx";
import EmailPublisherAction from "./detail/EmailPublisherAction.jsx";
import { NotesSection, CatchallCustomFieldsSection } from "./detail/NotesSection.jsx";
import HistorySection from "./detail/HistorySection.jsx";
import FieldEditModal from "./FieldEditModal.jsx";
import MaintenanceCreateModal from "./MaintenanceCreateModal.jsx";
import LegacyMaintenanceLinkModal from "./LegacyMaintenanceLinkModal.jsx";
import InvoiceNumbersModal from "./InvoiceNumbersModal.jsx";
import SecondaryContactsModal from "./SecondaryContactsModal.jsx";
import Icon from "../ui/Icon.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { supportsMaintenanceCoverage } from "../../utils/maintenanceCoverage.js";

function DetailPanelHeader({ canEdit, editingLicense, onStartEdit, onClose }) {
  return (
    <div className="dp-panel-header">
      <span className="dp-panel-header-title">License Details</span>
      <div className="dp-panel-header-actions">
        {canEdit && !editingLicense && (
          <button className="btn btn-g btn-sm" onClick={onStartEdit}>
            <Icon name="edit" size={12} /> Edit
          </button>
        )}
        <button className="modal-close" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
    </div>
  );
}

function DetailToast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className="dp-toast">
      <Icon name="check" size={14} color="var(--green-text)" />
      <span style={{ flex: 1 }}>{toast}</span>
      <button onClick={onClose} className="dp-toast-close" aria-label="Close"><Icon name="x" size={12} /></button>
    </div>
  );
}

export default function DetailPanel({ license, userSettings, globalSettings, user, allLicenses, sourcingItems, pendingOrders, contracts, onClose, onUpdate, onPoTotalOverride, onDelete, onCreateRenewal, onCreateRenewalBundle, onCancelRenewal, onNavigateToSourcing, onNavigateToPendingOrder, onNavigateToContract, onCreateContract, onNavigate, onPreviewDocument }) {
  const {
    confirmAction, setConfirmAction,
    showMaintenanceModal, setShowMaintenanceModal,
    fieldEdit, openFieldEdit, closeFieldEdit, handleFieldSaved,
    invoiceNumbersEdit, openInvoiceNumbersEdit, closeInvoiceNumbersEdit,
    secondaryContactsEdit, openSecondaryContactsEdit, closeSecondaryContactsEdit,
    toast, setToast,
    editingLicense, setEditingLicense,
    editFields, setEditFields,
    savingLicense, noticeActionBusy, editError,
    displayUnitPrice, setDisplayUnitPrice,
    handleFullEditSave, handleStartFullEdit, handleMarkNoticeHandled,
    openSections, setOpenSections, toggleSection,
    maintenanceHistory, setMaintenanceHistory,
    coverageHistory,
    historyLoading,
    fetchMaintenanceHistory,
    documents, docsLoading, uploadingCategory, docCount, docAvailabilitySummary,
    documentActions, documentActionBusy,
    processingResults, processingResultHistory, processingResultsLoading, processingRequestPending, processingReviewBusy,
    handleFileUpload, handleFileRemove, handleFileDownload, handleFilePreview, handleDocumentAction,
    handleAcceptProcessingResult, handleRejectProcessingResult,
    pluginSuggestions, pluginSuggestionsLoading, pluginSuggestionReviewBusy,
    handleAcceptPluginSuggestion, handleRejectPluginSuggestion,
    customFieldValues, customFieldsLoading,
    cfBySection,
    makeCustomFieldSaveFn,
    comp, exp, perms, vis,
  } = useDetailPanelState({ license, onUpdate, onClose, userSettings, globalSettings, user, onPreviewDocument });
  const [showLegacyLinkModal, setShowLegacyLinkModal] = useState(false);
  const canDownloadDocuments = user?.role !== "viewer" || user?.allowDownloads !== false;

  const notesPreview = license.notes
    ? license.notes.slice(0, 60) + (license.notes.length > 60 ? "..." : "")
    : null;

  return (
    <div className="dpanel">

      {/* Panel Header (always visible) */}
      <DetailPanelHeader
        canEdit={perms.canEdit}
        editingLicense={editingLicense}
        onStartEdit={handleStartFullEdit}
        onClose={onClose}
      />

      {/* Scrollable body */}
      <div className="dp-sections">

        <DetailToast toast={toast} onClose={() => setToast(null)} />

        {editingLicense ? (
          <LicenseEditForm
            editFields={editFields}
            setEditFields={setEditFields}
            editError={editError}
            savingLicense={savingLicense}
            displayUnitPrice={displayUnitPrice}
            setDisplayUnitPrice={setDisplayUnitPrice}
            userSettings={userSettings}
            onSave={handleFullEditSave}
            onCancel={() => setEditingLicense(false)}
          />
        ) : (
          <>
            <IdentitySection
              license={license}
              perms={perms}
              userSettings={userSettings}
              globalSettings={globalSettings}
              exp={exp}
              comp={comp}
              vis={vis}
              isOpen={openSections.identity}
              onToggle={toggleSection}
              onNavigate={onNavigate}
              openFieldEdit={openFieldEdit}
              cfBySection={cfBySection}
              customFieldValues={customFieldValues}
              customFieldsLoading={customFieldsLoading}
              makeCustomFieldSaveFn={makeCustomFieldSaveFn}
              closeFieldEdit={closeFieldEdit}
              onLinkLegacyMaintenance={() => setShowLegacyLinkModal(true)}
            />

            {/* Renewal / coterm blocks - always visible, between Identity and Dates */}
            <RenewalWorkflowSection
              license={license}
              perms={perms}
              exp={exp}
              allLicenses={allLicenses}
              sourcingItems={sourcingItems}
              pendingOrders={pendingOrders}
              globalSettings={globalSettings}
              userSettings={userSettings}
              onCreateRenewal={onCreateRenewal}
              onCreateRenewalBundle={onCreateRenewalBundle}
              onCancelRenewal={onCancelRenewal}
              onNavigate={onNavigate}
              onNavigateToSourcing={onNavigateToSourcing}
              onNavigateToPendingOrder={onNavigateToPendingOrder}
              setToast={setToast}
            />

            <ContractDatesSection
              license={license}
              perms={perms}
              userSettings={userSettings}
              isOpen={openSections.dates}
              onToggle={toggleSection}
              contracts={contracts}
              onNavigateToContract={onNavigateToContract}
              onCreateContract={onCreateContract}
              openFieldEdit={openFieldEdit}
              onMarkNoticeHandled={handleMarkNoticeHandled}
              noticeActionBusy={noticeActionBusy}
              openInvoiceNumbersEdit={openInvoiceNumbersEdit}
              cfBySection={cfBySection}
              customFieldValues={customFieldValues}
              vis={vis}
              customFieldsLoading={customFieldsLoading}
              makeCustomFieldSaveFn={makeCustomFieldSaveFn}
              closeFieldEdit={closeFieldEdit}
            />

            {/* Maintenance */}
            {supportsMaintenanceCoverage(license.licenseType) && (
              <MaintenanceSection
                license={license}
                perms={perms}
                userSettings={userSettings}
                isOpen={openSections.maintenance}
                onToggle={toggleSection}
                maintenanceHistory={maintenanceHistory}
                coverageHistory={coverageHistory}
                setMaintenanceHistory={setMaintenanceHistory}
                historyLoading={historyLoading}
                setShowMaintenanceModal={setShowMaintenanceModal}
                onNavigate={onNavigate}
                onUpdate={onUpdate}
                setToast={setToast}
                cfBySection={cfBySection}
                customFieldValues={customFieldValues}
                vis={vis}
                openFieldEdit={openFieldEdit}
                makeCustomFieldSaveFn={makeCustomFieldSaveFn}
                closeFieldEdit={closeFieldEdit}
                customFieldsLoading={customFieldsLoading}
              />
            )}

            {/* Commercial */}
            <CommercialSection
              license={license}
              perms={perms}
              userSettings={userSettings}
              vis={vis}
              isOpen={openSections.commercial}
              onToggle={toggleSection}
              allLicenses={allLicenses}
              onPoTotalOverride={onPoTotalOverride}
              openFieldEdit={openFieldEdit}
              cfBySection={cfBySection}
              customFieldValues={customFieldValues}
              customFieldsLoading={customFieldsLoading}
              makeCustomFieldSaveFn={makeCustomFieldSaveFn}
              closeFieldEdit={closeFieldEdit}
            />

            {/* People & Org */}
            <PeopleSection
              license={license}
              perms={perms}
              userSettings={userSettings}
              vis={vis}
              isOpen={openSections.people}
              onToggle={toggleSection}
              openFieldEdit={openFieldEdit}
              cfBySection={cfBySection}
              customFieldValues={customFieldValues}
              customFieldsLoading={customFieldsLoading}
              makeCustomFieldSaveFn={makeCustomFieldSaveFn}
              closeFieldEdit={closeFieldEdit}
              openSecondaryContactsEdit={openSecondaryContactsEdit}
              allLicenses={allLicenses}
              onNavigate={onNavigate}
            />

            {/* Documents */}
            <DocumentsSection
              license={license}
              perms={perms}
              userSettings={userSettings}
              isOpen={openSections.documents}
              onToggle={toggleSection}
              documents={documents}
              docsLoading={docsLoading}
              docCount={docCount}
              docAvailabilitySummary={docAvailabilitySummary}
              uploadingCategory={uploadingCategory}
              documentActions={documentActions}
              documentActionBusy={documentActionBusy}
              processingResults={processingResults}
              processingResultHistory={processingResultHistory}
              processingResultsLoading={processingResultsLoading}
              processingRequestPending={processingRequestPending}
              processingReviewBusy={processingReviewBusy}
              handleFileUpload={handleFileUpload}
              handleFileRemove={handleFileRemove}
              handleFileDownload={handleFileDownload}
              handleFilePreview={handleFilePreview}
              handleDocumentAction={handleDocumentAction}
              handleAcceptProcessingResult={handleAcceptProcessingResult}
              handleRejectProcessingResult={handleRejectProcessingResult}
              canDownloadDocuments={canDownloadDocuments}
              cfBySection={cfBySection}
              customFieldValues={customFieldValues}
              vis={vis}
              openFieldEdit={openFieldEdit}
              makeCustomFieldSaveFn={makeCustomFieldSaveFn}
              closeFieldEdit={closeFieldEdit}
              customFieldsLoading={customFieldsLoading}
            />

            {/* Only render the review surface when an Official Extension has produced
                suggestions. Rows are created solely by enabled extensions submitting
                action output, so an empty queue means no extension workflow is active. */}
            {pluginSuggestions.length > 0 && (
              <PluginSuggestionsSection
                license={license}
                perms={perms}
                isOpen={openSections.pluginSuggestions}
                onToggle={toggleSection}
                suggestions={pluginSuggestions}
                loading={pluginSuggestionsLoading}
                reviewBusy={pluginSuggestionReviewBusy}
                onAccept={handleAcceptPluginSuggestion}
                onReject={handleRejectPluginSuggestion}
                cfBySection={cfBySection}
                customFieldValues={customFieldValues}
              />
            )}

            {/* Completeness & Flags */}
            <CompletenessFlagsSection
              license={license}
              perms={perms}
              comp={comp}
              isOpen={openSections.completeness}
              onToggle={toggleSection}
              onUpdate={onUpdate}
            />

            {/* Notes */}
            <NotesSection
              license={license}
              perms={perms}
              userSettings={userSettings}
              vis={vis}
              isOpen={openSections.notes}
              onToggle={toggleSection}
              notesPreview={notesPreview}
              openFieldEdit={openFieldEdit}
              cfBySection={cfBySection}
              customFieldValues={customFieldValues}
              customFieldsLoading={customFieldsLoading}
              makeCustomFieldSaveFn={makeCustomFieldSaveFn}
              closeFieldEdit={closeFieldEdit}
            />

            {/* Custom Fields */}
            <CatchallCustomFieldsSection
              license={license}
              perms={perms}
              userSettings={userSettings}
              vis={vis}
              isOpen={openSections.customFields}
              onToggle={toggleSection}
              cfBySection={cfBySection}
              customFieldValues={customFieldValues}
              customFieldsLoading={customFieldsLoading}
              openFieldEdit={openFieldEdit}
              makeCustomFieldSaveFn={makeCustomFieldSaveFn}
              closeFieldEdit={closeFieldEdit}
            />

            <HistorySection
              license={license}
              userSettings={userSettings}
              isOpen={openSections.history}
              onToggle={toggleSection}
              onNavigateToSourcing={onNavigateToSourcing}
              onNavigateToPendingOrder={onNavigateToPendingOrder}
            />
          </>
        )}

        {/* Bottom actions */}
        <div className="dp-bottom-actions" style={{ marginTop: 16 }}>
          <EmailPublisherAction license={license} allLicenses={allLicenses} />
          {perms.canDelete && <button className="btn btn-d" onClick={() => {
            const activeMaintenanceChildren = (allLicenses || []).filter(
              (l) => (
                (l.parentLicenseId === license.id ||
                  (l.maintenanceParentIds || []).some((parentId) => Number(parentId) === Number(license.id))) &&
                l.licenseType === "maintenance" &&
                !l.isRetired
              )
            );
            const hasActiveMaintenance = activeMaintenanceChildren.length > 0;
            setConfirmAction({
              title: "Delete License",
              message: hasActiveMaintenance
                ? `This license has an active maintenance / support contract linked. Deleting it will also retire the linked record(s). This cannot be undone.`
                : `Are you sure you want to delete the license for "${license.publisherName} — ${license.softwareDescription}"? All associated documents will also be removed. This action cannot be undone.`,
              confirmLabel: "Delete License",
              danger: true,
              onConfirm: () => { onDelete(license.id); onClose(); },
            });
          }}><Icon name="trash" size={14} /></button>}
        </div>

      </div>{/* end dp-sections */}

      {/* Confirm dialog rendered inside panel */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger={confirmAction.danger}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Add maintenance / support contract modal */}
      {showMaintenanceModal && (
        <MaintenanceCreateModal
          parentLicense={license}
          userSettings={userSettings}
          allLicenses={allLicenses}
          onSuccess={async (parentId) => {
            setShowMaintenanceModal(false);
            const { data: refreshed } = await getLicense(parentId);
            if (refreshed) {
              onUpdate(parentId, refreshed);
            }
            await fetchMaintenanceHistory(parentId);
            setOpenSections((p) => ({ ...p, maintenance: true }));
          }}
          onClose={() => setShowMaintenanceModal(false)}
        />
      )}

      {showLegacyLinkModal && (
        <LegacyMaintenanceLinkModal
          license={license}
          allLicenses={allLicenses}
          onClose={() => setShowLegacyLinkModal(false)}
          onSuccess={async (refreshed, parentId) => {
            setShowLegacyLinkModal(false);
            onUpdate(license.id, refreshed);
            const { data: parent } = await getLicense(parentId);
            if (parent) onUpdate(parentId, parent);
            setToast("Maintenance linked to parent license");
          }}
        />
      )}

      {/* Single-field edit modal */}
      {fieldEdit && (
        <FieldEditModal
          licenseId={license.id}
          fieldKey={fieldEdit.fieldKey}
          fieldLabel={fieldEdit.fieldLabel}
          currentValue={fieldEdit.currentValue}
          inputType={fieldEdit.inputType}
          selectOptions={fieldEdit.selectOptions}
          blankOptionLabel={fieldEdit.blankOptionLabel}
          onSaveFn={fieldEdit.onSaveFn}
          onSave={fieldEdit.onSaveCallback ?? handleFieldSaved}
          onClose={closeFieldEdit}
          userSettings={userSettings}
        />
      )}

      {invoiceNumbersEdit && (
        <InvoiceNumbersModal
          licenseId={license.id}
          invoiceNumbers={license.invoiceNumbers}
          primaryInvoiceNumber={license.invoiceNumber}
          onSave={(updatedLicense) => {
            onUpdate(license.id, updatedLicense);
            closeInvoiceNumbersEdit();
          }}
          onClose={closeInvoiceNumbersEdit}
        />
      )}

      {secondaryContactsEdit && (
        <SecondaryContactsModal
          licenseId={license.id}
          primaryContact={license.budgetOwnerEmail}
          secondaryContacts={license.secondaryContacts}
          onSave={(updatedLicense) => {
            onUpdate(license.id, updatedLicense);
            closeSecondaryContactsEdit();
          }}
          onClose={closeSecondaryContactsEdit}
        />
      )}
    </div>
  );
}
