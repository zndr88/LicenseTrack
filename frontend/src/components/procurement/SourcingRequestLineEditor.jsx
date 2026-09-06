import { Controller } from "react-hook-form";
import { CURRENCIES, LICENSE_METRICS } from "../../constants/licenseData.js";
import { filterCustomFieldDefinitionsForRenewal } from "../../utils/customFieldRenewal.js";
import CustomFieldFormSection, { CustomFieldPlacement } from "../licenses/CustomFieldFormSection.jsx";
import LicenseFormSection from "../licenses/LicenseFormSection.jsx";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import LicenseIdentityFormSection from "../licenses/LicenseIdentityFormSection.jsx";
import LicenseDatesContractFormSection from "../licenses/LicenseDatesContractFormSection.jsx";

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
  const visibleCustomFieldDefs = filterCustomFieldDefinitionsForRenewal(customFieldDefs, item.isRenewal);
  const customFields = (section) => (
    <CustomFieldPlacement
      definitions={visibleCustomFieldDefs}
      values={values.customFieldValues || {}}
      onChange={(nextValues) => setValue(fieldName("customFieldValues"), nextValues, { shouldDirty: true })}
      idPrefix={idPrefix}
      loading={customFieldsLoading}
      section={section}
    />
  );

  return (
    <fieldset className="sourcing-request-edit-line" disabled={readOnly}>
      <input type="hidden" {...register(fieldName("id"), { valueAsNumber: true })} />
      <input type="hidden" {...register(fieldName("status"))} />
      <input type="hidden" {...register(fieldName("isRenewal"))} />
      <div className="sourcing-request-edit-line-heading">
        <span>Line {index + 1}</span>
        {readOnly && <span className="badge badge-gray">{item.status}</span>}
      </div>

      <div className="license-form-stack license-line-item-sections">
        <LicenseIdentityFormSection idPrefix={idPrefix} control={control} register={register}
          errors={errors} fieldName={fieldName} disabled={readOnly}>
          {customFields("identity")}
        </LicenseIdentityFormSection>

        <CustomFieldFormSection title="Documents" icon="upload" section="documents"
          definitions={visibleCustomFieldDefs} values={values.customFieldValues || {}}
          onChange={(nextValues) => setValue(fieldName("customFieldValues"), nextValues, { shouldDirty: true })}
          idPrefix={idPrefix} loading={customFieldsLoading} />

        <LicenseDatesContractFormSection idPrefix={idPrefix} register={register} fieldName={fieldName}>
          {customFields("dates")}
        </LicenseDatesContractFormSection>

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

        <CustomFieldFormSection title="Custom Fields" section="__catchall__"
          definitions={visibleCustomFieldDefs} values={values.customFieldValues || {}}
          onChange={(nextValues) => setValue(fieldName("customFieldValues"), nextValues, { shouldDirty: true })}
          idPrefix={idPrefix} loading={customFieldsLoading} />
      </div>
    </fieldset>
  );
}
