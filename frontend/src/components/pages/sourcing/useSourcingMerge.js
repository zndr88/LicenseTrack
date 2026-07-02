import { useCallback, useMemo, useState } from "react";
import { queryKeys } from "../../../queryKeys.js";
import {
  mergeSourcingItems,
  updateSourcingItem as apiUpdateSourcingItem,
} from "../../../api/sourcing.js";

export function useSourcingMerge({ sourcingItems, queryClient, showToast }) {
  const [selectedForMerge, setSelectedForMerge] = useState(new Set());
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeQuantity, setMergeQuantity] = useState("");
  const [merging, setMerging] = useState(false);

  const selectedItems = useMemo(
    () => sourcingItems.filter((item) => selectedForMerge.has(item.id)),
    [sourcingItems, selectedForMerge]
  );
  const computedMergeQty = useMemo(
    () => selectedItems.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0),
    [selectedItems]
  );
  const mergeEligible = selectedForMerge.size >= 2;

  const toggleSelect = (id) => {
    setSelectedForMerge((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMergeModal = () => {
    setMergeQuantity(String(computedMergeQty));
    setShowMergeModal(true);
  };

  const requestCloseMergeModal = () => {
    if (!merging) setShowMergeModal(false);
  };

  const handleMerge = useCallback(async () => {
    setMerging(true);
    const ids = Array.from(selectedForMerge);
    const { data: merged, error } = await mergeSourcingItems(ids);
    if (error) {
      setMerging(false);
      showToast(error, "error");
      return;
    }

    const finalQty = parseInt(mergeQuantity) || 0;
    if (merged && finalQty !== computedMergeQty) {
      await apiUpdateSourcingItem(merged.id, { quantity: String(finalQty) });
    }

    setMerging(false);
    setShowMergeModal(false);
    setSelectedForMerge(new Set());
    await queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    showToast(
      `Sourcing items merged - ${ids.length} licenses combined into one renewal for ${finalQty} seats.`,
      "success"
    );
  }, [selectedForMerge, mergeQuantity, computedMergeQty, queryClient, showToast]);

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
