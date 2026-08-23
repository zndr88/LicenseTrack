// frontend/src/components/licenses/detail/CommercialSection.jsx
import { useState } from "react";
import { LICENSE_TYPES, LICENSE_METRICS, CURRENCIES } from "../../../constants/licenseData.js";
import { formatCost, getEffectiveQuantity, getPoTotal } from "../../../utils/helpers.js";
import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import CustomFieldRows from "./CustomFieldRows.jsx";
import PoTotalOverrideModal from "../PoTotalOverrideModal.jsx";

function formatQuantityDisplay(value, userSettings) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat(userSettings?.numberFormatLocale ?? "en-US", {
    maximumFractionDigits: 4,
  }).format(number);
}

export default function CommercialSection({
  license,
  perms,
  userSettings,
  vis,
  isOpen,
  onToggle,
  allLicenses,
  onPoTotalOverride,
  openFieldEdit,
  cfBySection,
  customFieldValues,
  customFieldsLoading,
  makeCustomFieldSaveFn,
  closeFieldEdit,
}) {
  const [poOverrideOpen, setPoOverrideOpen] = useState(false);
  const fmtCost = (amount) =>
    formatCost(amount, license.currency || userSettings.displayCurrency || "EUR", userSettings.numberFormatLocale ?? "en-US");
  const effectiveQuantity = getEffectiveQuantity(license);

  return (
    <>
      <DetailSectionHeader sectionKey="commercial" title="Details" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-commercial">
          {vis.licenseType && (
            <div className="dp-field">
              <span className="dp-field-label">License Type</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val">
                  {license.licenseType
                    ? LICENSE_TYPES.find((t) => t.value === license.licenseType)?.label || license.licenseType
                    : "—"}
                </div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit license type"
                    onClick={() => openFieldEdit({ fieldKey: "licenseType", fieldLabel: "License Type", currentValue: license.licenseType || "", inputType: "select", selectOptions: LICENSE_TYPES })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {license.licenseType === "saas" && (
            <div className="dp-field">
              <span className="dp-field-label">Portal URL</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val">
                  {license.portalUrl
                    ? <a href={license.portalUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--purple-text)" }}>{license.portalUrl}</a>
                    : "—"}
                </div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit portal URL"
                    onClick={() => openFieldEdit({ fieldKey: "portalUrl", fieldLabel: "Portal URL", currentValue: license.portalUrl || "", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {vis.licenseMetric && (
            <div className="dp-field">
              <span className="dp-field-label">License Metric</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val">
                  {license.licenseMetric
                    ? LICENSE_METRICS.find((m) => m.value === license.licenseMetric)?.label || license.licenseMetric
                    : "—"}
                </div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit license metric"
                    onClick={() => openFieldEdit({ fieldKey: "licenseMetric", fieldLabel: "License Metric", currentValue: license.licenseMetric || "", inputType: "select", selectOptions: LICENSE_METRICS })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {vis.quantity && (
            <div className="dp-field">
              <span className="dp-field-label">Purchase Quantity</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{formatQuantityDisplay(license.quantity, userSettings)}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit purchase quantity"
                    onClick={() => openFieldEdit({ fieldKey: "quantity", fieldLabel: "Purchase Quantity", currentValue: license.quantity || "", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {vis.quantityPerUnit && (
            <div className="dp-field">
              <span className="dp-field-label">Quantity per Unit</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{formatQuantityDisplay(license.quantityPerUnit || "1", userSettings)}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit quantity per unit"
                    onClick={() => openFieldEdit({ fieldKey: "quantityPerUnit", fieldLabel: "Quantity per Unit", currentValue: license.quantityPerUnit || "1", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {vis.effectiveQuantity && (
            <div className="dp-field">
              <span className="dp-field-label">Effective Quantity</span>
              <div className="val mono">{formatQuantityDisplay(effectiveQuantity, userSettings)}</div>
            </div>
          )}
          {vis.skuCode && (
            <div className="dp-field">
              <span className="dp-field-label">SKU Code</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono" style={{ fontSize: 12 }}>{license.skuCode || "—"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit SKU code"
                    onClick={() => openFieldEdit({ fieldKey: "skuCode", fieldLabel: "SKU Code", currentValue: license.skuCode || "", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {vis.unitPrice && (
            <div className="dp-field">
              <span className="dp-field-label">Unit Price</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val dp-mono-val">{license.unitPrice ? fmtCost(license.unitPrice) : "—"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit unit price"
                    onClick={() => openFieldEdit({ fieldKey: "unitPrice", fieldLabel: "Unit Price", currentValue: license.unitPrice || "", inputType: "text" })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {Number(license.quantity) > 0 && Number(license.unitPrice) > 0 && (
            <div className="dp-field">
              <span className="dp-field-label">Calculated total</span>
              <div className="val dp-mono-val">{fmtCost(Number(license.quantity) * Number(license.unitPrice))}</div>
            </div>
          )}
          {vis.totalPoPrice && (
            <div className="dp-field">
              <span className="dp-field-label">
                Total PO Value{license.poTotalOverride ? " · Manual" : " · Calculated"}
              </span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val dp-mono-val">
                  {license.poNumber ? fmtCost(getPoTotal(license.poNumber, license.currency, allLicenses)) : "—"}
                </div>
                {perms.canEdit && license.poNumber && onPoTotalOverride && (
                  <button
                    type="button"
                    className="dp-field-edit-icon"
                    aria-label={license.poTotalOverride ? "Edit PO total override" : "Override total PO value"}
                    onClick={() => setPoOverrideOpen(true)}
                  >
                    <Icon name={license.poTotalOverride ? "lock" : "edit"} size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {(vis.unitPrice || vis.totalPoPrice || perms.canEdit) && (
            <div className="dp-field">
              <span className="dp-field-label">Currency</span>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="val mono">{license.currency || "—"}</div>
                {perms.canEdit && (
                  <button type="button" className="dp-field-edit-icon" aria-label="Edit currency"
                    onClick={() => openFieldEdit({ fieldKey: "currency", fieldLabel: "Currency", currentValue: license.currency || "", inputType: "select", selectOptions: CURRENCIES.map((c) => ({ value: c, label: c })) })}
                    onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}>
                    <Icon name="edit" size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          <CustomFieldRows
            fieldDefs={cfBySection["commercial"] ?? []}
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
      {poOverrideOpen && (
        <PoTotalOverrideModal
          license={license}
          userSettings={userSettings}
          onSave={async (value) => {
            const ok = await onPoTotalOverride(license.id, value);
            if (ok) setPoOverrideOpen(false);
            return ok;
          }}
          onClear={async () => {
            const ok = await onPoTotalOverride(license.id, null);
            if (ok) setPoOverrideOpen(false);
            return ok;
          }}
          onClose={() => setPoOverrideOpen(false)}
        />
      )}
    </>
  );
}
