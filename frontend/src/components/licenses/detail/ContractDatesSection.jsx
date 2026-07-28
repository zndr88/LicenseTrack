// frontend/src/components/licenses/detail/ContractDatesSection.jsx
import { formatDate, formatDateTime } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import CustomFieldRows from "./CustomFieldRows.jsx";

export default function ContractDatesSection({
  license,
  perms,
  userSettings,
  isOpen,
  onToggle,
  contracts,
  onNavigateToContract,
  onCreateContract,
  openFieldEdit,
  onMarkNoticeHandled,
  noticeActionBusy,
  openInvoiceNumbersEdit,
  cfBySection,
  customFieldValues,
  vis,
  customFieldsLoading,
  makeCustomFieldSaveFn,
  closeFieldEdit,
}) {
  const invoiceNumbers = Array.isArray(license.invoiceNumbers)
    ? license.invoiceNumbers.filter(Boolean)
    : (license.invoiceNumber ? [license.invoiceNumber] : []);
  const invoiceCount = invoiceNumbers.length;
  const primaryInvoiceNumber = license.invoiceNumber || invoiceNumbers[0] || "";
  const noticeAfterEnd = Boolean(license.noticeDate && license.endDate && license.noticeDate > license.endDate);
  const noticeHandled = Boolean(license.noticeHandledAt);
  const matchedContract = license.contractNumber
    ? (contracts ?? []).find(
        (c) => c.contractNumber?.toLowerCase() === license.contractNumber?.toLowerCase()
      )
    : null;

  return (
    <>
      <DetailSectionHeader sectionKey="dates" title="Key Dates &amp; Contract" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-dates">
          <div className="fr dp-data-row">
            <div className="dp-field">
              <span className="dp-field-label">Start Date</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{license.startDate ? formatDate(license.startDate, userSettings) : "\u2014"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit start date"
                    onClick={() => openFieldEdit({ fieldKey: "startDate", fieldLabel: "Start Date", currentValue: license.startDate || "", inputType: "date" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
            <div className="dp-field">
              <span className="dp-field-label">End Date</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{license.endDate ? formatDate(license.endDate, userSettings) : "\u2014"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit end date"
                    onClick={() => openFieldEdit({ fieldKey: "endDate", fieldLabel: "End Date", currentValue: license.endDate || "", inputType: "date" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="fr dp-data-row">
            <div className="dp-field">
              <span className="dp-field-label">Request Date</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{license.requestDate ? formatDateTime(license.requestDate, userSettings) : "\u2014"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit request date"
                    onClick={() => openFieldEdit({ fieldKey: "requestDate", fieldLabel: "Request Date", currentValue: license.requestDate?.slice(0, 10) || "", inputType: "date" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
            <div className="dp-field">
              <span className="dp-field-label">Purchase Date</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{license.purchaseDate ? formatDateTime(license.purchaseDate, userSettings) : "\u2014"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit purchase date"
                    onClick={() => openFieldEdit({ fieldKey: "purchaseDate", fieldLabel: "Purchase Date", currentValue: license.purchaseDate?.slice(0, 10) || "", inputType: "date" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="fr dp-data-row">
            <div className="dp-field">
              <span className="dp-field-label">Notice Date</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{license.noticeDate ? formatDate(license.noticeDate, userSettings) : "\u2014"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit notice date"
                    onClick={() => openFieldEdit({ fieldKey: "noticeDate", fieldLabel: "Notice Date", currentValue: license.noticeDate || "", inputType: "date" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
              {noticeAfterEnd && (
                <div className="dp-field-warning">Notice date is after the license end date.</div>
              )}
              {license.noticeDate && (
                <div className="dp-notice-handled-row">
                  {noticeHandled ? (
                    <span>Handled {formatDateTime(license.noticeHandledAt, userSettings)}</span>
                  ) : perms.canEdit ? (
                    <button
                      type="button"
                      className="btn btn-g btn-sm"
                      disabled={noticeActionBusy}
                      onClick={onMarkNoticeHandled}
                    >
                      <Icon name="check" size={12} /> {noticeActionBusy ? "Marking..." : "Mark Handled"}
                    </button>
                  ) : (
                    <span>Not handled</span>
                  )}
                </div>
              )}
            </div>
            <div className="dp-field">
              <span className="dp-field-label">PO #</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{license.poNumber || "\u2014"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit PO number"
                    onClick={() => openFieldEdit({ fieldKey: "poNumber", fieldLabel: "PO #", currentValue: license.poNumber || "", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="fr dp-data-row">
            <div className="dp-field">
              <span className="dp-field-label">Contract #</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{license.contractNumber || "\u2014"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit contract number"
                    onClick={() => openFieldEdit({ fieldKey: "contractNumber", fieldLabel: "Contract #", currentValue: license.contractNumber || "", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
            {license.contractNumber && (
              <div className="dp-field">
                <span className="dp-field-label">Contract Record</span>
                {matchedContract ? (
                  <button className="btn btn-g btn-sm" onClick={() => onNavigateToContract?.(matchedContract.id)} style={{ marginTop: 2 }}>
                    <Icon name="file" size={12} /> Open Contract
                  </button>
                ) : (
                  <button className="btn btn-g btn-sm"
                    onClick={() => onCreateContract?.({ contractNumber: license.contractNumber, publisherName: license.publisherName })}
                    style={{ marginTop: 2 }}>
                    <Icon name="plus" size={12} /> Create Contract Record
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="dp-field">
            <span className="dp-field-label">Invoice #</span>
            <div style={{ display: "flex", alignItems: "center" }}>
              {perms.canEdit ? (
                <button
                  type="button"
                  className="dp-clickable-value val mono invoice-primary-value"
                  onClick={openInvoiceNumbersEdit}
                >
                  {primaryInvoiceNumber || "\u2014"}
                  {invoiceCount > 1 && <span className="invoice-count-badge">+{invoiceCount - 1}</span>}
                </button>
              ) : (
                <div className="val mono invoice-primary-value">
                  {primaryInvoiceNumber || "\u2014"}
                  {invoiceCount > 1 && <span className="invoice-count-badge">+{invoiceCount - 1}</span>}
                </div>
              )}
              {perms.canEdit && (
                <button type="button" className="dp-field-edit-icon" aria-label="Edit invoice numbers"
                  onClick={openInvoiceNumbersEdit}
                  onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                  <Icon name="edit" size={11} />
                </button>
              )}
              {perms.canEdit && (
                <button type="button" className="dp-field-edit-icon invoice-add-icon" aria-label="Add invoice number"
                  onClick={openInvoiceNumbersEdit}
                  onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                  <Icon name="plus" size={11} />
                </button>
              )}
            </div>
          </div>
          <CustomFieldRows
            fieldDefs={cfBySection["dates"] ?? []}
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
