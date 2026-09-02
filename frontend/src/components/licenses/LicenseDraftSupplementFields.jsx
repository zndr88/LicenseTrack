import { LICENSE_METRICS, LICENSE_TYPES } from "../../constants/licenseData.js";
import CustomFieldFormFields from "./CustomFieldFormFields.jsx";
import LicenseFormSection from "./LicenseFormSection.jsx";

export const licenseDraftSupplementDefaults = {
  licenseType: "", licenseMetric: "per_user", portalUrl: "", quantityPerUnit: "1", skuCode: "",
  maintenanceCoverage: "unknown", maintenanceStartDate: "", maintenanceEndDate: "",
  maintenancePricingBasis: "flat", maintenanceQuantity: "", maintenanceUnitPrice: "", maintenanceCost: "",
  startDate: "", endDate: "", noticeDate: "", purchaseDate: "", contractNumber: "",
  invoiceNumber: "", externalRef: "", costCentre: "", budgetOwnerEmail: "",
  secondaryContacts: "", notes: "", customFieldValues: {},
};

export default function LicenseDraftSupplementFields({
  item, onChange, idPrefix, customFieldDefs = [], customFieldsLoading = false, sectioned = false,
  commercialSummary = null, maintenanceSection = null, showCoreDetails = true,
}) {
  const field = (name) => ({ value: item[name] ?? "", onChange: (event) => onChange(name, event.target.value) });
  const customFields = (section) => (
    <CustomFieldFormFields definitions={customFieldDefs} values={item.customFieldValues || {}}
      onChange={(values) => onChange("customFieldValues", values)} idPrefix={idPrefix}
      loading={customFieldsLoading} section={section} />
  );
  const details = <>
    <div className="fr">
      <div className="fg"><label htmlFor={`${idPrefix}-type`}>License Type</label><select id={`${idPrefix}-type`} className="fi fi-select" {...field("licenseType")}><option value="">Not specified</option>{LICENSE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
      <div className="fg"><label htmlFor={`${idPrefix}-metric`}>License Metric</label><select id={`${idPrefix}-metric`} className="fi fi-select" {...field("licenseMetric")}>{LICENSE_METRICS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
    </div>
    {item.licenseType === "saas" && <div className="fg"><label htmlFor={`${idPrefix}-portal`}>Portal URL</label><input id={`${idPrefix}-portal`} className="fi" {...field("portalUrl")} /></div>}
    <div className="fr">
      <div className="fg"><label htmlFor={`${idPrefix}-quantity-per-unit`}>Quantity per Unit</label><input id={`${idPrefix}-quantity-per-unit`} className="fi" inputMode="decimal" {...field("quantityPerUnit")} /></div>
      <div className="fg"><label htmlFor={`${idPrefix}-sku`}>SKU Code</label><input id={`${idPrefix}-sku`} className="fi" {...field("skuCode")} /></div>
    </div>
  </>;
  const dates = <>
    <div className="fr">
      <div className="fg"><label htmlFor={`${idPrefix}-start`}>Start Date</label><input id={`${idPrefix}-start`} type="date" className="fi" {...field("startDate")} /></div>
      <div className="fg"><label htmlFor={`${idPrefix}-end`}>End Date</label><input id={`${idPrefix}-end`} type="date" className="fi" {...field("endDate")} /></div>
    </div>
    <div className="fr">
      <div className="fg"><label htmlFor={`${idPrefix}-notice`}>Notice Date</label><input id={`${idPrefix}-notice`} type="date" className="fi" {...field("noticeDate")} /></div>
      <div className="fg"><label htmlFor={`${idPrefix}-purchase`}>Purchase Date</label><input id={`${idPrefix}-purchase`} type="date" className="fi" {...field("purchaseDate")} /></div>
    </div>
    <div className="fr">
      <div className="fg"><label htmlFor={`${idPrefix}-contract`}>Contract Number</label><input id={`${idPrefix}-contract`} className="fi" {...field("contractNumber")} /></div>
      <div className="fg"><label htmlFor={`${idPrefix}-invoice`}>Invoice Number</label><input id={`${idPrefix}-invoice`} className="fi" {...field("invoiceNumber")} /></div>
      <div className="fg"><label htmlFor={`${idPrefix}-external`}>External Reference</label><input id={`${idPrefix}-external`} className="fi" {...field("externalRef")} /></div>
    </div>
  </>;
  const relationships = <>
    <div className="fr">
      <div className="fg"><label htmlFor={`${idPrefix}-cost-centre`}>Cost Centre / Department</label><input id={`${idPrefix}-cost-centre`} className="fi" {...field("costCentre")} /></div>
      <div className="fg"><label htmlFor={`${idPrefix}-budget-owner`}>Budget Owner Email</label><input id={`${idPrefix}-budget-owner`} className="fi" {...field("budgetOwnerEmail")} /></div>
    </div>
    <div className="fg"><label htmlFor={`${idPrefix}-secondary`}>Secondary Contacts</label><input id={`${idPrefix}-secondary`} className="fi" placeholder="Separate email addresses with commas" {...field("secondaryContacts")} /></div>
  </>;

  if (sectioned) {
    const hasCatchall = customFieldDefs.some((definition) => !definition.section || definition.section === "__catchall__");
    return <div className="license-form-stack license-line-item-sections">
      <LicenseFormSection title="Key Dates & Contract">{dates}{customFields("dates")}</LicenseFormSection>
      {maintenanceSection}
      <LicenseFormSection title="Details">{commercialSummary}{showCoreDetails && details}{customFields("commercial")}</LicenseFormSection>
      <LicenseFormSection title="Relationships">{relationships}{customFields("people")}</LicenseFormSection>
      <LicenseFormSection title="Notes"><div className="fg"><label htmlFor={`${idPrefix}-notes`}>Line Notes</label><textarea id={`${idPrefix}-notes`} className="fi" rows={2} {...field("notes")} /></div>{customFields("notes")}</LicenseFormSection>
      {hasCatchall && <LicenseFormSection title="Custom Fields">{customFields("__catchall__")}</LicenseFormSection>}
    </div>;
  }

  return <div className="fs">
    <h4>License record details</h4>{details}{dates}{relationships}
    <div className="fg"><label htmlFor={`${idPrefix}-notes`}>Line Notes</label><textarea id={`${idPrefix}-notes`} className="fi" rows={2} {...field("notes")} /></div>
    <CustomFieldFormFields definitions={customFieldDefs} values={item.customFieldValues || {}} onChange={(values) => onChange("customFieldValues", values)} idPrefix={idPrefix} loading={customFieldsLoading} />
  </div>;
}
