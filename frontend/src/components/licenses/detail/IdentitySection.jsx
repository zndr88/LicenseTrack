// frontend/src/components/licenses/detail/IdentitySection.jsx
import { LICENSE_TYPES } from "../../../constants/licenseData.js";
import { daysBetween, todayStr } from "../../../utils/helpers.js";
import Icon from "../../ui/Icon.jsx";
import Badge from "../../ui/Badge.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import CustomFieldRows from "./CustomFieldRows.jsx";

export default function IdentitySection({
  license,
  perms,
  userSettings,
  globalSettings,
  exp,
  comp,
  vis,
  isOpen,
  onToggle,
  onNavigate,
  openFieldEdit,
  cfBySection,
  customFieldValues,
  customFieldsLoading,
  makeCustomFieldSaveFn,
  closeFieldEdit,
  onLinkLegacyMaintenance,
}) {
  const maintenanceParentIds = Array.isArray(license.maintenanceParentIds) && license.maintenanceParentIds.length > 0
    ? license.maintenanceParentIds
    : license.parentLicenseId
      ? [license.parentLicenseId]
      : [];
  const singleMaintenanceParentId = maintenanceParentIds.length === 1 ? maintenanceParentIds[0] : null;

  return (
    <>
      <DetailSectionHeader sectionKey="identity" title="Identity" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-identity">
          {license.licenseType === "maintenance" && license.isLegacyUnlinkedMaintenance && (
            <div className="dp-legacy-unlinked-warning">
              <span><strong>Legacy unlinked maintenance.</strong> The original purchase parent was unavailable during import. You can link an eligible parent now.</span>
              {perms.canEdit && <button type="button" className="btn btn-g btn-sm" onClick={onLinkLegacyMaintenance}>Link parent</button>}
            </div>
          )}
          {license.licenseType === "maintenance" && singleMaintenanceParentId && (
            <button
              type="button"
              onClick={() => onNavigate?.(singleMaintenanceParentId)}
              style={{
                appearance: "none", background: "none", border: "none",
                padding: 0, margin: "0 0 12px 0", cursor: "pointer",
                color: "var(--purple-text)", fontFamily: "var(--font-mono)",
                fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}
              aria-label="Navigate to parent license"
            >
              <Icon name="link" size={11} /> Go to parent license
            </button>
          )}
          {(license.licenseType === "perpetual" || license.licenseType === "oem" || license.licenseType === "freeware") &&
            license.activeMaintenanceId && (
              <button
                type="button"
                onClick={() => onNavigate?.(license.activeMaintenanceId)}
                style={{
                  appearance: "none", background: "none", border: "none",
                  padding: 0, margin: "0 0 12px 0", cursor: "pointer",
                  color: "var(--purple-text)", fontFamily: "var(--font-mono)",
                  fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}
                aria-label="Navigate to maintenance or support record"
              >
                <Icon name="link" size={11} /> Go to maintenance / support record
              </button>
            )}
          <div className="dp-ident">
            <div className="dp-publisher dp-field">
              {license.publisherName}
              {perms.canEdit && (
                <button type="button" className="dp-field-edit-icon" aria-label="Edit publisher"
                  onClick={() => openFieldEdit({ fieldKey: "publisherName", fieldLabel: "Publisher", currentValue: license.publisherName || "", inputType: "text" })}
                  onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                  <Icon name="edit" size={11} />
                </button>
              )}
            </div>
            <div className="dp-software dp-field">
              {license.softwareDescription}
              {perms.canEdit && (
                <button type="button" className="dp-field-edit-icon" aria-label="Edit description"
                  onClick={() => openFieldEdit({ fieldKey: "softwareDescription", fieldLabel: "Description", currentValue: license.softwareDescription || "", inputType: "text" })}
                  onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                  <Icon name="edit" size={11} />
                </button>
              )}
            </div>
            {license.licenseRef && userSettings.visibleInDetail?.licenseRef !== false && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)", marginTop: 2, letterSpacing: "0.04em" }}>
                {license.licenseRef}{license.externalRef ? ` | ${license.externalRef}` : ""}
              </div>
            )}
            <div className="dp-badge-row dp-field">
              {exp.status === "retired" && <Badge type="gray">Retired</Badge>}
              {exp.status === "legacy" && <Badge type="gray">Legacy</Badge>}
              {exp.status === "renewed" && <span className="badge badge-renewed"><span className="badge-dot" />Renewed</span>}
              {exp.status === "pending_renewal" && <span className="badge badge-pending"><span className="badge-dot" />Pending Renewal</span>}
              {exp.status === "upcoming" && <Badge type="blue">{exp.label}</Badge>}
              {exp.status === "expired" && <Badge type="red">{exp.label}</Badge>}
              {exp.status === "expiring" && <Badge type="orange">{exp.label}</Badge>}
              {exp.status === "active" && <Badge type="green">{exp.label}</Badge>}
              {exp.status === "perpetual" && <Badge type="blue">Perpetual</Badge>}
              {comp.isExempt
                ? <Badge type="gray">Exempt</Badge>
                : comp.isComplete
                  ? <Badge type="green">Complete</Badge>
                  : <Badge type="orange">{comp.percentage}%</Badge>}
              {vis.licenseType && (
                <>
                  {license.licenseType && (
                    <Badge type="gray">
                      {LICENSE_TYPES.find((t) => t.value === license.licenseType)?.label || license.licenseType}
                    </Badge>
                  )}
                  {perms.canEdit && (
                    <button type="button" className="dp-field-edit-icon" aria-label="Edit license type"
                      onClick={() => openFieldEdit({ fieldKey: "licenseType", fieldLabel: "License Type", currentValue: license.licenseType || "", inputType: "select", selectOptions: LICENSE_TYPES })}
                      onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                      <Icon name="edit" size={11} />
                    </button>
                  )}
                </>
              )}
            </div>
            {license.hasMaintenance && license.maintenanceEndDate && (() => {
              const daysToMaint = daysBetween(todayStr(), license.maintenanceEndDate);
              const isExpired = daysToMaint < 0;
              const isExpiring = daysToMaint >= 0 && daysToMaint <= (globalSettings?.notificationDays ?? 30);
              if (!isExpired && !isExpiring) return null;
              return (
                <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.04em", color: isExpired ? "var(--red-text)" : "var(--orange-text)" }}>
                  {isExpired
                    ? `Maintenance expired ${Math.abs(daysToMaint)}d ago`
                    : `Maintenance expires in ${daysToMaint}d`}
                </div>
              );
            })()}
          </div>
          <CustomFieldRows
            fieldDefs={cfBySection["identity"] ?? []}
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
