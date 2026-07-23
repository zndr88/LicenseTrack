export const NUMBER_FORMAT_OPTIONS = [
  {
    value: "en-US",
    label: "1,234.50",
  },
  {
    value: "de-DE",
    label: "1.234,50",
  },
  {
    value: "fr-FR",
    label: "1 234,50",
  },
];

const EQUIVALENT_OPTION_VALUES = {
  "en-GB": "en-US",
  "nl-BE": "de-DE",
  "nl-NL": "de-DE",
  "de-AT": "de-DE",
  "fr-BE": "de-DE",
  "fr-CH": "fr-FR",
};

export function normalizeNumberFormatOptionValue(locale) {
  return EQUIVALENT_OPTION_VALUES[locale] ?? locale ?? "en-US";
}
