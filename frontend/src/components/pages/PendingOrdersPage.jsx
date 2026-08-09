import React, { useEffect, useMemo, useState } from "react";
import { ROLE_PERMISSIONS } from "../../constants/permissions.js";
import Icon from "../ui/Icon.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import PendingOrderModal from "../procurement/PendingOrderModal.jsx";
import ConvertPendingOrderModal from "../procurement/ConvertPendingOrderModal.jsx";
import ConvertAllModal from "../procurement/ConvertAllModal.jsx";
import AddPOLineItemsModal from "../procurement/AddPOLineItemsModal.jsx";
import SourcingItemModal from "../procurement/SourcingItemModal.jsx";
import PendingOrdersTable from "./pendingOrders/PendingOrdersTable.jsx";
import { filterAndSortPendingOrders, usePendingOrdersPageState } from "./pendingOrders/usePendingOrdersPageState.js";
import { usePendingOrdersData } from "./usePendingOrdersData.js";
import { buildConvertItemDefaults } from "../../utils/buildConvertItemDefaults.js";
import { pendingOrderLabel } from "../../utils/procurementLabels.js";
import ProcurementTablePagination, {
  getPaginationDetails,
  paginateRows,
} from "../procurement/ProcurementTablePagination.jsx";

export default function PendingOrdersPage({
  user, userSettings,
  onLicensesReload,
  onRenewalsReload,
  onPortfolioStateChange,
  onNotificationsReload,
  onNavigateToLicense,
  showError,
  showSuccess,
  highlightId, onClearHighlight,
}) {
  const [showPendingOrderModal, setShowPendingOrderModal] = useState(null);
  const [showConvertToLicenseModal, setShowConvertToLicenseModal] = useState(null);
  const [showConvertAllModal, setShowConvertAllModal] = useState(null);
  const [showAddPOItemsModal, setShowAddPOItemsModal] = useState(null);
  const [showEditPOItemModal, setShowEditPOItemModal] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [deletePurchaseOrderDocumentTarget, setDeletePurchaseOrderDocumentTarget] = useState(null);
  const [deleteQuoteTarget, setDeleteQuoteTarget] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historySortCol, setHistorySortCol] = useState("created");
  const [historySortDir, setHistorySortDir] = useState("desc");
  const [expandedHistoryPendingOrderId, setExpandedHistoryPendingOrderId] = useState(null);
  const [highlightedHistoryRowId, setHighlightedHistoryRowId] = useState(null);
  const [deletePOItemTarget, setDeletePOItemTarget] = useState(null);
  const purchaseOrderInputRef = React.useRef(null);
  const purchaseOrderTargetRef = React.useRef(null);

  const {
    pendingOrders,
    pendingOrderHistory,
    pendingOrdersLoading,
    historyLoading,
    refetch,
    refetchHistory,
    licenses,
    addingPOItems,
    handleCancelPendingOrder,
    handleCreatePendingOrder,
    handleUpdatePendingOrder,
    handleConvertToLicense,
    handleAddPOItems,
    handleUpdatePOItem,
    handleDeletePOItem,
    handleUploadPurchaseOrderDocument,
    handleDownloadPurchaseOrderDocument,
    handleDeletePurchaseOrderDocument,
    handleDownloadSourcingQuote,
    handleDeleteSourcingQuote,
    handleRetryEvidenceTransfer,
    handleBatchConvert,
    handleExportPendingOrdersCsv,
  } = usePendingOrdersData({
    showError,
    showSuccess,
    onLicensesReload,
    onRenewalsReload,
    onPortfolioStateChange,
    onNotificationsReload,
    onNavigateToLicense,
    userSettings,
    includeHistory: showHistory,
  });

  const perms = ROLE_PERMISSIONS[user.role];
  const locale = userSettings.numberFormatLocale ?? "en-US";

  const handleOpenPurchaseOrderUpload = (po) => {
    purchaseOrderTargetRef.current = po;
    purchaseOrderInputRef.current?.click();
  };

  const handlePurchaseOrderSelected = async (event) => {
    const file = event.target.files?.[0];
    const target = purchaseOrderTargetRef.current;
    event.target.value = "";
    if (!file || !target?.id) return;
    await handleUploadPurchaseOrderDocument(target.id, file);
  };

  const {
    cancelPendingOrderId,
    displayed,
    expandedPendingOrderId,
    handleSort,
    highlightedRowId,
    search,
    setCancelPendingOrderId,
    setExpandedPendingOrderId,
    setSearch,
    sortCol,
    sortDir,
  } = usePendingOrdersPageState({
    pendingOrders,
    highlightId,
    onClearHighlight,
  });

  const displayedHistory = useMemo(
    () => filterAndSortPendingOrders(pendingOrderHistory, historySearch, historySortCol, historySortDir),
    [pendingOrderHistory, historySearch, historySortCol, historySortDir]
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

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, historySortCol, historySortDir]);

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  useEffect(() => {
    if (!highlightId) return;
    if (pendingOrdersLoading) return;
    if (pendingOrders.some((po) => po.id === highlightId)) return;
    setShowHistory(true);
  }, [highlightId, pendingOrders, pendingOrdersLoading]);

  useEffect(() => {
    if (!highlightId || !showHistory) return;
    if (!pendingOrderHistory.some((po) => po.id === highlightId)) return;

    setExpandedHistoryPendingOrderId(highlightId);
    const scrollTimer = setTimeout(() => {
      const element = document.querySelector(`[data-po-row="${highlightId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
    setHighlightedHistoryRowId(highlightId);
    const clearTimer = setTimeout(() => {
      setHighlightedHistoryRowId(null);
      onClearHighlight?.();
    }, 2000);

    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [highlightId, showHistory, pendingOrderHistory, onClearHighlight]);

  const handleHistorySort = (column) => {
    if (historySortCol !== column) {
      setHistorySortCol(column);
      setHistorySortDir("asc");
      return;
    }
    if (historySortDir === "asc") {
      setHistorySortDir("desc");
      return;
    }
    setHistorySortCol(null);
    setHistorySortDir("asc");
  };

  const deletePOItemIsLastLine = (deletePOItemTarget?.order.items?.length ?? 0) <= 1;
  const deletePOItemLabel = deletePOItemTarget
    ? `${deletePOItemTarget.item.publisherName} - ${deletePOItemTarget.item.softwareDescription}`
    : "";
  const deletePOItemMessage = deletePOItemIsLastLine
    ? `This is the last line on ${pendingOrderLabel(deletePOItemTarget?.order)}. Deleting "${deletePOItemLabel}" will cancel the pending order and move it to history. Attached PO documents and sourcing quote context will be kept for reference.`
    : `Delete "${deletePOItemLabel}" from this pending order?`;

  return (
    <>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2>Pending Orders</h2>
            <p>Procurement orders waiting for PO, invoice, or license activation</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={purchaseOrderInputRef} type="file" style={{ display: "none" }} onChange={handlePurchaseOrderSelected} />
            <button className="btn btn-g" onClick={() => setShowHistory((value) => !value)}>
              <Icon name="archive" size={13} />{showHistory ? "Hide History" : "History"}
            </button>
            {perms.canEdit && (
              <button className="btn btn-p" onClick={() => setShowPendingOrderModal({ order: null })}>
                <Icon name="plus" size={13} />Add Pending Order
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="page-content">
        {pendingOrdersLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", color: "var(--text-2)", fontSize: 13 }}>
            <div className="spinner" style={{ margin: 0, width: 18, height: 18 }} />
            Loading pending orders...
          </div>
        )}
        {!pendingOrdersLoading && pendingOrders.length === 0 ? (
          <div className="empty">
            <Icon name="clock" size={32} color="var(--text-3)" />
            <h3>No pending orders yet</h3>
            <p>Convert a sourcing item or add a pending order directly.</p>
          </div>
        ) : (
          <PendingOrdersTable
            displayed={displayed}
            expandedPendingOrderId={expandedPendingOrderId}
            highlightedRowId={highlightedRowId}
            locale={locale}
            settings={userSettings}
            onDelete={setCancelPendingOrderId}
            onEdit={(po) => setShowPendingOrderModal({ order: po })}
            onEditItem={(po, item) => setShowEditPOItemModal({ order: po, item })}
            onDeleteItem={(po, item) => setDeletePOItemTarget({ order: po, item })}
            onUploadPurchaseOrder={handleOpenPurchaseOrderUpload}
            onDownloadPurchaseOrder={handleDownloadPurchaseOrderDocument}
            onDeletePurchaseOrder={setDeletePurchaseOrderDocumentTarget}
            onDownloadQuote={handleDownloadSourcingQuote}
            onDeleteQuote={setDeleteQuoteTarget}
            onRetryEvidenceTransfer={handleRetryEvidenceTransfer}
            onOpenAddItems={(po) => setShowAddPOItemsModal({ order: po })}
            onOpenConvert={(po) => setShowConvertToLicenseModal({
              order: po,
              prefill: buildConvertItemDefaults(
                po,
                licenses,
                userSettings?.displayCurrency,
              )[0] ?? {},
            })}
            onOpenConvertAll={setShowConvertAllModal}
            onNavigateToLicense={onNavigateToLicense}
            onRefetch={refetch}
            onExportCsv={handleExportPendingOrdersCsv}
            onRowToggle={setExpandedPendingOrderId}
            perms={perms}
            search={search}
            setSearch={setSearch}
            sortCol={sortCol}
            sortDir={sortDir}
            onSort={handleSort}
          />
        )}
        {showHistory && (
          <div style={{ marginTop: 24 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Pending Order History</h3>
            <p style={{ margin: "0 0 8px", color: "var(--text-2)", fontSize: 12 }}>
              Converted and cancelled purchase orders kept for PO documents, quote context, and notes reference.
            </p>
            {historyLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", color: "var(--text-2)", fontSize: 13 }}>
                <div className="spinner" style={{ margin: 0, width: 16, height: 16 }} />
                Loading pending order history...
              </div>
            )}
            {!historyLoading && (
              <PendingOrdersTable
                displayed={paginatedHistory}
                expandedPendingOrderId={expandedHistoryPendingOrderId}
                highlightedRowId={highlightedHistoryRowId}
                locale={locale}
                mode="history"
                settings={userSettings}
                onDelete={() => {}}
                onEdit={() => {}}
                onEditItem={() => {}}
                onDeleteItem={() => {}}
                onUploadPurchaseOrder={() => {}}
                onDownloadPurchaseOrder={handleDownloadPurchaseOrderDocument}
                onDeletePurchaseOrder={setDeletePurchaseOrderDocumentTarget}
                onDownloadQuote={handleDownloadSourcingQuote}
                onDeleteQuote={setDeleteQuoteTarget}
                onRetryEvidenceTransfer={() => {}}
                onOpenAddItems={() => {}}
                onOpenConvert={() => {}}
                onOpenConvertAll={() => {}}
                onNavigateToLicense={onNavigateToLicense}
                onRefetch={refetchHistory}
                onRowToggle={setExpandedHistoryPendingOrderId}
                perms={perms}
                search={historySearch}
                setSearch={setHistorySearch}
                sortCol={historySortCol}
                sortDir={historySortDir}
                onSort={handleHistorySort}
                footer={(
                  <ProcurementTablePagination
                    currentPage={historyPage}
                    itemLabel="orders"
                    pageSize={historyPageSize}
                    setCurrentPage={setHistoryPage}
                    setPageSize={setHistoryPageSize}
                    totalItems={displayedHistory.length}
                    userSettings={userSettings}
                  />
                )}
              />
            )}
          </div>
        )}
      </div>

      {showConvertAllModal && (
        <ConvertAllModal
          key={showConvertAllModal?.id ?? "new"}
          order={showConvertAllModal}
          licenses={licenses}
          userSettings={userSettings}
          onConfirm={async (orderId, payload, file = null) => {
            const ok = await handleBatchConvert(orderId, payload, pendingOrderLabel(showConvertAllModal), file);
            if (ok) setShowConvertAllModal(null);
            return ok;
          }}
          onCancel={() => setShowConvertAllModal(null)}
        />
      )}

      {showPendingOrderModal !== null && (
        <PendingOrderModal
          key={showPendingOrderModal.order?.id ?? "new"}
          order={showPendingOrderModal.order}
          userSettings={userSettings}
          onCancel={() => setShowPendingOrderModal(null)}
          onSave={async (form) => {
            const payload = {
              poNumber: form.poNumber.trim(),
              procurementReference: form.procurementReference.trim(),
              supplier: form.supplier || null,
              notes: form.notes || null,
              items: form.items,
              quoteFile: form.quoteFile,
            };
            const success = showPendingOrderModal.order
              ? await handleUpdatePendingOrder(showPendingOrderModal.order.id, {
                poNumber: payload.poNumber,
                procurementReference: payload.procurementReference,
                supplier: payload.supplier,
                notes: payload.notes,
              })
              : await handleCreatePendingOrder(payload);
            if (success) setShowPendingOrderModal(null);
            return success;
          }}
        />
      )}

      {showConvertToLicenseModal !== null && (
        <ConvertPendingOrderModal
          key={showConvertToLicenseModal.order?.id ?? "new"}
          order={showConvertToLicenseModal.order}
          prefill={showConvertToLicenseModal.prefill}
          licenses={licenses}
          userSettings={userSettings}
          onCancel={() => setShowConvertToLicenseModal(null)}
          onConfirm={async (licenseData, file) => {
            const ok = await handleConvertToLicense(showConvertToLicenseModal.order.id, licenseData, file);
            if (ok) setShowConvertToLicenseModal(null);
            return ok;
          }}
        />
      )}

      {showEditPOItemModal !== null && (
        <SourcingItemModal
          key={showEditPOItemModal.item?.id ?? "new"}
          item={showEditPOItemModal.item}
          userSettings={userSettings}
          title="Edit PO Line Item"
          onCancel={() => setShowEditPOItemModal(null)}
          onSave={async (form) => {
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
            let success = await handleUpdatePOItem(
              showEditPOItemModal.order.id,
              showEditPOItemModal.item.id,
              payload,
            );
            if (success && maintenanceCompanion) {
              success = await handleAddPOItems(showEditPOItemModal.order.id, [maintenanceCompanion]);
            }
            if (success) setShowEditPOItemModal(null);
            return success;
          }}
        />
      )}

      {cancelPendingOrderId !== null && (
        <ConfirmDialog
          title="Cancel Pending Order"
          message="Move this pending order and its line items to history. Attached PO documents and sourcing quote context will be kept for reference."
          confirmLabel="Cancel Order"
          danger
          onCancel={() => setCancelPendingOrderId(null)}
          onConfirm={async () => {
            const success = await handleCancelPendingOrder(cancelPendingOrderId);
            if (success) setCancelPendingOrderId(null);
          }}
        />
      )}

      {deletePurchaseOrderDocumentTarget !== null && (
        <ConfirmDialog
          title="Delete PO"
          message={`Delete "${deletePurchaseOrderDocumentTarget.originalFilename ?? deletePurchaseOrderDocumentTarget.original_filename ?? "this purchase order"}"?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeletePurchaseOrderDocumentTarget(null)}
          onConfirm={async () => {
            const success = await handleDeletePurchaseOrderDocument(deletePurchaseOrderDocumentTarget);
            if (success) setDeletePurchaseOrderDocumentTarget(null);
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
            const success = await handleDeleteSourcingQuote(deleteQuoteTarget);
            if (success) setDeleteQuoteTarget(null);
          }}
        />
      )}

      {deletePOItemTarget !== null && (
        <ConfirmDialog
          title="Delete PO Line Item"
          message={deletePOItemMessage}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeletePOItemTarget(null)}
          onConfirm={async () => {
            const success = await handleDeletePOItem(deletePOItemTarget.order.id, deletePOItemTarget.item.id);
            if (success) setDeletePOItemTarget(null);
          }}
        />
      )}

      {showAddPOItemsModal !== null && (
        <AddPOLineItemsModal
          key={showAddPOItemsModal.order?.id ?? "new"}
          po={showAddPOItemsModal.order}
          saving={addingPOItems}
          userSettings={userSettings}
          onCancel={() => setShowAddPOItemsModal(null)}
          onSave={async (items) => {
            const ok = await handleAddPOItems(showAddPOItemsModal.order.id, items);
            if (ok) setShowAddPOItemsModal(null);
          }}
        />
      )}
    </>
  );
}
