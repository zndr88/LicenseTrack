import { useMemo } from "react";

/**
 * Detects coterm renewal opportunities.
 *
 * A coterm group is 2+ renewal sourcing items for the same publisher
 * (case-insensitive) whose linked predecessor licenses share the same endDate.
 *
 * @param {Array} sourcingItems - full list of sourcing items
 * @param {Array} licenses      - full license list (used to look up predecessor endDate)
 * @returns {Array<{ publisher: string, endDate: string|null, ids: number[] }>}
 */
export function useCotermDetection(sourcingItems, licenses) {
  return useMemo(() => {
    if (!sourcingItems?.length || !licenses?.length) return [];

    const renewalItems = sourcingItems.filter((si) => si.isRenewal);
    const buckets = {};

    for (const si of renewalItems) {
      const pred = licenses.find((l) => l.id === si.renewalForLicenseId);
      if (!pred) continue;

      const key = `${si.publisherName.toLowerCase()}|${pred.endDate ?? ""}`;
      if (!buckets[key]) {
        buckets[key] = { publisher: si.publisherName, endDate: pred.endDate ?? null, ids: [] };
      }
      buckets[key].ids.push(si.id);
    }

    return Object.values(buckets).filter((g) => g.ids.length >= 2);
  }, [sourcingItems, licenses]);
}
