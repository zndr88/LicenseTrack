import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ROLE_PERMISSIONS } from "../../constants/permissions.js";
import { useCotermDetection } from "../../hooks/useCotermDetection.js";
import Icon from "../ui/Icon.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import SourcingItemModal from "../procurement/SourcingItemModal.jsx";
import SourcingRequestEditModal from "../procurement/SourcingRequestEditModal.jsx";
import ConvertSourcingModal from "../procurement/ConvertSourcingModal.jsx";
import CotermSuggestionBanner from "./sourcing/CotermSuggestionBanner.jsx";
import MergeSourcingModal from "./sourcing/MergeSourcingModal.jsx";
import SourcingTable, { isDirectFreewareItem } from "./sourcing/SourcingTable.jsx";
import SourcingToast from "./sourcing/SourcingToast.jsx";
import { useSourcingActions } from "./sourcing/useSourcingActions.js";
import { useSourcingMerge } from "./sourcing/useSourcingMerge.js";
import { useSourcingPageData } from "./sourcing/useSourcingPageData.js";
import { useSourcingQuotes } from "./sourcing/useSourcingQuotes.js";
import ProcurementTablePagination, {
  getPaginationDetails,
  paginateRows,
} from "../procurement/ProcurementTablePagination.jsx";

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
    (request.notes ?? "").toLowerCase().includes(query) ||
    (request.items ?? []).some((item) =>
      (item.publisherName ?? "").toLowerCase().includes(query) ||
      (item.softwareDescription ?? "").toLowerCase().includes(query) ||
      (item.notes ?? "").toLowerCase().includes(query)
    )
  );
}

function isOpenSourcingItem(item) {
  return item.status == null || item.status === "sourcing";
}

