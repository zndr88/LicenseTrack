import { LICENSE_METRICS, LICENSE_TYPES } from "../../constants/licenseData.js";
import CustomFieldFormFields from "./CustomFieldFormFields.jsx";

export const licenseDraftSupplementDefaults = {
  licenseType: "",
  licenseMetric: "per_user",
  portalUrl: "",
  quantityPerUnit: "1",
  skuCode: "",
  startDate: "",
  endDate: "",
  noticeDate: "",
  purchaseDate: "",
  contractNumber: "",
  invoiceNumber: "",
  externalRef: "",
  costCentre: "",
  budgetOwnerEmail: "",
  secondaryContacts: "",
  notes: "",
  customFieldValues: {},
};

export default function LicenseDraftSupplementFields({
  item,
  onChange,
  idPrefix,
  customFieldDefs = [],
  customFieldsLoading = false,
}) {
  const field = (name) => ({
    value: item[name] ?? "",
    onChange: (event) => onChange(name, event.target.value),
  });
  return (
    <>
      <fieldset className="fs">
        <legend>License record details</legend>
        <div className="fr">
          <div className="fg"><label htmlFor={`${idPrefix}-type`}>License Type</label><select id={`${idPrefix}-type`} className="fi fi-select" {...field("licenseType")}><option value="">Not specified</option>{LICENSE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          <div className="fg"><label htmlFor={`${idPrefix}-metric`}>License Metric</label><select id={`${idPrefix}-metric`} className="fi fi-select" {...field("licenseMetric")}>{LICENSE_METRICS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        </div>
        {item.licenseType === "saas" && <div className="fg"><label htmlFor={`${idPrefix}-portal`}>Portal URL</label><input id={`${idPrefix}-portal`} className="fi" {...field("portalUrl")} /></div>}
        <div className="fr">
          <div className="fg"><label htmlFor={`${idPrefix}-quantity-per-unit`}>Quantity per Unit</label><input id={`${idPrefix}-quantity-per-unit`} className="fi" inputMode="decimal" {...field("quantityPerUnit")} /></div>
          <div className="fg"><label htmlFor={`${idPrefix}-sku`}>SKU Code</label><input id={`${idPrefix}-sku`} className="fi" {...field("skuCode")} /></div>
        </div>
        <div className="fr">
          <div className="fg"><label htmlFor={`${idPrefix}-start`}>Start Date</label><input id={`${idPrefix}-start`} type="date" className="fi" {...field("startDate")} /></div>
          <div className="fg"><label htmlFor={`${idPrefix}-end`}>End Date</label><input id={`${idPrefix}-end`} type="date" className="fi" {...field("endDate")} /></div>
          <div className="fg"><label htmlFor={`${idPrefix}-notice`}>Notice Date</label><input id={`${idPrefix}-notice`} type="date" className="fi" {...field("noticeDate")} /></div>
          <div className="fg"><label htmlFor={`${idPrefix}-purchase`}>Purchase Date</label><input id={`${idPrefix}-purchase`} type="date" className="fi" {...field("purchaseDate")} /></div>
        </div>
        <div className="fr">
          <div className="fg"><label htmlFor={`${idPrefix}-contract`}>Contract Number</label><input id={`${idPrefix}-contract`} className="fi" {...field("contractNumber")} /></div>
          <div className="fg"><label htmlFor={`${idPrefix}-invoice`}>Invoice Number</label><input id={`${idPrefix}-invoice`} className="fi" {...field("invoiceNumber")} /></div>
          <div className="fg"><label htmlFor={`${idPrefix}-external`}>External Reference</label><input id={`${idPrefix}-external`} className="fi" {...field("externalRef")} /></div>
        </div>
        <div className="fr">
          <div className="fg"><label htmlFor={`${idPrefix}-cost-centre`}>Cost Centre / Department</label><input id={`${idPrefix}-cost-centre`} className="fi" {...field("costCentre")} /></div>
          <div className="fg"><label htmlFor={`${idPrefix}-budget-owner`}>Budget Owner Email</label><input id={`${idPrefix}-budget-owner`} className="fi" {...field("budgetOwnerEmail")} /></div>
        </div>
        <div className="fg"><label htmlFor={`${idPrefix}-secondary`}>Secondary Contacts</label><input id={`${idPrefix}-secondary`} className="fi" placeholder="Separate email addresses with commas" {...field("secondaryContacts")} /></div>
        <div className="fg"><label htmlFor={`${idPrefix}-notes`}>Line Notes</label><textarea id={`${idPrefix}-notes`} className="fi" rows={2} {...field("notes")} /></div>
      </fieldset>
      <CustomFieldFormFields
        definitions={customFieldDefs}
        values={item.customFieldValues || {}}
        onChange={(values) => onChange("customFieldValues", values)}
        idPrefix={idPrefix}
        loading={customFieldsLoading}
      />
    </>
  );
}
