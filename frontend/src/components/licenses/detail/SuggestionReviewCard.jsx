import { useEffect, useMemo, useState } from "react";
import Icon from "../../ui/Icon.jsx";

export function formatSuggestedValue(value) {
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function lookupKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function getFieldCurrentValue(fieldName, license, customFieldValues, customFieldDefs) {
  if (Object.prototype.hasOwnProperty.call(license ?? {}, fieldName)) {
    return license[fieldName];
  }

  const target = lookupKey(fieldName);
  const definition = customFieldDefs.find((def) => {
    const fieldKey = def.fieldKey ?? def.field_key ?? "";
    const baseKey = fieldKey.startsWith("cf_") ? fieldKey.slice(3) : fieldKey;
    return [fieldKey, baseKey, def.name].some((value) => lookupKey(value) === target);
  });
  if (!definition) return undefined;

  const value = customFieldValues.find((item) => item.customFieldDefId === definition.id);
  if (!value) return undefined;
  return definition.fieldType === "currency" ? value.valueCurrency : value.valueText;
}

export default function SuggestionReviewCard({
  item,
  license,
  customFieldValues = [],
  customFieldDefs = [],
  accepting,
  rejecting,
  canEdit,
  onAccept,
  onReject,
  className = "",
  summaryFallback,
  summaryMeta,
  status,
  renderFieldMeta,
  children,
}) {
  const fields = useMemo(() => item.suggestedFields || [], [item.suggestedFields]);
  const [selectedIndexes, setSelectedIndexes] = useState(() => fields.map((_field, index) => index));

  useEffect(() => {
    setSelectedIndexes(fields.map((_field, index) => index));
  }, [item.id, fields]);

  const selectedSet = new Set(selectedIndexes);
  const toggleIndex = (index) => {
    setSelectedIndexes((previous) => (
      previous.includes(index)
        ? previous.filter((itemIndex) => itemIndex !== index)
        : [...previous, index].sort((a, b) => a - b)
    ));
  };

  return (
    <div className={`doc-processing-card${className ? ` ${className}` : ""}`}>
      <div className="doc-processing-summary">
        <div>
          <strong>{item.summary || summaryFallback}</strong>
          <span>{summaryMeta}</span>
        </div>
        <span className="doc-processing-status">{status}</span>
      </div>
      <div className="doc-processing-fields">
        {fields.map((field, index) => {
          const currentValue = getFieldCurrentValue(field.field, license, customFieldValues, customFieldDefs);
          return (
            <label key={`${field.field}-${index}`} className="doc-processing-field">
              <input
                type="checkbox"
                checked={selectedSet.has(index)}
                onChange={() => toggleIndex(index)}
              />
              <span className="doc-processing-field-name">{field.field}</span>
              <span className="doc-processing-value">
                <small>Current</small>
                <strong>{formatSuggestedValue(currentValue)}</strong>
              </span>
              <Icon name="arrow-right" size={12} />
              <span className="doc-processing-value suggested">
                <small>Suggested</small>
                <strong>{formatSuggestedValue(field.value)}</strong>
              </span>
              <span className="doc-processing-meta">
                {field.confidence != null && <em>{Math.round(field.confidence * 100)}%</em>}
                {field.source && <small>{field.source}</small>}
                {renderFieldMeta?.(field)}
              </span>
            </label>
          );
        })}
      </div>
      {children}
      {canEdit && (
        <div className="doc-processing-actions">
          <button
            className="btn btn-s"
            disabled={accepting || rejecting || selectedIndexes.length === 0}
            onClick={() => onAccept(item, selectedIndexes)}
          >
            <Icon name={accepting ? "clock" : "check"} size={13} />
            {accepting ? "Applying..." : `Accept Selected (${selectedIndexes.length})`}
          </button>
          <button
            className="btn btn-ghost"
            disabled={accepting || rejecting}
            onClick={() => onReject(item)}
          >
            <Icon name={rejecting ? "clock" : "x"} size={13} />
            {rejecting ? "Rejecting..." : "Reject All"}
          </button>
        </div>
      )}
    </div>
  );
}