function normalizeProcurementIdentity(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function procurementIdentitiesMatch(left, right) {
  return normalizeProcurementIdentity(left) === normalizeProcurementIdentity(right);
}

function findCreatedSourcingItem(created, payload) {
  if (created?.publisherName) return created;
  const items = Array.isArray(created?.items) ? created.items : [];
  const matches = items.filter((item) =>
    procurementIdentitiesMatch(item.publisherName, payload.publisherName) &&
    procurementIdentitiesMatch(item.softwareDescription, payload.softwareDescription) &&
    (item.status == null || item.status === "sourcing")
  );
  return matches.reduce((latest, item) =>
    !latest || (Number(item.id) || 0) > (Number(latest.id) || 0) ? item : latest,
  null);
}

export default function SourcingPage({
  user,
  userSettings,
  highlightId, onClearHighlight,
  onPendingOrdersReload,
  onRenewalsReload,
  onPortfolioStateChange,
  onNavigateToPendingOrder,
  onNavigateToLicense,
}) {
  const queryClient = useQueryClient();
  const perms = ROLE_PERMISSIONS[user.role];

  const [showSourcingModal, setShowSourcingModal] = useState(null);
  const [showSourcingRequestEditModal, setShowSourcingRequestEditModal] = useState(null);
  const [deleteSourcingRequestTarget, setDeleteSourcingRequestTarget] = useState(null);
  const [deleteSourcingId, setDeleteSourcingId] = useState(null);
  const [deleteQuoteTarget, setDeleteQuoteTarget] = useState(null);
  const [showConvertModal, setShowConvertModal] = useState(null);
  const [directConversionTarget, setDirectConversionTarget] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [historySortCol, setHistorySortCol] = useState("created");
  const [historySortDir, setHistorySortDir] = useState("desc");
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [collapsedRequestIds, setCollapsedRequestIds] = useState(() => new Set());
  const [expandedHistoryRequestId, setExpandedHistoryRequestId] = useState(null);
  const [localToast, setLocalToast] = useState(null);
  const tableRef = useRef(null);

  const showToast = useCallback((msg, type = "success", action = null) => {
    setLocalToast({ msg, type, action });
    setTimeout(() => setLocalToast(null), 5000);
  }, []);

  const openSourcingRequest = useCallback((requestId) => {
    if (requestId == null) return;
    setCollapsedRequestIds((prev) => {
      if (!prev.has(requestId)) return prev;
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
  }, []);

  const toggleSourcingRequest = useCallback((requestId) => {
    if (requestId == null) return;
    setCollapsedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  }, []);

  const {
    historyLoading,
    licenses,
    sourcingItems,
    sourcingHistoryRequests,
    sourcingLoading,
    sourcingRequests,
    refetch,
    refetchHistory,
  } = useSourcingPageData({ showToast, includeHistory: showHistory });

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
  } = useSourcingMerge({ sourcingItems, licenses, queryClient, showToast, userSettings });

  const {
    quoteInputRef,
    handleUploadQuote,
    handleQuoteSelected,
    handleDownloadQuote,
    handleDeleteQuote,
  } = useSourcingQuotes({ queryClient, showToast });

  const {
    handleCreateSourcingItem,
    handleCreateSourcingRequest,
    handleUpdateSourcingItem,
    handleUpdateSourcingRequest,
    handleDeleteSourcingItem,
    handleCancelSourcingRequest,
    handleConvertSourcingRequest,
    handleConvertFreeware,
    handleExportSourcingCsv,
  } = useSourcingActions({
    queryClient,
    showToast,
    setExpandedRequestId: openSourcingRequest,
    onPendingOrdersReload,
    onRenewalsReload,
    onPortfolioStateChange,
    onNavigateToPendingOrder,
    onNavigateToLicense,
  });

  useEffect(() => {
    if (!highlightId) return;
    if (sourcingLoading) return;
    const parentRequest = sourcingRequests.find((request) =>
      (request.items ?? []).some((item) => item.id === highlightId)
    );
    if (!parentRequest) {
      setShowHistory(true);
      return undefined;
    }
    openSourcingRequest(parentRequest.id);
    const el = document.querySelector(`[data-sourcing-row="${highlightId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedRowId(highlightId);
    const t = setTimeout(() => {
      setHighlightedRowId(null);
      if (onClearHighlight) onClearHighlight();
    }, 2000);
    return () => clearTimeout(t);
  }, [highlightId, sourcingRequests, sourcingLoading, onClearHighlight, openSourcingRequest]);

  useEffect(() => {
    if (!highlightId || !showHistory) return;
    const parentRequest = sourcingHistoryRequests.find((request) =>
      (request.items ?? []).some((item) => item.id === highlightId)
    );
    if (!parentRequest) return;

    setExpandedHistoryRequestId(parentRequest.id);
    const scrollTimer = setTimeout(() => {
      const el = document.querySelector(`[data-sourcing-row="${highlightId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setHighlightedRowId(highlightId);
    const clearTimer = setTimeout(() => {
      setHighlightedRowId(null);
      if (onClearHighlight) onClearHighlight();
    }, 2000);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [highlightId, showHistory, sourcingHistoryRequests, onClearHighlight]);

  const cotermGroups = useCotermDetection(sourcingItems, licenses);
  const displayed = useMemo(
    () => sortSourcingRequests(filterSourcingRequests(sourcingRequests, search), sortCol, sortDir),
    [sourcingRequests, search, sortCol, sortDir]
  );
  const displayedHistory = useMemo(
    () => sortSourcingRequests(
      filterSourcingRequests(sourcingHistoryRequests, historySearch),
      historySortCol,
      historySortDir
    ),
    [sourcingHistoryRequests, historySearch, historySortCol, historySortDir]
  );
  const { totalPages: historyTotalPages } = getPaginationDetails(
    displayedHistory.length,
    historyPage,
    historyPageSize
  );
  const paginatedHistory = useMemo(
    () => paginateRows(displayedHistory, historyPage, historyPageSize),
    [displayedHistory, historyPage, historyPageSize]
  );
  const directConversionOpenCount = directConversionTarget?.request?.items
    .filter(isOpenSourcingItem).length ?? 0;

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, historySortCol, historySortDir]);

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  const saveMaintenanceCompanion = useCallback(async ({
    companion,
    parentItemId,
    parentRequestId,
    parentRequestSupplier,
  }) => {
    if (!companion) return true;
    if (!parentItemId) {
      showToast("License line saved, but support line could not be linked.", "warning");
      return false;
    }

    const companionSupplier = companion.supplier || null;
    const targetRequestId = parentRequestId && (
      !normalizeProcurementIdentity(companionSupplier) ||
      procurementIdentitiesMatch(companionSupplier, parentRequestSupplier)
    )
      ? parentRequestId
      : null;

    const companionPayload = {
      ...companion,
      parentSourcingItemId: parentItemId,
      supplier: companionSupplier || (targetRequestId ? parentRequestSupplier : null),
    };
    return await handleCreateSourcingItem(companionPayload, targetRequestId);
  }, [handleCreateSourcingItem, showToast]);

  const handleSort = (col) => {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc"); }
    else if (sortDir === "asc") { setSortDir("desc"); }
    else { setSortCol(null); setSortDir("asc"); }
  };

  const handleHistorySort = (col) => {
    if (historySortCol !== col) { setHistorySortCol(col); setHistorySortDir("asc"); }
    else if (historySortDir === "asc") { setHistorySortDir("desc"); }
    else { setHistorySortCol(null); setHistorySortDir("asc"); }
  };

  const handleSelectGroup = (groupIds) => {
    setSelectedForMerge(new Set(groupIds));
    const groupSet = new Set(groupIds);
    const requestIdsToOpen = sourcingRequests
      .filter((request) => (request.items ?? []).some((item) => groupSet.has(item.id)))
      .map((request) => request.id);
    if (requestIdsToOpen.length > 0) {
      setCollapsedRequestIds((prev) => {
        const next = new Set(prev);
        requestIdsToOpen.forEach((requestId) => next.delete(requestId));
        return next;
      });
    }
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
            <button className="btn btn-g" onClick={() => setShowHistory((value) => !value)}>
              <Icon name="archive" size={13} />{showHistory ? "Hide History" : "History"}
            </button>
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
            collapsedRequestIds={collapsedRequestIds}
            onRowToggle={toggleSourcingRequest}
            onToggleSelect={toggleSelect}
            onEditItem={(item, request) => setShowSourcingModal({ item, request })}
            onEditRequest={setShowSourcingRequestEditModal}
            onDeleteItem={setDeleteSourcingId}
            onAddItem={(request) => {
              openSourcingRequest(request.id);
              setShowSourcingModal({ item: null, request });
            }}
            onConvert={(request) => {
              const openItems = (request.items ?? []).filter(isOpenSourcingItem);
              if (openItems.length > 0 && openItems.every(isDirectFreewareItem)) {
                setDirectConversionTarget({ request });
              } else {
                setShowConvertModal({ request });
              }
            }}
            onConvertFreeware={(item) => setDirectConversionTarget({ item })}
            onUploadQuote={handleUploadQuote}
            onDownloadQuote={handleDownloadQuote}
            onDeleteQuote={setDeleteQuoteTarget}
            onDeleteRequest={setDeleteSourcingRequestTarget}
            onNavigateToPendingOrder={onNavigateToPendingOrder}
            onNavigateToLicense={onNavigateToLicense}
            onRefetch={refetch}
            onExportCsv={handleExportSourcingCsv}
          />
        )}

        {showHistory && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, letterSpacing: 0, color: "var(--text-1)" }}>
                  Sourcing History
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-3)" }}>
                  Converted and cancelled requests kept for price, quote, and notes reference.
                </p>
              </div>
              {historyLoading && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-3)", fontSize: 12 }}>
                  <span className="spinner" style={{ margin: 0, width: 14, height: 14 }} />
                  Loading history...
                </span>
              )}
            </div>
            <SourcingTable
              displayed={paginatedHistory}
              licenses={licenses}
              userSettings={userSettings}
              perms={perms}
              mode="history"
              search={historySearch}
              setSearch={setHistorySearch}
              selectedForMerge={new Set()}
              mergeEligible={false}
              onOpenMerge={() => {}}
              onSort={handleHistorySort}
              sortCol={historySortCol}
              sortDir={historySortDir}
              highlightedRowId={highlightedRowId}
              expandedRequestId={expandedHistoryRequestId}
              onRowToggle={setExpandedHistoryRequestId}
              onToggleSelect={() => {}}
              onEditItem={() => {}}
              onDeleteItem={() => {}}
              onAddItem={() => {}}
              onConvert={() => {}}
              onUploadQuote={() => {}}
              onDownloadQuote={handleDownloadQuote}
              onDeleteQuote={setDeleteQuoteTarget}
              onDeleteRequest={() => {}}
              onNavigateToPendingOrder={onNavigateToPendingOrder}
              onNavigateToLicense={onNavigateToLicense}
              onConvertFreeware={() => {}}
              onRefetch={refetchHistory}
              onExportCsv={() => {}}
              footer={(
                <ProcurementTablePagination
                  currentPage={historyPage}
                  itemLabel="requests"
                  pageSize={historyPageSize}
                  setCurrentPage={setHistoryPage}
                  setPageSize={setHistoryPageSize}
                  totalItems={displayedHistory.length}
                  userSettings={userSettings}
                />
              )}
            />
          </div>
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
          userSettings={userSettings}
        />
      )}

      {showSourcingModal !== null && (
        <SourcingItemModal
          key={showSourcingModal.item?.id ?? "new"}
          item={showSourcingModal.item}
          requestId={showSourcingModal.request?.id ?? null}
          sourcingRequest={showSourcingModal.request}
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
            const { maintenanceCompanion, ...itemForm } = form;
            const payload = {
              publisherName: itemForm.publisherName,
              softwareDescription: itemForm.softwareDescription,
              licenseType: itemForm.licenseType || null,
              maintenanceCoverage: itemForm.maintenanceCoverage || null,
              maintenanceStartDate: itemForm.maintenanceStartDate || null,
              maintenanceEndDate: itemForm.maintenanceEndDate || null,
              maintenancePricingBasis: itemForm.maintenancePricingBasis || null,
              maintenanceQuantity: itemForm.maintenanceQuantity || null,
              maintenanceUnitPrice: itemForm.maintenanceUnitPrice || null,
              maintenanceCost: itemForm.maintenanceCost || null,
              quantity: itemForm.quantity || null,
              estimatedUnitPrice: itemForm.estimatedUnitPrice || null,
              estimatedTotalPrice: itemForm.estimatedTotalPrice || null,
              currency: itemForm.currency || "EUR",
              startDate: itemForm.startDate || null,
              endDate: itemForm.endDate || null,
              supplier: itemForm.supplier || null,
              contactEmail: itemForm.contactEmail || null,
              notes: itemForm.notes || null,
            };
            const parentRequestId = showSourcingModal.request?.id
              ?? showSourcingModal.item?.sourcingRequestId
              ?? showSourcingModal.item?.sourcing_request_id
              ?? null;
            let parentItemId = showSourcingModal.item?.id ?? null;
            const saved = showSourcingModal.item
              ? await handleUpdateSourcingItem(showSourcingModal.item.id, payload)
              : await handleCreateSourcingItem(payload, parentRequestId);
            if (!saved) return false;
            if (!parentItemId) {
              parentItemId = findCreatedSourcingItem(saved, payload)?.id ?? null;
            }
            if (maintenanceCompanion) {
              await saveMaintenanceCompanion({
                companion: maintenanceCompanion,
                parentItemId,
                parentRequestId,
                parentRequestSupplier: payload.supplier,
              });
            }
            setShowSourcingModal(null);
            return true;
          }}
        />
      )}

      {showSourcingRequestEditModal !== null && (
        <SourcingRequestEditModal
          request={showSourcingRequestEditModal}
          userSettings={userSettings}
          onCancel={() => setShowSourcingRequestEditModal(null)}
          onSave={(payload) => handleUpdateSourcingRequest(showSourcingRequestEditModal.id, payload)}
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

      {directConversionTarget !== null && (
        <ConfirmDialog
          title="Convert to License Registry"
          message={
            directConversionTarget.item
              ? `Create an active Freeware / Open Source license for ${directConversionTarget.item.softwareDescription}?`
              : `Create active Freeware / Open Source licenses for all ${directConversionOpenCount} open ${directConversionOpenCount === 1 ? "line" : "lines"}?`
          }
          confirmLabel="Convert to Registry"
          onCancel={() => setDirectConversionTarget(null)}
          onConfirm={async () => {
            const success = await handleConvertFreeware({
              itemId: directConversionTarget.item?.id ?? null,
              requestId: directConversionTarget.request?.id ?? null,
            });
            if (success) setDirectConversionTarget(null);
          }}
        />
      )}

      {deleteQuoteTarget !== null && (
        <ConfirmDialog
          title="Delete Quote"
          message={`Delete "${deleteQuoteTarget.originalFilename ?? deleteQuoteTarget.original_filename ?? "this quote"}"?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteQuoteTarget(null)}
          onConfirm={async () => {
            const success = await handleDeleteQuote(deleteQuoteTarget);
            if (success) setDeleteQuoteTarget(null);
          }}
        />
      )}

      {deleteSourcingRequestTarget !== null && (
        <ConfirmDialog
          title="Cancel Sourcing Request"
          message="Move this sourcing request and its license lines to history? It will leave the active queue, but its quote, prices, and notes stay available for reference."
          confirmLabel="Cancel Request"
          danger
          onCancel={() => setDeleteSourcingRequestTarget(null)}
          onConfirm={async () => {
            const success = await handleCancelSourcingRequest(deleteSourcingRequestTarget);
            if (success) setDeleteSourcingRequestTarget(null);
          }}
        />
      )}
    </>
  );
}
