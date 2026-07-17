const EMPTY_LICENSES = [];
const EMPTY_MAP = new Map();

export function getLicensesFromQueryData(data) {
  return Array.isArray(data) ? data : (data?.licenses ?? EMPTY_LICENSES);
}

export function getCustomFieldValuesMapFromQueryData(data) {
  return data?.customFieldValuesMap ?? EMPTY_MAP;
}

export function updateLicensesInQueryData(data, updater) {
  if (!data) return data;
  if (Array.isArray(data)) return updater(data);
  return { ...data, licenses: updater(getLicensesFromQueryData(data)) };
}
