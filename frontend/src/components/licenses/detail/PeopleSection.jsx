import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import CustomFieldRows from "./CustomFieldRows.jsx";

export default function PeopleSection({
  license,
  perms,
  userSettings,
  vis,
  isOpen,
  onToggle,
  openFieldEdit,
  cfBySection,
  customFieldValues,
  customFieldsLoading,
  makeCustomFieldSaveFn,
  closeFieldEdit,
  openSecondaryContactsEdit = () => {},
}) {
  const secondaryContacts = Array.isArray(license.secondaryContacts)
    ? license.secondaryContacts.filter(Boolean)
    : [];
  const primaryBudgetOwner = license.budgetOwnerEmail || "";
  const emailSubject = `Re: Contract ${license.contractNumber} - ${license.softwareDescription}`;
  const emailBody = `Dear ${license.publisherName} team,\n\nI am writing regarding:\n\nContract: ${license.contractNumber}\nPO: ${license.poNumber}\nInvoice: ${license.invoiceNumber}\nSoftware: ${license.softwareDescription}\nPeriod: ${license.startDate} → ${license.endDate}\n\nBest regards`;
  const mailto = `mailto:${license.contactEmail}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  return (
    <>
      <DetailSectionHeader sectionKey="people" title="Relationships" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-people">
          {vis.supplier && (
            <div className="dp-field">
              <span className="dp-field-label">Supplier</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val">{license.supplier || "—"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit supplier"
                    onClick={() => openFieldEdit({ fieldKey: "supplier", fieldLabel: "Supplier", currentValue: license.supplier || "", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {vis.costCentre && (
            <div className="dp-field">
              <span className="dp-field-label">Cost Centre / Dept</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val">{license.costCentre || "—"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit cost centre"
                    onClick={() => openFieldEdit({ fieldKey: "costCentre", fieldLabel: "Cost Centre/Dept", currentValue: license.costCentre || "", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {license.lifecycleStatus !== "pending_renewal" ? (
            <div className="dp-field">
              <span className="dp-field-label">Publisher Contact</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <a href={mailto} className="email-link dp-fieldval-sm">
                  <Icon name="mail" size={12} color="var(--accent)" /> {license.contactEmail || "—"}
                </a>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit publisher contact"
                    onClick={() => openFieldEdit({ fieldKey: "contactEmail", fieldLabel: "Publisher Contact", currentValue: license.contactEmail || "", inputType: "email" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
              <div className="dp-note">Click to email with contract details pre-filled</div>
            </div>
          ) : (
            <div className="dp-field">
              <span className="dp-field-label">Publisher Contact</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val dp-fieldval-sm">{license.contactEmail || "—"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit publisher contact"
                    onClick={() => openFieldEdit({ fieldKey: "contactEmail", fieldLabel: "Publisher Contact", currentValue: license.contactEmail || "", inputType: "email" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
              <div className="dp-note">Email disabled — renewal details not yet populated</div>
            </div>
          )}
          <div className="dp-field">
            <span className="dp-field-label">Budget Owner (Dept.)</span>
            <div className="dp-budget-row">
              {primaryBudgetOwner ? (
                <a href={`mailto:${primaryBudgetOwner}`} className="email-link dp-fieldval-sm">
                  <Icon name="mail" size={12} color="var(--orange)" /> {primaryBudgetOwner}
                </a>
              ) : (
                <span className="dp-not-set">Not set</span>
              )}
              {secondaryContacts.length > 0 && (
                <button
                  type="button"
                  className="secondary-contact-count"
                  onClick={openSecondaryContactsEdit}
                  aria-label={`${secondaryContacts.length} secondary contact${secondaryContacts.length === 1 ? "" : "s"}`}
                >
                  +{secondaryContacts.length}
                </button>
              )}
              {perms.canEdit && (
                <button type="button" className="dp-field-edit-icon" aria-label="Edit budget owner"
                  onClick={() => openFieldEdit({ fieldKey: "budgetOwnerEmail", fieldLabel: "Budget Owner", currentValue: license.budgetOwnerEmail || "", inputType: "email" })}
                  onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                  <Icon name="edit" size={11} />
                </button>
              )}
              {perms.canEdit && (
                <button type="button" className="dp-field-edit-icon" aria-label="Edit secondary contacts"
                  onClick={openSecondaryContactsEdit}
                  onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                  <Icon name="plus" size={11} />
                </button>
              )}
            </div>
            <div className="dp-note">Secondary contacts are CC&apos;d on renewal notification emails</div>
          </div>
          <CustomFieldRows
            fieldDefs={cfBySection["people"] ?? []}
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
