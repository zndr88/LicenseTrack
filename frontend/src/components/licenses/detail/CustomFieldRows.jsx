// frontend/src/components/licenses/detail/CustomFieldRows.jsx
import {
  formatCustomFieldValue as formatPresentedCustomFieldValue,
  getCustomFieldInputConfig,
} from "../../../utils/customFieldPresentation.js";
import Icon from "../../ui/Icon.jsx";

function formatValue(fieldDef, rawValue, license, userSettings) {
  return formatPresentedCustomFieldValue(rawValue, fieldDef, {
    currency: license.currency,
    locale: userSettings?.numberFormatLocale ?? "en-US",
    dateLocale: undefined,
  });
}

function getValue(fieldDef, values) {
  const val = values.find((v) => v.customFieldDefId === fieldDef.id);
  if (!val) return null;
  if (fieldDef.fieldType === "currency") return val.valueCurrency ?? null;
  return val.valueText ?? null;
}

export default function CustomFieldRows({
  fieldDefs,
  values,
  visibleInDetail,
  license,
  userSettings,
  canEdit,
  onOpenFieldEdit,
  makeCustomFieldSaveFn,
  onCloseFieldEdit,
  loading,
}) {
  if (loading) {
    return <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>Loading…</div>;
  }

  const visible = fieldDefs.filter((def) => visibleInDetail[`cf_${def.fieldKey}`] ?? true);
  if (visible.length === 0) return null;

  return visible.map((fieldDef) => {
    const rawValue = getValue(fieldDef, values);
    const displayValue = formatValue(fieldDef, rawValue, license, userSettings);
    const inputConfig = getCustomFieldInputConfig(fieldDef, rawValue);

    return (
      <div key={fieldDef.id} className="dp-field">
        <label>{fieldDef.name}</label>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div className={`val${fieldDef.fieldType === "currency" ? " dp-mono-val" : ""}`}>
            {displayValue ?? "—"}
          </div>
          {canEdit && (
            <button
              type="button"
              className="dp-field-edit-icon"
              aria-label={`Edit ${fieldDef.name}`}
              onClick={() =>
                onOpenFieldEdit({
                  fieldKey: fieldDef.fieldKey,
                  fieldLabel: fieldDef.name,
                  currentValue: inputConfig.currentValue ?? rawValue ?? "",
                  inputType: inputConfig.inputType,
                  selectOptions: inputConfig.selectOptions,
                  blankOptionLabel: inputConfig.blankOptionLabel,
                  onSaveFn: makeCustomFieldSaveFn(fieldDef),
                  onSaveCallback: onCloseFieldEdit,
                })
              }
              onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}
            >
              <Icon name="edit" size={11} />
            </button>
          )}
        </div>
      </div>
    );
  });
}
