export function filterCustomFieldDefinitionsForSourcing(definitions) {
  return definitions.filter((definition) => definition.showOnSourcingForms !== false);
}
