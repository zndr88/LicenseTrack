import { Controller } from "react-hook-form";
import { LICENSE_TYPES } from "../../constants/licenseData.js";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";
import LicenseFormSection from "./LicenseFormSection.jsx";

export default function LicenseIdentityFormSection({
  idPrefix,
  control,
  register,
  errors = {},
  fieldName = (name) => name,
  fieldIds = {},
  disabled = false,
  children,
}) {
  const fieldId = (name, fallback) => `${idPrefix}-${fieldIds[name] || fallback}`;
  return (
    <LicenseFormSection title="Identity">
      <div className="fg">
        <label htmlFor={fieldId("publisherName", "publisher")}>Publisher <span className="required-mark">*</span></label>
        <Controller
          name={fieldName("publisherName")}
          control={control}
          render={({ field }) => (
            <ReferenceCombobox
              id={fieldId("publisherName", "publisher")}
              mode="publisher"
              placeholder="Software publisher"
              disabled={disabled}
              {...field}
            />
          )}
        />
        {errors.publisherName && <span className="field-error">{errors.publisherName.message}</span>}
      </div>
      <div className="fg">
        <label htmlFor={fieldId("softwareDescription", "description")}>Software Description <span className="required-mark">*</span></label>
        <input
          id={fieldId("softwareDescription", "description")}
          className="fi"
          placeholder="Product or service name"
          {...register(fieldName("softwareDescription"))}
        />
        {errors.softwareDescription && <span className="field-error">{errors.softwareDescription.message}</span>}
      </div>
      <div className="fg">
        <label htmlFor={fieldId("licenseType", "type")}>License Type <span className="optional-label">(optional)</span></label>
        <select id={fieldId("licenseType", "type")} className="fi fi-select" {...register(fieldName("licenseType"))}>
          <option value="">Not specified</option>
          {LICENSE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {children}
    </LicenseFormSection>
  );
}
