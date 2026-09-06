import LicenseFormSection from "./LicenseFormSection.jsx";

export default function LicenseDatesContractFormSection({
  idPrefix,
  register,
  fieldName = (name) => name,
  fieldIds = {},
  children,
}) {
  const fieldId = (name, fallback) => `${idPrefix}-${fieldIds[name] || fallback}`;
  return (
    <LicenseFormSection title="Key Dates & Contract">
      <div className="fr">
        <div className="fg">
          <label htmlFor={fieldId("startDate", "start")}>Start Date</label>
          <input id={fieldId("startDate", "start")} type="date" className="fi" {...register(fieldName("startDate"))} />
        </div>
        <div className="fg">
          <label htmlFor={fieldId("endDate", "end")}>End Date</label>
          <input id={fieldId("endDate", "end")} type="date" className="fi" {...register(fieldName("endDate"))} />
        </div>
      </div>
      <div className="fr">
        <div className="fg">
          <label htmlFor={fieldId("noticeDate", "notice")}>Notice Date</label>
          <input id={fieldId("noticeDate", "notice")} type="date" className="fi" {...register(fieldName("noticeDate"))} />
        </div>
      </div>
      <div className="fr">
        <div className="fg">
          <label htmlFor={fieldId("contractNumber", "contract")}>Contract Number</label>
          <input id={fieldId("contractNumber", "contract")} className="fi" {...register(fieldName("contractNumber"))} />
        </div>
      </div>
      {children}
    </LicenseFormSection>
  );
}
