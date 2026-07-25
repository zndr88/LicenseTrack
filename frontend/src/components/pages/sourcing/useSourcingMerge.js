import { useCallback, useMemo, useState } from "react";
import { queryKeys } from "../../../queryKeys.js";
import {
  mergeSourcingItems,
  updateSourcingItem as apiUpdateSourcingItem,
} from "../../../api/sourcing.js";
import {
  canonicalizePositiveQuantityInput,
  formatQuantity,
  normalizeCanonicalQuantity,
  sumCanonicalQuantities,
} from "../../../utils/quantity.js";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function mergeSelectionCompatible(items, licenses) {
  if (items.length < 2) return false;
  const predecessors = items.map((item) => licenses.find((license) => license.id === item.renewalForLicenseId));
  if (predecessors.some((license) => !license)) return false;

  const publishers = new Set(items.map((item) => normalize(item.publisherName)));
  const descriptions = new Set(items.map((item) => normalize(item.softwareDescription)));
  const metrics = new Set(predecessors.map((license) => normalize(license.licenseMetric)));
  const endDates = new Set(predecessors.map((license) => license.endDate ?? null));
  const presentSkus = new Set(predecessors.map((license) => normalize(license.skuCode)).filter(Boolean));

  return (
    publishers.size === 1 &&
    descriptions.size === 1 &&
    metrics.size === 1 &&
    endDates.size === 1 &&
    presentSkus.size <= 1
  );
}

export function useSourcingMerge({ sourcingItems, licenses, queryClient, showToast, userSettings }) {
  const [selectedForMerge, setSelectedForMerge] = useState(new Set());
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeQuantity, setMergeQuantity] = useState("");
  const [merging, setMerging] = useState(false);

  const selectedItems = useMemo(
    () => sourcingItems.filter((item) => selectedForMerge.has(item.id)),
    [sourcingItems, selectedForMerge]
  );
  const computedMergeQty = useMemo(
    () => sumCanonicalQuantities(selectedItems.map((item) => item.quantity)),
    [selectedItems]
  );
  const mergeEligible = mergeSelectionCompatible(selectedItems, licenses ?? []);

  const toggleSelect = (id) => {
    setSelectedForMerge((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMergeModal = () => {
    if (!mergeEligible) return;
    setMergeQuantity(formatQuantity(computedMergeQty, userSettings));
    setShowMergeModal(true);
  };

  const requestCloseMergeModal = () => {
    if (!merging) setShowMergeModal(false);
  };

  const handleMerge = useCallback(async () => {
    const finalQty = canonicalizePositiveQuantityInput(mergeQuantity, userSettings);
    if (finalQty == null) {
      showToast("Enter a valid final quantity greater than zero.", "error");
      return;
    }

    setMerging(true);
    const ids = Array.from(selectedForMerge);
    const { data: merged, error } = await mergeSourcingItems(ids);
    if (error) {
      setMerging(false);
      showToast(error, "error");
      return;
    }

    let actualQty = normalizeCanonicalQuantity(merged?.quantity) ?? computedMergeQty ?? finalQty;
    if (merged && finalQty !== computedMergeQty) {
      const { data: updated, error: updateError } = await apiUpdateSourcingItem(
        merged.id,
        { quantity: finalQty }
      );
      if (updateError) {
        setMerging(false);
        setShowMergeModal(false);
        setSelectedForMerge(new Set());
        await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
        await queryClient.invalidateQueries({ queryKey: queryKeys.sourcingItems });
        showToast(`Sourcing items merged, but the final quantity update failed: ${updateError}`, "error");
        return;
      }
      actualQty = normalizeCanonicalQuantity(updated?.quantity) ?? finalQty;
    }

    setMerging(false);
    setShowMergeModal(false);
    setSelectedForMerge(new Set());
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcingItems });
    showToast(
      `Sourcing items merged - ${ids.length} licenses combined into one renewal for ${formatQuantity(actualQty, userSettings)} seats.`,
      "success"
    );
  }, [selectedForMerge, mergeQuantity, computedMergeQty, queryClient, showToast, userSettings]);

  return {
    computedMergeQty,
    handleMerge,
    mergeEligible,
    mergeQuantity,
    merging,
    openMergeModal,
    requestCloseMergeModal,
    selectedForMerge,
    selectedItems,
    setMergeQuantity,
    setSelectedForMerge,
    showMergeModal,
    toggleSelect,
  };
}
