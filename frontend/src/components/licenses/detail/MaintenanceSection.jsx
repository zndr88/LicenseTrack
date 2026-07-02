import { disableMaintenance, getMaintenanceForParent } from "../../../api/licenses.js";
import { formatCost } from "../../../utils/helpers.js";
import { formatDate } from "../../../utils/formatting.js";
import { MAINTENANCE_COVERAGE_OPTIONS } from "../../../constants/licenseData.js";
import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import CustomFieldRows from "./CustomFieldRows.jsx";

export default function MaintenanceSection({
  license,
  perms,
  userSettings,
  isOpen,
  onToggle,
  maintenanceHistory,
  setMaintenanceHistory,
  historyLoading,
  setShowMaintenanceModal,
  onNavigate,
  onUpdate,
  setToast,
  cfBySection,
  customFieldValues,
  vis,
  openFieldEdit,
  makeCustomFieldSaveFn,
  closeFieldEdit,
  customFieldsLoading,
}) {
  const prior = maintenanceHistory.filter((m) => m.id !== license.activeMaintenanceId);
  const coverage = license.maintenanceCoverage || "unknown";
  const coverageLabel = MAINTENANCE_COVERAGE_OPTIONS.find((option) => option.value === coverage)?.label || coverage;
  const canLinkSupportRecord = coverage === "separately_tracked";

  const handleDisableMaintenance = async () => {
    const { data, error } = await disableMaintenance(license.id);
    if (error) {
      setToast(`Could not disable maintenance: ${error}`);
      setTimeout(() => setToast(null), 6000);
      return;
    }
    onUpdate(license.id, data);
    const { data: history } = await getMaintenanceForParent(license.id);
    if (history) setMaintenanceHistory(history);
  };

  return (
    <>
      <DetailSectionHeader sectionKey="maintenance" title="Maintenance / Support" isOpen={isOpen} onToggle={onToggle} />

      {isOpen && (
        <div className="dp-section-body" id="dp-section-maintenance">
          <div className="dp-field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <label>Coverage</label>
              <div className="val">{coverageLabel}</div>
            </div>
            {perms.canEdit && (
              <button
                type="button"
                className="btn btn-g btn-sm"
                onClick={() => openFieldEdit({
                  fieldKey: "maintenanceCoverage",
                  fieldLabel: "Maintenance / Support Coverage",
                  currentValue: coverage,
                  inputType: "select",
                  selectOptions: MAINTENANCE_COVERAGE_OPTIONS,
                })}
              >
                <Icon name="edit" size={12} /> Edit coverage
              </button>
            )}
          </div>

          {!license.hasMaintenance && canLinkSupportRecord && (
            <div className="dp-field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5 }}>
                No active maintenance / support contract record is linked.
              </div>
              {perms.canEdit && (
                <button type="button" className="btn btn-g btn-sm" style={{ flexShrink: 0 }} onClick={() => setShowMaintenanceModal(true)}>
                  <Icon name="plus" size={12} /> Add maintenance / support contract
                </button>
              )}
            </div>
          )}

          {!license.hasMaintenance && !canLinkSupportRecord && (
            <div className="dp-field" style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5 }}>
              {coverage === "included"
                ? "Maintenance or support is included with this license. No separate contract record is needed."
                : coverage === "not_applicable"
                  ? "Maintenance or support tracking does not apply to this license."
                  : "Classify maintenance or support coverage before linking a separate contract record."}
            </div>
          )}

          {license.hasMaintenance && (
            <>
              <div className="fr dp-data-row">
                <div className="dp-field">
                  <label>Maintenance Start</label>
                  <div className="val mono">{license.maintenanceStartDate ? formatDate(license.maintenanceStartDate, userSettings) : "—"}</div>
                </div>
                <div className="dp-field">
                  <label>Maintenance End</label>
                  <div className="val mono">{license.maintenanceEndDate ? formatDate(license.maintenanceEndDate, userSettings) : "—"}</div>
                </div>
              </div>
              <div className="dp-field">
                <label>Annual Maintenance Cost</label>
                <div className="val dp-mono-val">
                  {license.maintenanceCost
                    ? formatCost(
                        license.maintenanceCost,
                        license.currency || userSettings?.displayCurrency || "EUR",
                        userSettings?.numberFormatLocale ?? "en-US"
                      )
                    : "—"}
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4, fontFamily: "var(--font-mono)", letterSpacing: "0.04em", lineHeight: 1.5 }}>
                Values mirror the currently active maintenance / support contract record.
                Edit them by opening that record.
              </div>

              <div className="dp-btn-row" style={{ marginTop: 12 }}>
                {license.activeMaintenanceId && (
                  <button type="button" className="btn btn-g btn-sm" onClick={() => onNavigate?.(license.activeMaintenanceId)}>
                    <Icon name="edit" size={12} /> Edit Maintenance / Support Record
                  </button>
                )}
                {perms.canEdit && (
                  <button type="button" className="btn btn-g btn-sm" onClick={handleDisableMaintenance}>
                    <Icon name="x" size={12} /> Disable linked contract
                  </button>
                )}
              </div>
            </>
          )}

          {prior.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 9, color: "var(--text-3)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
                History
              </div>
              {prior.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onNavigate?.(m.id)}
                  style={{
                    appearance: "none",
                    background: "none",
                    border: "none",
                    padding: "8px 0",
                    margin: 0,
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "left",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    borderBottom: "1px solid var(--bg-2)",
                    color: "inherit",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>
                    {m.licenseRef || `#${m.id}`}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>
                    {m.startDate ? formatDate(m.startDate, userSettings) : "—"} → {m.endDate ? formatDate(m.endDate, userSettings) : "—"}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-1)" }}>
                    {m.totalPoPrice
                      ? formatCost(
                          m.totalPoPrice,
                          m.currency || userSettings?.displayCurrency || "EUR",
                          userSettings?.numberFormatLocale ?? "en-US"
                        )
                      : "—"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {historyLoading && (
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>
              Loading history...
            </div>
          )}

          <CustomFieldRows
            fieldDefs={cfBySection["maintenance"] ?? []}
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
