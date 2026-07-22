import { useEffect, useMemo, useState } from "react";
import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";

function formatSuggestedValue(value) {
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

function PluginSuggestionCard({
  suggestion,
  license,
  customFieldValues,
  customFieldDefs,
  accepting,
  rejecting,
  canEdit,
  onAccept,
  onReject,
}) {
  const fields = useMemo(() => suggestion.suggestedFields || [], [suggestion.suggestedFields]);
  const lineItems = suggestion.lineItems || [];
  const [selectedIndexes, setSelectedIndexes] = useState(() => fields.map((_field, index) => index));

  useEffect(() => {
    setSelectedIndexes(fields.map((_field, index) => index));
  }, [suggestion.id, fields]);

  const selectedSet = new Set(selectedIndexes);
  const toggleIndex = (index) => {
    setSelectedIndexes((prev) => (
      prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index].sort((a, b) => a - b)
    ));
  };

  return (
    <div className="doc-processing-card plugin-suggestion-card">
      <div className="doc-processing-summary">
        <div>
          <strong>{suggestion.summary || "Official Extension suggested changes"}</strong>
          <span>{suggestion.pluginKey} / {suggestion.actionKey}</span>
        </div>
        <span className="doc-processing-status">
          {suggestion.confidence != null ? `${Math.round(suggestion.confidence * 100)}%` : "Pending review"}
        </span>
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
                {field.note && <small>{field.note}</small>}
              </span>
            </label>
          );
        })}
      </div>
      {lineItems.length > 0 && (
        <div className="plugin-suggestion-line-items">
          {lineItems.map((item, index) => (
            <div key={`${item.summary || "line"}-${index}`} className="plugin-suggestion-line-item">
              <strong>{item.summary || `Line item ${index + 1}`}</strong>
              <span>
                {(item.fields || []).map((field) => `${field.field}: ${formatSuggestedValue(field.value)}`).join(" | ")}
              </span>
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="doc-processing-actions">
          <button
            className="btn btn-s"
            disabled={accepting || rejecting || selectedIndexes.length === 0}
            onClick={() => onAccept(suggestion, selectedIndexes)}
          >
            <Icon name={accepting ? "clock" : "check"} size={13} />
            {accepting ? "Applying..." : `Accept Selected (${selectedIndexes.length})`}
          </button>
          <button
            className="btn btn-ghost"
            disabled={accepting || rejecting}
            onClick={() => onReject(suggestion)}
          >
            <Icon name={rejecting ? "clock" : "x"} size={13} />
            {rejecting ? "Rejecting..." : "Reject All"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function PluginSuggestionsSection({
  license,
  perms,
  isOpen,
  onToggle,
  suggestions = [],
  loading = false,
  reviewBusy,
  onAccept,
  onReject,
  cfBySection,
  customFieldValues,
}) {
  const customFieldDefs = useMemo(
    () => Object.values(cfBySection || {}).flat(),
    [cfBySection],
  );

  return (
    <>
      <DetailSectionHeader sectionKey="pluginSuggestions" isOpen={isOpen} onToggle={onToggle}>
        Official Extension Suggestions{suggestions.length > 0 ? ` (${suggestions.length})` : ""}
      </DetailSectionHeader>

      {isOpen && (
        <div className="dp-section-body" id="dp-section-plugin-suggestions">
          <div className="doc-processing-results plugin-suggestion-results">
            <div className="doc-processing-hd">
              <Icon name="activity" size={14} />
              <span>Review Queue</span>
            </div>
            {loading && suggestions.length === 0 && (
              <div className="doc-processing-empty">Loading suggestions...</div>
            )}
            {!loading && suggestions.length === 0 && (
              <div className="doc-processing-empty">No pending Official Extension suggestions</div>
            )}
            {suggestions.map((suggestion) => (
              <PluginSuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                license={license}
                customFieldValues={customFieldValues}
                customFieldDefs={customFieldDefs}
                accepting={reviewBusy === `accept:${suggestion.id}`}
                rejecting={reviewBusy === `reject:${suggestion.id}`}
                canEdit={perms.canEdit}
                onAccept={onAccept}
                onReject={onReject}
              />
            ))}
          </div>
        </div>
      )}
      <div className="dp-section-divider" />
    </>
  );
}
