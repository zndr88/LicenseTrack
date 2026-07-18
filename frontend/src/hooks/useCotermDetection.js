import { useMemo } from "react";

/**
 * Detects coterm renewal opportunities.
 *
 * A coterm group is 2+ renewal sourcing items for the same product:
 * same publisher, description, metric, and predecessor endDate. SKU is only
 * considered when present; conflicting non-blank SKUs block grouping.
 *
 * @param {Array} sourcingItems - full list of sourcing items
 * @param {Array} licenses - full license list (used to look up predecessor endDate)
 * @returns {Array<{ publisher: string, endDate: string|null, ids: number[] }>}
 */
export function useCotermDetection(sourcingItems, licenses) {
  return useMemo(() => {
    if (!sourcingItems?.length || !licenses?.length) return [];

    const renewalItems = sourcingItems.filter((si) => si.isRenewal);
    const groups = [];

    const norm = (value) => String(value ?? "").trim().toLowerCase();
    const compatibleSku = (group, sku) => {
      if (!sku) return true;
      return group.skus.size === 0 || group.skus.has(sku);
    };

    for (const si of renewalItems) {
      const pred = licenses.find((l) => l.id === si.renewalForLicenseId);
      if (!pred) continue;

      const candidate = {
        publisherKey: norm(si.publisherName),
        descriptionKey: norm(si.softwareDescription),
        metricKey: norm(pred.licenseMetric),
        endDate: pred.endDate ?? null,
        sku: norm(pred.skuCode),
      };
      const group = groups.find((entry) =>
        entry.publisherKey === candidate.publisherKey &&
        entry.descriptionKey === candidate.descriptionKey &&
        entry.metricKey === candidate.metricKey &&
        entry.endDate === candidate.endDate &&
        compatibleSku(entry, candidate.sku)
      );

      if (group) {
        group.ids.push(si.id);
        if (candidate.sku) group.skus.add(candidate.sku);
      } else {
        groups.push({
          publisher: si.publisherName,
          publisherKey: candidate.publisherKey,
          descriptionKey: candidate.descriptionKey,
          metricKey: candidate.metricKey,
          endDate: candidate.endDate,
          ids: [si.id],
          skus: new Set(candidate.sku ? [candidate.sku] : []),
        });
      }
    }

    return groups
      .filter((group) => group.ids.length >= 2)
      .map(({ publisher, endDate, ids }) => ({ publisher, endDate, ids }));
  }, [sourcingItems, licenses]);
}
