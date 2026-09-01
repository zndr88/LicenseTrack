import { parseLocalizedNumber } from "./formatting.js";

export function customFieldValueMap(values = []) {
  if (!Array.isArray(values)) return values && typeof values === "object" ? { ...values } : {};
  return Object.fromEntries(values.map((value) => [
    value.customFieldDefId ?? value.custom_field_def_id,
    value.valueCurrency ?? value.value_currency ?? value.valueText ?? value.value_text ?? "",
  ]));
}

export function buildCustomFieldValuePayload(definitions = [], values = {}, userSettings = null) {
  return definitions.map((definition) => {
    const rawValue = values[definition.id];
    const normalized = rawValue === "" || rawValue === undefined ? null : rawValue;
    if (definition.fieldType === "currency") {
      return {
        customFieldDefId: definition.id,
        valueCurrency: normalized === null
          ? null
          : (parseLocalizedNumber(normalized, userSettings) ?? normalized),
      };
    }
    return { customFieldDefId: definition.id, valueText: normalized };
  });
}
