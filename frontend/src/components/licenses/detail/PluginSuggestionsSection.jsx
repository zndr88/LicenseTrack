import { useMemo } from "react";
import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";
import SuggestionReviewCard, { formatSuggestedValue } from "./SuggestionReviewCard.jsx";

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
              <SuggestionReviewCard
                key={suggestion.id}
                item={suggestion}
                license={license}
                customFieldValues={customFieldValues}
                customFieldDefs={customFieldDefs}
                accepting={reviewBusy === `accept:${suggestion.id}`}
                rejecting={reviewBusy === `reject:${suggestion.id}`}
                canEdit={perms.canEdit}
                onAccept={onAccept}
                onReject={onReject}
                className="plugin-suggestion-card"
                summaryFallback="Official Extension suggested changes"
                summaryMeta={<>{suggestion.pluginKey} / {suggestion.actionKey}</>}
                status={suggestion.confidence != null ? `${Math.round(suggestion.confidence * 100)}%` : "Pending review"}
                renderFieldMeta={(field) => field.note && <small>{field.note}</small>}
              >
                {(suggestion.lineItems || []).length > 0 && (
                  <div className="plugin-suggestion-line-items">
                    {suggestion.lineItems.map((item, index) => (
                      <div key={`${item.summary || "line"}-${index}`} className="plugin-suggestion-line-item">
                        <strong>{item.summary || `Line item ${index + 1}`}</strong>
                        <span>
                          {(item.fields || []).map((field) => `${field.field}: ${formatSuggestedValue(field.value)}`).join(" | ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SuggestionReviewCard>
            ))}
          </div>
        </div>
      )}
      <div className="dp-section-divider" />
    </>
  );
}
