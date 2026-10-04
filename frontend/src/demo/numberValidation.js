import { isValidNumberValue } from "../utils/formatting.js";

const MONEY_FIELDS = new Set([
  "quantity", "quantityPerUnit", "unitPrice", "totalPoPrice",
  "estimatedUnitPrice", "estimatedTotalPrice", "maintenanceQuantity",
  "maintenanceUnitPrice", "maintenanceCost", "poTotalOverride",
]);

// API values are already canonical. Never parse localized text a second time.
export function validateDemoMoney(payload) {
  for (const [field, value] of Object.entries(payload || {})) {
    if (!MONEY_FIELDS.has(field) || value == null || value === "") continue;
    if (typeof value !== "string" || !isValidNumberValue(value)) {
      throw new Error("Money values must be plain decimal strings (e.g. '1234.50').");
    }
  }
}
