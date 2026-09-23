import Checkbox from "../ui/Checkbox.jsx";
import { isRenewalOptInLicenseType } from "../../utils/licenseTypeRules.js";

/**
 * Service/Other extras shown beside a License Type selector: the "Renewable?"
 * opt-in (default off) and, for Other, a required short type description.
 * Value-based so both React Hook Form and plain-state forms can use it.
 */
export default function LicenseTypeOptInFields({
  idPrefix,
  licenseType,
  isRenewable,
  typeDescription,
  onChange,
  error,
}) {
  if (!isRenewalOptInLicenseType(licenseType)) return null;
  return (
    <div className="fr license-type-opt-in">
      <div className="fg">
        <span className="fg-label">Renewable?</span>
        <Checkbox
          checked={isRenewable === true}
          onChange={(checked) => onChange("isRenewable", checked)}
          label="Renews like a subscription"
        />
        <span className="field-hint">
          {isRenewable === true
            ? "Appears in renewals and recurring cost."
            : "One-off purchase: retired automatically after its end date."}
        </span>
      </div>
      {licenseType === "other" && (
        <div className="fg">
          <label htmlFor={`${idPrefix}-type-description`}>Type Description <span className="required-mark">*</span></label>
          <input
            id={`${idPrefix}-type-description`}
            className="fi"
            maxLength={255}
            placeholder="e.g. Training voucher"
            value={typeDescription ?? ""}
            onChange={(event) => onChange("typeDescription", event.target.value)}
          />
          {error && <span className="field-error">{error}</span>}
        </div>
      )}
    </div>
  );
}
