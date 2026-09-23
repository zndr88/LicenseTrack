/**
 * Shared prefill rules for renewal sourcing / pending-order lines, used by both
 * the edit-line form and the conversion forms so they always show the same value.
 */

const cleanEmail = (value) => String(value ?? "").trim();

/** Predecessor license ids for a renewal line: coterm ids when merged, else the single renewal source. */
export function linePredecessorIds(item) {
  const cotermIds = item?.cotermPredecessorIds ?? [];
  if (cotermIds.length > 0) return cotermIds;
  return item?.renewalForLicenseId != null ? [item.renewalForLicenseId] : [];
}

/**
 * Resolve a line's budget owner. The stored line value is the truth; only a
 * line with exactly one predecessor falls back to that predecessor's owner.
 * Merged coterm lines whose predecessors had different owners stay blank and
 * are flagged `required` so conversion forces an explicit choice.
 *
 * @returns {{ value: string, required: boolean }}
 */
export function resolveLineBudgetOwner(item, licenses = []) {
  const stored = cleanEmail(item?.budgetOwnerEmail);
  if (stored) return { value: stored, required: false };

  const predecessorIds = linePredecessorIds(item);
  const predecessors = predecessorIds
    .map((id) => (licenses || []).find((license) => license.id === id))
    .filter(Boolean);
  if (predecessorIds.length === 1) {
    return { value: cleanEmail(predecessors[0]?.budgetOwnerEmail), required: false };
  }

  const distinctOwners = new Set(
    predecessors.map((license) => cleanEmail(license.budgetOwnerEmail).toLowerCase()).filter(Boolean),
  );
  return { value: "", required: distinctOwners.size > 1 };
}
