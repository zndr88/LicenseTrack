export function customFieldValueMap(values = []) {
  if (!Array.isArray(values)) return values && typeof values === "object" ? { ...values } : {};
  return Object.fromEntries(values.map((value) => [
    value.customFieldDefId ?? value.custom_field_def_id,
    value.valueCurrency ?? value.value_currency ?? value.valueText ?? value.value_text ?? "",
  ]));
}

// Currency values are canonical (NumberInput); never re-read them as typed text.
export function buildCustomFieldValuePayload(definitions = [], values = {}, _userSettings = null) {
  return definitions.map((definition) => {
    const rawValue = values[definition.id];
    const normalized = rawValue === "" || rawValue === undefined ? null : rawValue;
    if (definition.fieldType === "currency") {
      return {
        customFieldDefId: definition.id,
        valueCurrency: normalized === null ? null : String(normalized).trim() || null,
      };
    }
    return { customFieldDefId: definition.id, valueText: normalized };
  });
}
