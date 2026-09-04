export const CUSTOM_FIELD_RENEWAL_BEHAVIORS = Object.freeze({
  CLEAR: "clear",
  COPY: "copy",
  HIDE: "hide",
});

export function getCustomFieldRenewalBehavior(definition) {
  if (definition.renewalBehavior) return definition.renewalBehavior;
  return definition.carryForwardOnRenewal
    ? CUSTOM_FIELD_RENEWAL_BEHAVIORS.COPY
    : CUSTOM_FIELD_RENEWAL_BEHAVIORS.CLEAR;
}

export function filterCustomFieldDefinitionsForRenewal(definitions, isRenewal) {
  if (!isRenewal) return definitions;
  return definitions.filter(
    (definition) => getCustomFieldRenewalBehavior(definition) !== CUSTOM_FIELD_RENEWAL_BEHAVIORS.HIDE
  );
}
