import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import CustomFieldRows from "./CustomFieldRows.jsx";

function uniqueIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of values || []) {
    if (value === null || value === undefined || value === "") continue;
    const id = Number(value);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

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
  allLicenses = [],
  onNavigate,
}) {
  const secondaryContacts = Array.isArray(license.secondaryContacts)
    ? license.secondaryContacts.filter(Boolean)
    : [];
  const primaryBudgetOwner = license.budgetOwnerEmail || "";
  const linkedParentIds = license.licenseType === "maintenance"
    ? uniqueIds(
      Array.isArray(license.maintenanceParentIds) && license.maintenanceParentIds.length > 0
        ? license.maintenanceParentIds
        : [license.parentLicenseId]
    )
    : [];
  const licensesById = new Map((allLicenses || []).map((item) => [Number(item.id), item]));
  const linkedParents = linkedParentIds.map((id) => ({
    id,
    license: licensesById.get(id) || null,
  }));
  const emailSubject = `Re: Contract ${license.contractNumber} - ${license.softwareDescription}`;
  const emailBody = `Dear ${license.publisherName} team,\n\nI am writing regarding:\n\nContract: ${license.contractNumber}\nPO: ${license.poNumber}\nInvoice: ${license.invoiceNumber}\nSoftware: ${license.softwareDescription}\nPeriod: ${license.startDate} → ${license.endDate}\n\nBest regards`;
  const mailto = `mailto:${license.contactEmail}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  return (
    <>
      <DetailSectionHeader sectionKey="people" title="Relationships" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-people">
          {linkedParents.length > 0 && (
            <div className="dp-field">
              <span className="dp-field-label">Linked Parent Licenses</span>
              <div className="dp-linked-parent-list">
                {linkedParents.map(({ id, license: parent }) => {
                  const title = parent
                    ? `${parent.publisherName || "Unknown publisher"} - ${parent.softwareDescription || "Untitled license"}`
                    : `License #${id}`;
                  const meta = [
                    parent?.licenseRef,
                    parent?.poNumber ? `PO ${parent.poNumber}` : null,
                    parent?.licenseType,
                  ].filter(Boolean).join(" | ");
                  return (
                    <button
                      key={id}
                      type="button"
                      className="dp-linked-parent-row"
                      onClick={() => onNavigate?.(id)}
                      aria-label={`Open linked parent license ${parent?.licenseRef || id}`}
                    >
                      <Icon name="link" size={12} />
                      <span className="dp-linked-parent-copy">
                        <span className="dp-linked-parent-title">{title}</span>
                        {meta && <span className="dp-linked-parent-meta">{meta}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {vis.supplier && (
            <div className="dp-field">
              <span className="dp-field-label">Supplier</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val">{license.supplier || "—"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit supplier"
                    onClick={() => openFieldEdit({ fieldKey: "supplier", fieldLabel: "Supplier", currentValue: license.supplier || "", inputType: "text" })}
                  >
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
                  >
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
                  >
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
                  >
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
                >
                  <Icon name="edit" size={11} />
                </button>
              )}
              {perms.canEdit && (
                <button type="button" className="dp-field-edit-icon" aria-label="Edit secondary contacts"
                  onClick={openSecondaryContactsEdit}
                >
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
