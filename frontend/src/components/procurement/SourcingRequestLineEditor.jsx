import { Controller } from "react-hook-form";
import { CURRENCIES, LICENSE_METRICS, LICENSE_TYPES } from "../../constants/licenseData.js";
import { getProcurementFormVisibility } from "../../utils/procurementFormVisibility.js";
import CustomFieldFormFields from "../licenses/CustomFieldFormFields.jsx";
import LicenseFormSection from "../licenses/LicenseFormSection.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";

const SOURCING_FIELD_VISIBILITY = getProcurementFormVisibility("sourcing");

export default function SourcingRequestLineEditor({
  item,
  index,
  control,
  register,
  watch,
  setValue,
  errors,
  customFieldDefs,
  customFieldsLoading,
}) {
  const readOnly = item.status === "converted" || item.status === "cancelled";
  const values = watch(`items.${index}`) || {};
  const idPrefix = `sourcing-request-item-${item.id}`;
  const fieldName = (name) => `items.${index}.${name}`;
  const customFields = (section) => (
    <CustomFieldFormFields
      definitions={customFieldDefs}
      values={values.customFieldValues || {}}
      onChange={(nextValues) => setValue(fieldName("customFieldValues"), nextValues, { shouldDirty: true })}
      idPrefix={idPrefix}
      loading={customFieldsLoading}
      section={section}
    />
  );
  const hasDocumentCustomFields = customFieldDefs.some((definition) => definition.section === "documents");
  const hasCatchallCustomFields = customFieldDefs.some(
    (definition) => !definition.section || definition.section === "__catchall__"
  );

  return (
    <fieldset className="sourcing-request-edit-line" disabled={readOnly}>
      <input type="hidden" {...register(fieldName("id"), { valueAsNumber: true })} />
      <input type="hidden" {...register(fieldName("status"))} />
      <div className="sourcing-request-edit-line-heading">
        <span>Line {index + 1}</span>
        {readOnly && <span className="badge badge-gray">{item.status}</span>}
      </div>

      <div className="license-form-stack license-line-item-sections">
        <LicenseFormSection title="Identity">
          <div className="fg">
            <label htmlFor={`${idPrefix}-publisher`}>Publisher <span className="required-mark">*</span></label>
            <Controller
              name={fieldName("publisherName")}
              control={control}
              render={({ field }) => (
                <ReferenceCombobox id={`${idPrefix}-publisher`} mode="publisher" disabled={readOnly} {...field} />
              )}
            />
            {errors.publisherName && <span className="field-error">{errors.publisherName.message}</span>}
          </div>
          <div className="fg">
            <label htmlFor={`${idPrefix}-description`}>Software Description <span className="required-mark">*</span></label>
            <input id={`${idPrefix}-description`} className="fi" {...register(fieldName("softwareDescription"))} />
            {errors.softwareDescription && <span className="field-error">{errors.softwareDescription.message}</span>}
          </div>
          <div className="fg">
            <label htmlFor={`${idPrefix}-type`}>License Type <span className="optional-label">(optional)</span></label>
            <select id={`${idPrefix}-type`} className="fi fi-select" {...register(fieldName("licenseType"))}>
              <option value="">Not specified</option>
              {LICENSE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {customFields("identity")}
        </LicenseFormSection>

        {hasDocumentCustomFields && (
          <LicenseFormSection title="Documents" icon="upload">
            {customFields("documents")}
          </LicenseFormSection>
        )}

        <LicenseFormSection title="Key Dates & Contract">
          <div className="fr">
            <div className="fg">
              <label htmlFor={`${idPrefix}-start`}>Start Date</label>
              <input id={`${idPrefix}-start`} type="date" className="fi" {...register(fieldName("startDate"))} />
            </div>
            <div className="fg">
              <label htmlFor={`${idPrefix}-end`}>End Date</label>
              <input id={`${idPrefix}-end`} type="date" className="fi" {...register(fieldName("endDate"))} />
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`${idPrefix}-notice`}>Notice Date</label>
              <input id={`${idPrefix}-notice`} type="date" className="fi" {...register(fieldName("noticeDate"))} />
            </div>
            {SOURCING_FIELD_VISIBILITY.purchaseDate && (
              <div className="fg">
                <label htmlFor={`${idPrefix}-purchase`}>Purchase Date</label>
                <input id={`${idPrefix}-purchase`} type="date" className="fi" {...register(fieldName("purchaseDate"))} />
              </div>
            )}
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`${idPrefix}-contract`}>Contract Number</label>
              <input id={`${idPrefix}-contract`} className="fi" {...register(fieldName("contractNumber"))} />
            </div>
            {SOURCING_FIELD_VISIBILITY.invoiceNumber && (
              <div className="fg">
                <label htmlFor={`${idPrefix}-invoice`}>Invoice Number</label>
                <input id={`${idPrefix}-invoice`} className="fi" {...register(fieldName("invoiceNumber"))} />
              </div>
            )}
            {SOURCING_FIELD_VISIBILITY.externalRef && (
              <div className="fg">
                <label htmlFor={`${idPrefix}-external`}>External Reference</label>
                <input id={`${idPrefix}-external`} className="fi" {...register(fieldName("externalRef"))} />
              </div>
            )}
          </div>
          {customFields("dates")}
        </LicenseFormSection>

        <LicenseFormSection title="Details">
          <div className="fr">
            <div className="fg">
              <label htmlFor={`${idPrefix}-quantity`}>Purchase Quantity</label>
              <input id={`${idPrefix}-quantity`} className="fi" inputMode="decimal" {...register(fieldName("quantity"))} />
              {errors.quantity && <span className="field-error">{errors.quantity.message}</span>}
            </div>
            <div className="fg">
              <label htmlFor={`${idPrefix}-quantity-per-unit`}>Quantity per Unit</label>
              <input id={`${idPrefix}-quantity-per-unit`} className="fi" inputMode="decimal" {...register(fieldName("quantityPerUnit"))} />
              {errors.quantityPerUnit && <span className="field-error">{errors.quantityPerUnit.message}</span>}
            </div>
            <div className="fg">
              <label htmlFor={`${idPrefix}-sku`}>SKU Code</label>
              <input id={`${idPrefix}-sku`} className="fi" {...register(fieldName("skuCode"))} />
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`${idPrefix}-metric`}>License Metric</label>
              <select id={`${idPrefix}-metric`} className="fi fi-select" {...register(fieldName("licenseMetric"))}>
                {LICENSE_METRICS.map((metric) => <option key={metric.value} value={metric.value}>{metric.label}</option>)}
              </select>
            </div>
            <div className="fg">
              <label htmlFor={`${idPrefix}-currency`}>Currency</label>
              <select id={`${idPrefix}-currency`} className="fi fi-select" {...register(fieldName("currency"))}>
                {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`${idPrefix}-unit`}>Estimated Unit Price</label>
              <input id={`${idPrefix}-unit`} className="fi" inputMode="decimal" {...register(fieldName("estimatedUnitPrice"))} />
              {errors.estimatedUnitPrice && <span className="field-error">{errors.estimatedUnitPrice.message}</span>}
            </div>
            <div className="fg">
              <label htmlFor={`${idPrefix}-total`}>Estimated Total Price</label>
              <input id={`${idPrefix}-total`} className="fi" inputMode="decimal" {...register(fieldName("estimatedTotalPrice"))} />
              {errors.estimatedTotalPrice && <span className="field-error">{errors.estimatedTotalPrice.message}</span>}
            </div>
          </div>
          {values.licenseType === "saas" && (
            <div className="fg">
              <label htmlFor={`${idPrefix}-portal`}>Portal URL</label>
              <input id={`${idPrefix}-portal`} className="fi" {...register(fieldName("portalUrl"))} />
            </div>
          )}
          {customFields("commercial")}
        </LicenseFormSection>

        <LicenseFormSection title="Relationships">
          <div className="fr">
            <div className="fg">
              <label htmlFor={`${idPrefix}-cost`}>Cost Centre / Department</label>
              <Controller
                name={fieldName("costCentre")}
                control={control}
                render={({ field }) => <ReferenceCombobox id={`${idPrefix}-cost`} mode="costCentre" disabled={readOnly} {...field} />}
              />
            </div>
            <div className="fg">
              <label htmlFor={`${idPrefix}-budget`}>Budget Owner Email</label>
              <input id={`${idPrefix}-budget`} className="fi" {...register(fieldName("budgetOwnerEmail"))} />
            </div>
          </div>
          <div className="fg">
            <label htmlFor={`${idPrefix}-secondary`}>Secondary Contacts</label>
            <input id={`${idPrefix}-secondary`} className="fi" placeholder="Separate email addresses with commas" {...register(fieldName("secondaryContacts"))} />
          </div>
          {customFields("people")}
        </LicenseFormSection>

        <LicenseFormSection title="Notes">
          <div className="fg">
            <label htmlFor={`${idPrefix}-notes`}>Line Notes</label>
            <textarea id={`${idPrefix}-notes`} className="fi" rows={3} {...register(fieldName("notes"))} />
          </div>
          {customFields("notes")}
        </LicenseFormSection>

        {hasCatchallCustomFields && (
          <LicenseFormSection title="Custom Fields">{customFields("__catchall__")}</LicenseFormSection>
        )}
      </div>
    </fieldset>
  );
}
