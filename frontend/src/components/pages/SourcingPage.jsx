import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ROLE_PERMISSIONS } from "../../constants/permissions.js";
import { useCotermDetection } from "../../hooks/useCotermDetection.js";
import Icon from "../ui/Icon.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import SourcingItemModal from "../procurement/SourcingItemModal.jsx";
import ConvertSourcingModal from "../procurement/ConvertSourcingModal.jsx";
import CotermSuggestionBanner from "./sourcing/CotermSuggestionBanner.jsx";
import MergeSourcingModal from "./sourcing/MergeSourcingModal.jsx";
import SourcingTable from "./sourcing/SourcingTable.jsx";
import SourcingToast from "./sourcing/SourcingToast.jsx";
import { useSourcingActions } from "./sourcing/useSourcingActions.js";
import { useSourcingMerge } from "./sourcing/useSourcingMerge.js";
import { useSourcingPageData } from "./sourcing/useSourcingPageData.js";
import { useSourcingQuotes } from "./sourcing/useSourcingQuotes.js";

function sortSourcingRequests(requests, sortCol, sortDir) {
  if (!sortCol) return requests;

  const requestValue = (request, col) => {
    switch (col) {
      case "supplier": return request.supplier ?? "";
      case "itemCount": return request.items?.length ?? 0;
      case "total": return (request.items ?? []).reduce((sum, item) => {
        const value = parseFloat(item.estimatedTotalPrice);
        return sum + (Number.isNaN(value) ? 0 : value);
      }, 0);
      case "created": return request.createdAt ?? "";
      default: return "";
    }
  };

  return [...requests].sort((a, b) => {
    let aVal;
    let bVal;

    aVal = requestValue(a, sortCol);
    bVal = requestValue(b, sortCol);

    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    const cmp = typeof aVal === "number"
      ? aVal - bVal
      : String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });
}

function filterSourcingRequests(requests, search) {
  const query = search.trim().toLowerCase();
  if (!query) return requests;

  return requests.filter((request) =>
    (request.supplier ?? "").toLowerCase().includes(query) ||
    (request.contactEmail ?? "").toLowerCase().includes(query) ||
    (request.items ?? []).some((item) =>
      (item.publisherName ?? "").toLowerCase().includes(query) ||
      (item.softwareDescription ?? "").toLowerCase().includes(query)
    )
  );
}

