import { useCallback, useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import MaintenanceCoverageFields from "../procurement/MaintenanceCoverageFields.jsx";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Suggested one-year period for an empty support period; never saved on its own. */
function suggestedPeriod(license) {
  const start = license.startDate || new Date().toISOString().slice(0, 10);
  const oneYearLater = new Date(`${start}T00:00:00Z`);
  oneYearLater.setUTCFullYear(oneYearLater.getUTCFullYear() + 1);
  return { start, end: addDays(oneYearLater.toISOString().slice(0, 10), -1) };
}

function initialValues(license, locale) {
  const hasPeriod = Boolean(license.maintenanceStartDate || license.maintenanceEndDate);
  const suggestion = hasPeriod ? null : suggestedPeriod(license);
  return {
    maintenanceCoverage: "included",
    maintenanceStartDate: license.maintenanceStartDate || suggestion?.start || "",
    maintenanceEndDate: license.maintenanceEndDate || suggestion?.end || "",
    maintenancePricingBasis: license.maintenancePricingBasis || "flat",
    maintenanceQuantity: license.maintenanceQuantity || "",
    maintenanceUnitPrice: formatPriceInput(license.maintenanceUnitPrice || "", locale),
    maintenanceCost: formatPriceInput(license.maintenanceCost || "", locale),
    suggested: Boolean(suggestion),
  };
}

/**
 * Edit the included support period of a perpetual/OEM/freeware license.
 * The cost is optional (e.g. free community support with an end date).
 */
export default function IncludedSupportModal({ license, userSettings, onSave, onClose }) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const [values, setValues] = useState(() => initialValues(license, locale));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = useCallback((field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
  }, []);

  const toCanonical = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return { ok: true, value: null };
    const parsed = parseLocalizedNumber(text, userSettings);
    return parsed === null ? { ok: false } : { ok: true, value: parsed };
  };

  const save = async () => {
    if (values.maintenanceStartDate && values.maintenanceEndDate && values.maintenanceEndDate < values.maintenanceStartDate) {
      setError("Support end date cannot be before its start date.");
      return;
    }
    const perUnit = values.maintenancePricingBasis === "per_unit";
    const cost = toCanonical(values.maintenanceCost);
    const quantity = toCanonical(values.maintenanceQuantity);
    const unitPrice = toCanonical(values.maintenanceUnitPrice);
    if (!cost.ok || (perUnit && (!quantity.ok || !unitPrice.ok))) {
      setError("Enter valid amounts, or leave the cost empty.");
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await onSave({
      maintenanceStartDate: values.maintenanceStartDate || null,
      maintenanceEndDate: values.maintenanceEndDate || null,
      maintenancePricingBasis: values.maintenancePricingBasis || "flat",
      maintenanceQuantity: perUnit ? quantity.value : null,
      maintenanceUnitPrice: perUnit ? unitPrice.value : null,
      maintenanceCost: cost.value,
    });
    setSaving(false);
    if (!ok) setError("The support period could not be saved.");
  };

  return (
    <ModalShell
      title="Edit included support"
      titleId="dialog-title-included-support"
      onClose={onClose}
      modalStyle={{ width: 480, maxWidth: "92vw" }}
      footer={(
        <>
          <button type="button" className="btn btn-g btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-p btn-sm" disabled={saving} onClick={save}>
            {saving ? "Saving..." : "Save support"}
          </button>
        </>
      )}
    >
      <div className="modal-bd" style={{ paddingBottom: 8 }}>
        <p className="field-hint" style={{ marginTop: 0 }}>
          {values.suggested
            ? "Suggested one-year period from the license start date. Adjust it before saving."
            : "Correct the included support period. The cost is optional."}
        </p>
        <MaintenanceCoverageFields
          idPrefix="included-support"
          licenseType={license.licenseType}
          coverage="included"
          startDate={values.maintenanceStartDate}
          endDate={values.maintenanceEndDate}
          pricingBasis={values.maintenancePricingBasis}
          supportQuantity={values.maintenanceQuantity}
          supportUnitPrice={values.maintenanceUnitPrice}
          cost={values.maintenanceCost}
          licenseQuantity={license.quantity}
          currency={license.currency || "EUR"}
          locale={locale}
          onChange={handleChange}
          hideCoverage
          embedded
        />
        {error && <div className="field-error" role="alert">{error}</div>}
      </div>
    </ModalShell>
  );
}
