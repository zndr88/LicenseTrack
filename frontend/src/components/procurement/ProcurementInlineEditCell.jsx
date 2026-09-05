import { useEffect, useMemo, useState } from "react";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import { formatQuantity } from "../../utils/quantity.js";
import ReferenceCombobox from "../ui/ReferenceCombobox.jsx";

function displayValue(value, valueType, userSettings) {
  if (value == null || value === "") return "";
  if (valueType === "quantity") return formatQuantity(value, userSettings) || String(value);
  if (valueType === "money") {
    return formatPriceInput(value, userSettings?.numberFormatLocale ?? "en-US");
  }
  return String(value);
}

function normalizedValue(value, valueType, userSettings) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (valueType === "quantity" || valueType === "money") {
    return parseLocalizedNumber(trimmed, userSettings) ?? trimmed;
  }
  return trimmed;
}

export function ProcurementInlineEditField({
  item,
  fieldKey,
  label,
  currentValue,
  valueType = "text",
  required = false,
  referenceMode = null,
  options = null,
  className = "",
  userSettings,
  onSave,
  placeholder,
}) {
  const formattedCurrentValue = useMemo(
    () => displayValue(currentValue, valueType, userSettings),
    [currentValue, valueType, userSettings],
  );
  const [value, setValue] = useState(formattedCurrentValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!saving) setValue(formattedCurrentValue);
  }, [formattedCurrentValue, saving]);

  const commit = async () => {
    if (saving) return;
    const trimmed = String(value ?? "").trim();
    if (required && !trimmed) {
      setError(`${label} is required`);
      return;
    }

    const nextValue = !trimmed
      ? null
      : valueType === "quantity" || valueType === "money"
        ? (parseLocalizedNumber(trimmed, userSettings) ?? trimmed)
        : trimmed;
    const previousValue = normalizedValue(formattedCurrentValue, valueType, userSettings);
    if (String(nextValue ?? "") === String(previousValue ?? "")) {
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    let result;
    try {
      result = await onSave?.(item.id, fieldKey, nextValue);
    } catch (saveError) {
      result = { ok: false, error: saveError?.message || "Save failed" };
    }
    setSaving(false);
    if (!(result === true || result?.ok)) {
      setValue(formattedCurrentValue);
      setError(result?.error || "Save failed");
    }
  };

  const handleKeyDown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setValue(formattedCurrentValue);
      setError(null);
      event.currentTarget.blur();
    }
  };

  const inputProps = {
    value,
    disabled: saving,
    "aria-label": `Edit ${label}`,
    "aria-invalid": Boolean(error),
    className: `lp-inline-input ${error ? "lp-inline-input-error" : ""}`,
    placeholder,
    onBlur: commit,
    onChange: (event) => setValue(event.target.value),
    onClick: (event) => event.stopPropagation(),
    onKeyDown: handleKeyDown,
  };

  return (
    <div className={`lp-inline-edit-wrap ${className}`.trim()}>
      {options ? (
        <select {...inputProps} className={`${inputProps.className} fi-select`}>
          {options.map((option) => (
            <option key={option.value ?? option} value={option.value ?? option}>
              {option.label ?? option}
            </option>
          ))}
        </select>
      ) : referenceMode ? (
        <ReferenceCombobox
          mode={referenceMode}
          value={value}
          onChange={setValue}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className={inputProps.className}
          aria-label={inputProps["aria-label"]}
          aria-invalid={inputProps["aria-invalid"]}
          onClick={inputProps.onClick}
        />
      ) : (
        <input
          {...inputProps}
          type="text"
          inputMode={valueType === "quantity" || valueType === "money" ? "decimal" : undefined}
        />
      )}
      {saving && <span className="lp-inline-save-dot" aria-label={`Saving ${label}`} />}
      {error && <span className="lp-inline-error" title={error}>!</span>}
    </div>
  );
}

export default function ProcurementInlineEditCell({ className = "", children, ...fieldProps }) {
  return (
    <td className={`lp-editable-td ${className}`.trim()}>
      <ProcurementInlineEditField {...fieldProps} />
      {children}
    </td>
  );
}
