import { formatCost } from "./helpers.js";

const CUSTOM_FIELD_PREFIX = "cf_";

const SECTION_LABELS = {
  identity: "Identity",
  dates: "Key Dates & Contract",
  commercial: "Details",
  people: "Relationships",
  documents: "Documents",
  maintenance: "Maintenance / Support",
  notes: "Notes",
  __catchall__: "Custom Fields",
};

function getRawFieldKey(def) {
  return String(def?.fieldKey ?? def?.field_key ?? def?.key ?? "").trim();
}

export function getCustomFieldBaseKey(def) {
  const key = getRawFieldKey(def);
  return key.startsWith(CUSTOM_FIELD_PREFIX) ? key.slice(CUSTOM_FIELD_PREFIX.length) : key;
}

export function getCustomColumnId(def) {
  const baseKey = getCustomFieldBaseKey(def);
  return baseKey ? `${CUSTOM_FIELD_PREFIX}${baseKey}` : CUSTOM_FIELD_PREFIX.slice(0, -1);
}

export function getCustomFieldSectionLabel(section) {
  return SECTION_LABELS[section || "__catchall__"] ?? "Custom Fields";
}

export function getCustomFieldInputConfig(def, rawValue = "") {
  const fieldType = def?.fieldType ?? def?.field_type;

  if (fieldType === "date") return { inputType: "date" };
  if (fieldType === "boolean") {
    return {
      inputType: "select",
      currentValue: rawValue ?? "",
      blankOptionLabel: "Blank",
      selectOptions: [
        { value: "true", label: "True" },
        { value: "false", label: "False" },
      ],
    };
  }
  if (fieldType === "textarea") return { inputType: "textarea" };
  if (fieldType === "number") return { inputType: "number" };
  return { inputType: "text" };
}

function formatDateValue(value, locale) {
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}/.test(text) ? `${text.slice(0, 10)}T00:00:00` : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat(locale).format(date);
}

export function formatCustomFieldValue(value, def, options = {}) {
  const {
    blankDisplay = null,
    currency = "USD",
    locale,
    dateLocale,
  } = options;
  const effectiveDateLocale = Object.prototype.hasOwnProperty.call(options, "dateLocale")
    ? dateLocale
    : locale;

  if (value === null || value === undefined || value === "") return blankDisplay;

  const fieldType = def?.fieldType ?? def?.field_type;
  if (fieldType === "currency") return formatCost(value, currency, locale);
  if (fieldType === "date") return formatDateValue(value, effectiveDateLocale);
  if (fieldType === "boolean") {
    if (value === true || value === "true") return "True";
    if (value === false || value === "false") return "False";
    return blankDisplay;
  }
  return String(value);
}
