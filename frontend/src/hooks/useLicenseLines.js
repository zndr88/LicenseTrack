import { useCallback, useState } from "react";
import { parseLocalizedNumber } from "../utils/formatting.js";
import { buildMaintenanceCompanion } from "../utils/maintenanceCompanion.js";

/**
 * Owns the additional-lines array shared by the procurement/manual modals: add,
 * remove (cascading to maintenance companions), update (deriving the line total
 * from quantity x unit price), maintenance-companion creation, and copying
 * relationship fields onto every line.
 *
 * @param {object} options
 * @param {(overrides?: object) => object} options.emptyLine - the modal's line factory.
 * @param {object} options.userSettings - for localized number parsing.
 * @param {{ quantity: string, unitPrice?: string, total?: string }} options.priceFields
 * @param {string[]} [options.relationshipFields]
 */
export function useLicenseLines({
  emptyLine,
  userSettings,
  priceFields = {},
  relationshipFields = ["costCentre", "budgetOwnerEmail", "secondaryContacts"],
}) {
  const [lines, setLines] = useState([]);
  const { quantity: qtyField = "quantity", unitPrice: unitField, total: totalField } = priceFields;

  const deriveTotal = useCallback((line) => {
    if (!unitField || !totalField) return line;
    const qtyStr = String(line[qtyField] ?? "").trim();
    const unitStr = String(line[unitField] ?? "").trim();
    if (!qtyStr && !unitStr) return { ...line, [totalField]: "" };
    const qty = Number(parseLocalizedNumber(qtyStr, userSettings));
    const unit = Number(parseLocalizedNumber(unitStr, userSettings));
    if (Number.isNaN(qty) || Number.isNaN(unit)) return line;
    return { ...line, [totalField]: (qty * unit).toFixed(2) };
  }, [qtyField, unitField, totalField, userSettings]);

  const addLine = useCallback(() => setLines((prev) => [...prev, emptyLine()]), [emptyLine]);

  const removeLine = useCallback(
    (id) => setLines((prev) => prev.filter((line) => line.id !== id && line.parentLineId !== id)),
    [],
  );

  const updateLine = useCallback((id, field, value) => setLines((prev) => prev.map((line) => {
    if (line.id !== id) return line;
    const next = { ...line, [field]: value };
    return field === qtyField || field === unitField ? deriveTotal(next) : next;
  })), [qtyField, unitField, deriveTotal]);

  const hasMaintenanceCompanion = useCallback(
    (parentLineId) => lines.some((line) => line.isMaintenanceCompanion && line.parentLineId === parentLineId),
    [lines],
  );

  const addMaintenanceCompanion = useCallback((parent, parentLineId) => setLines((prev) => {
    const key = parentLineId ?? parent.id;
    if (prev.some((line) => line.isMaintenanceCompanion && line.parentLineId === key)) return prev;
    const companion = buildMaintenanceCompanion(parent, {
      idFactory: () => `${Date.now()}-${Math.random()}`,
      parentLineId: key,
    });
    return [...prev, emptyLine(companion)];
  }), [emptyLine]);

  const applyRelationshipsToAllLines = useCallback((source) => setLines((prev) => prev.map((line) => ({
    ...line,
    ...Object.fromEntries(relationshipFields.map((field) => [field, source[field]])),
  }))), [relationshipFields]);

  return {
    lines,
    setLines,
    addLine,
    removeLine,
    updateLine,
    hasMaintenanceCompanion,
    addMaintenanceCompanion,
    applyRelationshipsToAllLines,
  };
}
