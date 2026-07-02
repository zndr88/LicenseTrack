import React, { useState } from "react";
import { ROLE_PERMISSIONS } from "../../constants/permissions.js";
import Icon from "../ui/Icon.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import PendingOrderModal from "../procurement/PendingOrderModal.jsx";
import ConvertPendingOrderModal from "../procurement/ConvertPendingOrderModal.jsx";
import ConvertAllModal from "../procurement/ConvertAllModal.jsx";
import AddPOLineItemsModal from "../procurement/AddPOLineItemsModal.jsx";
import SourcingItemModal from "../procurement/SourcingItemModal.jsx";
import PendingOrdersTable from "./pendingOrders/PendingOrdersTable.jsx";
import { usePendingOrdersPageState } from "./pendingOrders/usePendingOrdersPageState.js";
import { usePendingOrdersData } from "./usePendingOrdersData.js";

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
  const {
    pendingOrders,
    pendingOrdersLoading,
    refetch,
    licenses,
    addingPOItems,
    handleCreatePendingOrder,
    handleUpdatePendingOrder,
    handleDeletePendingOrder,
    handleConvertToLicense,
    handleAddPOItems,
    handleUpdatePOItem,
    handleDeletePOItem,
    handleUploadPurchaseOrderDocument,
    handleDownloadPurchaseOrderDocument,
    handleDownloadSourcingQuote,
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
  });

  const perms = ROLE_PERMISSIONS[user.role];
  const locale = userSettings.numberFormatLocale ?? "en-US";

  const [showPendingOrderModal, setShowPendingOrderModal] = useState(null);
  const [showConvertToLicenseModal, setShowConvertToLicenseModal] = useState(null);
  const [showConvertAllModal, setShowConvertAllModal] = useState(null);
  const [showAddPOItemsModal, setShowAddPOItemsModal] = useState(null);
  const [showEditPOItemModal, setShowEditPOItemModal] = useState(null);
  const [deletePOItemTarget, setDeletePOItemTarget] = useState(null);
  const purchaseOrderInputRef = React.useRef(null);
  const purchaseOrderTargetRef = React.useRef(null);

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
    buildPrefillFromOrder,
    deletePendingOrderId,
    displayed,
    expandedPendingOrderId,
    handleSort,
    highlightedRowId,
    search,
    setDeletePendingOrderId,
    setExpandedPendingOrderId,
    setSearch,
    sortCol,
    sortDir,
  } = usePendingOrdersPageState({
    pendingOrders,
    licenses,
    highlightId,
    onClearHighlight,
  });

  return (
    <>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2>Pending Orders</h2>
            <p>Purchase orders approved for procurement, pending invoice</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={purchaseOrderInputRef} type="file" style={{ display: "none" }} onChange={handlePurchaseOrderSelected} />
            <button className="btn btn-g" onClick={refetch} title="Refresh pending orders" style={{ fontSize: 12 }}>
              <Icon name="refresh" size={13} />Refresh
            </button>
            <button
              type="button"
              onClick={handleExportPendingOrdersCsv}
              className="btn btn-g"
              style={{ fontSize: 12 }}
            >
              <Icon name="download" size={13} />Export CSV
            </button>
            {perms.canEdit && (
              <button className="btn btn-p" onClick={() => setShowPendingOrderModal({ order: null })}>
                <Icon name="plus" size={13} />Add PO
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
            <p>Convert a sourcing item or add a PO directly.</p>
          </div>
        ) : (
          <PendingOrdersTable
            displayed={displayed}
            expandedPendingOrderId={expandedPendingOrderId}
            highlightedRowId={highlightedRowId}
            locale={locale}
            settings={userSettings}
            onDelete={setDeletePendingOrderId}
            onEdit={(po) => setShowPendingOrderModal({ order: po })}
            onEditItem={(po, item) => setShowEditPOItemModal({ order: po, item })}
            onDeleteItem={(po, item) => setDeletePOItemTarget({ order: po, item })}
            onUploadPurchaseOrder={handleOpenPurchaseOrderUpload}
            onDownloadPurchaseOrder={handleDownloadPurchaseOrderDocument}
            onDownloadQuote={handleDownloadSourcingQuote}
            onOpenAddItems={(po) => setShowAddPOItemsModal({ order: po })}
            onOpenConvert={(po) => setShowConvertToLicenseModal({
              order: po,
              prefill: buildPrefillFromOrder(po),
            })}
            onOpenConvertAll={setShowConvertAllModal}
            onRowToggle={setExpandedPendingOrderId}
            perms={perms}
            search={search}
            setSearch={setSearch}
            sortCol={sortCol}
            sortDir={sortDir}
            onSort={handleSort}
          />
        )}
      </div>

      {showConvertAllModal && (
        <ConvertAllModal
          key={showConvertAllModal?.id ?? "new"}
          order={showConvertAllModal}
          licenses={licenses}
          userSettings={userSettings}
          onConfirm={async (orderId, payload) => {
            const ok = await handleBatchConvert(orderId, payload, showConvertAllModal?.poNumber);
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
              supplier: form.supplier || null,
              notes: form.notes || null,
              items: form.items,
              quoteFile: form.quoteFile,
            };
            const success = showPendingOrderModal.order
              ? await handleUpdatePendingOrder(showPendingOrderModal.order.id, { poNumber: payload.poNumber, supplier: payload.supplier, notes: payload.notes })
              : await handleCreatePendingOrder(payload);
            if (success) setShowPendingOrderModal(null);
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
            const payload = {
              publisherName: form.publisherName,
              softwareDescription: form.softwareDescription,
              quantity: form.quantity || null,
              estimatedUnitPrice: form.estimatedUnitPrice || null,
              estimatedTotalPrice: form.estimatedTotalPrice || null,
              currency: form.currency || "EUR",
              supplier: form.supplier || null,
              contactEmail: form.contactEmail || null,
              notes: form.notes || null,
            };
            const success = await handleUpdatePOItem(
              showEditPOItemModal.order.id,
              showEditPOItemModal.item.id,
              payload,
            );
            if (success) setShowEditPOItemModal(null);
          }}
        />
      )}

      {deletePendingOrderId !== null && (
        <ConfirmDialog
          title="Delete Pending Order"
          message="Are you sure you want to delete this pending order? Associated sourcing items will not be deleted."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeletePendingOrderId(null)}
          onConfirm={async () => {
            const success = await handleDeletePendingOrder(deletePendingOrderId);
            if (success) setDeletePendingOrderId(null);
          }}
        />
      )}

      {deletePOItemTarget !== null && (
        <ConfirmDialog
          title="Delete PO Line Item"
          message={`Delete "${deletePOItemTarget.item.publisherName} - ${deletePOItemTarget.item.softwareDescription}" from this pending order?`}
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
