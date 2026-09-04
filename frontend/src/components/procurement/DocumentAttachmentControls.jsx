import Icon from "../ui/Icon.jsx";
import { DOCUMENT_CATEGORY_OPTIONS } from "../../utils/documentCategories.js";

export default function DocumentAttachmentControls({
  category,
  idPrefix,
  onCategoryChange,
  onTargetChange,
  scopeHelp,
  targetOptions = [],
  targetValue = "",
}) {
  return (
    <>
      <div className="fg">
        <div className="procurement-document-label-row">
          <label htmlFor={`${idPrefix}-category`}>Document Type</label>
          <button
            type="button"
            className="procurement-document-scope-help"
            aria-label={`Document attachment scope: ${scopeHelp}`}
            data-tooltip={scopeHelp}
            title={scopeHelp}
          >
            <Icon name="info" size={12} />
          </button>
        </div>
        <select
          id={`${idPrefix}-category`}
          className="fi fi-select"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          {DOCUMENT_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      {targetOptions.length > 1 && (
        <div className="fg">
          <label htmlFor={`${idPrefix}-target`}>Attach to License</label>
          <select
            id={`${idPrefix}-target`}
            className="fi fi-select"
            value={targetValue}
            onChange={(event) => onTargetChange(event.target.value)}
          >
            {targetOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