export default function SourcingPage({
  user,
  userSettings,
  highlightId, onClearHighlight,
  onPendingOrdersReload,
  onRenewalsReload,
  onPortfolioStateChange,
  onNavigateToPendingOrder,
}) {
  const queryClient = useQueryClient();
  const perms = ROLE_PERMISSIONS[user.role];

  const [showSourcingModal, setShowSourcingModal] = useState(null);
  const [deleteSourcingRequestTarget, setDeleteSourcingRequestTarget] = useState(null);
  const [deleteSourcingId, setDeleteSourcingId] = useState(null);
  const [showConvertModal, setShowConvertModal] = useState(null);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [expandedRequestId, setExpandedRequestId] = useState(null);
  const [localToast, setLocalToast] = useState(null);
  const tableRef = useRef(null);

  const showToast = useCallback((msg, type = "success", action = null) => {
    setLocalToast({ msg, type, action });
    setTimeout(() => setLocalToast(null), 5000);
  }, []);

  const {
    licenses,
    sourcingItems,
    sourcingLoading,
    sourcingRequests,
    refetch,
  } = useSourcingPageData({ showToast });

  const {
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
  } = useSourcingMerge({ sourcingItems, queryClient, showToast });

  const {
    quoteInputRef,
    handleUploadQuote,
    handleQuoteSelected,
    handleDownloadQuote,
  } = useSourcingQuotes({ queryClient, showToast });

  const {
    handleCreateSourcingItem,
    handleCreateSourcingRequest,
    handleUpdateSourcingItem,
    handleDeleteSourcingItem,
    handleDeleteSourcingRequest,
    handleConvertSourcingRequest,
    handleExportSourcingCsv,
  } = useSourcingActions({
    queryClient,
    showToast,
    setExpandedRequestId,
    onPendingOrdersReload,
    onRenewalsReload,
    onPortfolioStateChange,
    onNavigateToPendingOrder,
  });

  useEffect(() => {
    if (!highlightId) return;
    const parentRequest = sourcingRequests.find((request) =>
      (request.items ?? []).some((item) => item.id === highlightId)
    );
    if (parentRequest) setExpandedRequestId(parentRequest.id);
    const el = document.querySelector(`[data-sourcing-row="${highlightId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedRowId(highlightId);
    const t = setTimeout(() => {
      setHighlightedRowId(null);
      if (onClearHighlight) onClearHighlight();
    }, 2000);
    return () => clearTimeout(t);
  }, [highlightId, sourcingRequests, onClearHighlight]);

  const cotermGroups = useCotermDetection(sourcingItems, licenses);
  const displayed = useMemo(
    () => sortSourcingRequests(filterSourcingRequests(sourcingRequests, search), sortCol, sortDir),
    [sourcingRequests, search, sortCol, sortDir]
  );

  const handleSort = (col) => {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc"); }
    else if (sortDir === "asc") { setSortDir("desc"); }
    else { setSortCol(null); setSortDir("asc"); }
  };

  const handleSelectGroup = (groupIds) => {
    setSelectedForMerge(new Set(groupIds));
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2>Sourcing Overview</h2>
            <p>Track software under negotiation or evaluation before purchase</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={quoteInputRef} type="file" style={{ display: "none" }} onChange={handleQuoteSelected} />
            {perms.canEdit && (
              <button className="btn btn-p" onClick={() => setShowSourcingModal({ item: null })}>
                <Icon name="plus" size={13} />Add Request
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="page-content">
        <SourcingToast toast={localToast} onDismiss={() => setLocalToast(null)} />
        <CotermSuggestionBanner
          cotermGroups={cotermGroups}
          canEdit={perms.canEdit}
          onSelectGroup={handleSelectGroup}
        />

        {sourcingLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", color: "var(--text-2)", fontSize: 13 }}>
            <div className="spinner" style={{ margin: 0, width: 18, height: 18 }} />
            Loading sourcing items...
          </div>
        )}

        {!sourcingLoading && sourcingRequests.length === 0 ? (
          <div className="empty">
            <Icon name="search" size={32} color="var(--text-3)" />
            <h3>No sourcing requests yet</h3>
            <p>Add one to start tracking quote-stage purchases.</p>
          </div>
        ) : (
          <SourcingTable
            tableRef={tableRef}
            displayed={displayed}
            licenses={licenses}
            userSettings={userSettings}
            perms={perms}
            search={search}
            setSearch={setSearch}
            selectedForMerge={selectedForMerge}
            mergeEligible={mergeEligible}
            onOpenMerge={openMergeModal}
            onSort={handleSort}
            sortCol={sortCol}
            sortDir={sortDir}
            highlightedRowId={highlightedRowId}
            expandedRequestId={expandedRequestId}
            onRowToggle={setExpandedRequestId}
            onToggleSelect={toggleSelect}
            onEditItem={(item, request) => setShowSourcingModal({ item, request })}
            onDeleteItem={setDeleteSourcingId}
            onAddItem={(request) => {
              setExpandedRequestId(request.id);
              setShowSourcingModal({ item: null, request });
            }}
            onConvert={(request) => setShowConvertModal({ request })}
            onUploadQuote={handleUploadQuote}
            onDownloadQuote={handleDownloadQuote}
            onDeleteRequest={setDeleteSourcingRequestTarget}
            onRefetch={refetch}
            onExportCsv={handleExportSourcingCsv}
          />
        )}
      </div>

      {showMergeModal && (
        <MergeSourcingModal
          selectedItems={selectedItems}
          licenses={licenses}
          computedMergeQty={computedMergeQty}
          mergeQuantity={mergeQuantity}
          setMergeQuantity={setMergeQuantity}
          merging={merging}
          onClose={requestCloseMergeModal}
          onMerge={handleMerge}
        />
      )}

      {showSourcingModal !== null && (
        <SourcingItemModal
          key={showSourcingModal.item?.id ?? "new"}
          item={showSourcingModal.item}
          requestId={showSourcingModal.request?.id ?? null}
          userSettings={userSettings}
          onCancel={() => setShowSourcingModal(null)}
          onSave={async (form) => {
            if (Array.isArray(form.items)) {
              // Multi-line: create a new sourcing request
              const success = await handleCreateSourcingRequest({
                supplier: form.supplier || null,
                contactEmail: form.contactEmail || null,
                notes: form.notes || null,
                items: form.items,
                quoteFile: form.quoteFile || null,
              });
              if (success) setShowSourcingModal(null);
              return success;
            }
            // Single item
            const payload = {
              publisherName: form.publisherName,
              softwareDescription: form.softwareDescription,
              quantity: form.quantity || null,
              estimatedUnitPrice: form.estimatedUnitPrice || null,
              estimatedTotalPrice: form.estimatedTotalPrice || null,
              currency: form.currency || "EUR",
              startDate: form.startDate || null,
              endDate: form.endDate || null,
              supplier: form.supplier || null,
              contactEmail: form.contactEmail || null,
              notes: form.notes || null,
            };
            const success = showSourcingModal.item
              ? await handleUpdateSourcingItem(showSourcingModal.item.id, payload)
              : await handleCreateSourcingItem(payload, showSourcingModal.request?.id ?? null);
            if (success) setShowSourcingModal(null);
            return success;
          }}
        />
      )}

      {showConvertModal !== null && (
        <ConvertSourcingModal
          key={showConvertModal.request?.id ?? "new"}
          item={showConvertModal.request}
          onCancel={() => setShowConvertModal(null)}
          onConfirm={async (opts) => {
            const success = await handleConvertSourcingRequest(showConvertModal.request.id, opts);
            if (success) setShowConvertModal(null);
            return success;
          }}
        />
      )}

      {deleteSourcingId !== null && (
        <ConfirmDialog
          title="Delete Sourcing Item"
          message="Are you sure you want to delete this sourcing item? If it is the last renewal line for a license, that license's renewal process will be cancelled. This action cannot be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteSourcingId(null)}
          onConfirm={async () => {
            const success = await handleDeleteSourcingItem(deleteSourcingId);
            if (success) setDeleteSourcingId(null);
          }}
        />
      )}

      {deleteSourcingRequestTarget !== null && (
        <ConfirmDialog
          title="Delete Sourcing Request"
          message="Are you sure you want to delete this sourcing request and all of its license lines? Any linked license renewal process without another sourcing line will be cancelled. This action cannot be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteSourcingRequestTarget(null)}
          onConfirm={async () => {
            const success = await handleDeleteSourcingRequest(deleteSourcingRequestTarget);
            if (success) setDeleteSourcingRequestTarget(null);
          }}
        />
      )}
    </>
  );
}
