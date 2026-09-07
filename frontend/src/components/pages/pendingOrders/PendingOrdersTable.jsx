import React from "react";
import Icon from "../../ui/Icon.jsx";
import SearchBox from "../../ui/SearchBox.jsx";
import RowActionsMenu from "../../ui/RowActionsMenu.jsx";
import ProcurementInlineEditCell, { ProcurementInlineEditField } from "../../procurement/ProcurementInlineEditCell.jsx";
import { CURRENCIES } from "../../../constants/licenseData.js";
import { formatCost } from "../../../utils/helpers.js";
import { formatPoTotal } from "./usePendingOrdersPageState.js";
import { formatDateTime } from "../../../utils/formatting.js";
import { procurementLineTotal } from "../../../utils/procurementTotals.js";
import { formatQuantity } from "../../../utils/quantity.js";
import { hasPurchaseOrderNumber, pendingOrderLabel } from "../../../utils/procurementLabels.js";
import { documentAvailabilityHelp, documentAvailabilityLabel, documentAvailabilitySummary, isFileAvailable } from "../../../utils/documentAvailability.js";
import { isPreviewablePdf } from "../../../utils/documentPreview.js";

function SortIndicator({ active, dir }) {
  if (!active) return null;

  return (
    <span
      style={{
        marginLeft: 4,
        fontSize: 10,
        color: "var(--accent)",
        verticalAlign: "middle",
      }}
    >
      {dir === "asc" ? "\u25b2" : "\u25bc"}
    </span>
  );
}

function SortableHeader({ column, label, sortCol, sortDir, onSort }) {
  return (
    <th
      scope="col"
      style={{ cursor: "pointer", userSelect: "none" }}
      onClick={() => onSort(column)}
    >
      {label}
      <SortIndicator active={sortCol === column} dir={sortDir} />
    </th>
  );
}

function OrderDocumentsCell({ order }) {
  const purchaseOrderDocuments = (order.documents ?? []).filter((document) => document.category === "purchase_order");
  const quoteDocuments = quoteDocumentsForOrder(order);

  if (!purchaseOrderDocuments.length && !quoteDocuments.length) {
    return <span style={{ fontSize: 11, color: "var(--text-3)" }}>None</span>;
  }

  const summary = documentAvailabilitySummary([...purchaseOrderDocuments, ...quoteDocuments]);
  const labels = [];
  if (purchaseOrderDocuments.length) labels.push(purchaseOrderDocuments.length === 1 ? "1 PO" : `${purchaseOrderDocuments.length} POs`);
  if (quoteDocuments.length) labels.push(quoteDocuments.length === 1 ? "1 quote" : `${quoteDocuments.length} quotes`);
  return <span className="badge badge-gray" title={summary.available === summary.total ? "All files available" : `${summary.missing + summary.unavailable} file(s) need attention`}>
    {labels.join(" · ")}
    {summary.available !== summary.total ? ` · ${summary.missing + summary.unavailable} unavailable` : ""}
  </span>;
}

function documentFilename(document, fallback) {
  return document.originalFilename ?? document.original_filename ?? fallback;
}

function downloadDocumentLabel(document, fallback) {
  const filename = documentFilename(document, fallback);
  return isFileAvailable(document) ? `Download ${filename}` : `${documentAvailabilityLabel(document)}: ${filename}`;
}

function quoteDocumentsForOrder(order) {
  const seen = new Set();
  return (order.items ?? []).flatMap((item) => item.quoteDocuments ?? []).filter((document, index) => {
    const key = document.id ?? `${documentFilename(document, "quote")}-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isPendingOrderEditable(order) {
  return order.status === "pending" || order.status === "invoice_received";
}

function PendingOrderItemsRow({
  po,
  licenses,
  locale,
  userSettings,
  perms,
  readOnly = false,
  onAddItem,
  onDeleteItem,
  onEditItem,
  onNavigateToLicense,
  inlineEditEnabled,
  onInlineItemFieldSave,
  showCurrency,
}) {
  const saveItemField = (itemId, fieldKey, value) => (
    onInlineItemFieldSave(po.id, itemId, fieldKey, value)
  );

  return (
    <tr>
      <td colSpan={9} style={{ padding: 0, background: "var(--bg-2)" }}>
        <table className="pending-order-lines-table">
          <colgroup>
            <col style={{ width: "21%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "13%" }} />
            {showCurrency && <col style={{ width: "7%" }} />}
            <col />
          </colgroup>
          <thead>
            <tr style={{ background: "var(--bg-3)" }}>
              <th scope="col" style={{ paddingLeft: 40 }}>Publisher</th>
              <th scope="col">Description</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit price{!showCurrency && po.items[0]?.currency ? ` (${po.items[0].currency})` : ""}</th>
              <th scope="col">Line Total</th>
              {showCurrency && <th scope="col">Currency</th>}
              <th scope="col">{readOnly ? "Context" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item) => {
              const predecessor = item.isRenewal ? licenses.find((license) => license.id === item.renewalForLicenseId) : null;
              const previousDescription = predecessor?.softwareDescription?.trim();
              const renewalContext = item.isRenewal && (
                <div className="sourcing-inline-context">
                  <span className="badge badge-pending">{item.cotermPredecessorIds?.length > 0 ? "Coterm Renewal" : "Renewal"}</span>
                  {previousDescription && previousDescription !== item.softwareDescription?.trim() && (
                    <div>Previous license: {previousDescription}</div>
                  )}
                </div>
              );
              const canInlineEdit = inlineEditEnabled && !readOnly && isPendingOrderEditable(po) && perms.canEdit;
              return (
                <tr
                  key={item.id}
                  data-po-item-row={item.id}
                  className={canInlineEdit ? "pending-order-line-row-inline-edit" : undefined}
                  style={{ backgroundColor: "var(--bg-2)" }}
                >
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell
                      item={item}
                      fieldKey="publisherName"
                      label="Publisher"
                      currentValue={item.publisherName}
                      required
                      referenceMode="publisher"
                      className="pending-order-inline-publisher"
                      userSettings={userSettings}
                      onSave={saveItemField}
                    >
                      <div className="sourcing-inline-context">Pending Order Line ID #{item.id}</div>
                    </ProcurementInlineEditCell>
                  ) : (
                    <td style={{ paddingLeft: 40, fontWeight: 600 }}>
                      {item.publisherName}
                      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400, marginTop: 2 }}>
                        Pending Order Line ID #{item.id}
                      </div>
                    </td>
                  )}
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell
                      item={item}
                      fieldKey="softwareDescription"
                      label="Description"
                      currentValue={item.softwareDescription}
                      required
                      className="pending-order-inline-description"
                      userSettings={userSettings}
                      onSave={saveItemField}
                    >
                      {renewalContext}
                    </ProcurementInlineEditCell>
                  ) : <td>{item.softwareDescription}{renewalContext}</td>}
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell item={item} fieldKey="quantity" label="Quantity" currentValue={item.quantity} valueType="quantity" userSettings={userSettings} onSave={saveItemField} />
                  ) : <td>{formatQuantity(item.quantity, userSettings) || "-"}</td>}
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell item={item} fieldKey="estimatedUnitPrice" label="Estimated unit price" currentValue={item.estimatedUnitPrice} valueType="money" userSettings={userSettings} onSave={saveItemField} />
                  ) : <td>{formatCost(item.estimatedUnitPrice, item.currency, locale)}</td>}
                  <td>{formatCost(procurementLineTotal(item), item.currency, locale)}</td>
                  {showCurrency && (canInlineEdit ? (
                    <ProcurementInlineEditCell item={item} fieldKey="currency" label="Currency" currentValue={item.currency} options={CURRENCIES} userSettings={userSettings} onSave={saveItemField} />
                  ) : <td>{item.currency}</td>)}
                  <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {readOnly && !item.isRenewal && (
                      <span className="badge badge-gray">
                        New Purchase
                      </span>
                    )}
                    {readOnly && item.convertedLicenseId && onNavigateToLicense && (
                      <button
                        className="btn btn-g"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onNavigateToLicense(item.convertedLicenseId);
                        }}
                      >
                        <Icon name="arrow-right" size={12} />{item.convertedLicenseRetired ? "View Retired License" : "View License"}
                      </button>
                    )}
                    {readOnly && !item.convertedLicenseId && (item.convertedLicenseIds?.length ?? 0) > 1 && (
                      <span style={{ color: "var(--text-3)", fontSize: 11 }}>Multiple license matches</span>
                    )}
                    {!readOnly && perms.canEdit && (
                      <button className="btn btn-g" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => onEditItem(po, item)}>
                        <Icon name="edit" size={12} />Edit
                      </button>
                    )}
                    {!readOnly && perms.canDelete && (
                      <button className="btn btn-g" style={{ padding: "4px 8px", fontSize: 11, color: "var(--red)" }} onClick={() => onDeleteItem(po, item)}>
                        <Icon name="trash" size={12} />Delete
                      </button>
                    )}
                  </div>
                  </td>
                </tr>
              );
            })}
            {!readOnly && perms.canEdit && (
              <tr style={{ background: "var(--bg-2)" }}>
                <td colSpan={showCurrency ? 7 : 6} style={{ paddingLeft: 40 }}>
                  <button className="btn btn-g" style={{ padding: "5px 9px", fontSize: 11 }} onClick={() => onAddItem(po)}>
                    <Icon name="plus" size={12} />Add License Line
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

export default function PendingOrdersTable({
  displayed,
  expandedPendingOrderId,
  expandedPendingOrderIds,
  onSetAllExpanded,
  licenses = [],
  highlightedRowId,
  locale,
  mode = "active",
  settings,
  onDelete,
  onEdit,
  onEditItem,
  onDeleteItem,
  onUploadPurchaseOrder,
  onDownloadPurchaseOrder,
  onDeletePurchaseOrder,
  onPreviewQuote,
  onDownloadQuote,
  onDeleteQuote,
  onRetryEvidenceTransfer,
  onOpenAddItems,
  onOpenConvert,
  onOpenConvertAll,
  onNavigateToLicense,
  onRefetch,
  onExportCsv,
  onRowToggle,
  perms,
  search,
  setSearch,
  sortCol,
  sortDir,
  onSort,
  inlineEditEnabled = false,
  onToggleInlineEdit,
  onInlineOrderFieldSave,
  onInlineItemFieldSave,
  footer = null,
}) {
  const readOnly = mode === "history";
  const expandableOrders = displayed.filter((order) => order.items?.length > 0);
  const allExpanded = expandableOrders.length > 0 && expandableOrders.every((order) => expandedPendingOrderIds?.has(order.id));
  const showCurrency = inlineEditEnabled || displayed.some((order) => new Set((order.items ?? []).map((item) => item.currency)).size > 1);
  const emptyMessage = readOnly ? "No historical orders match your search." : "No orders match your search.";
  const renderReferenceCell = (po) => {
    if (po.status === "converted" && po.convertedLicenseId && onNavigateToLicense) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
          <button
            className="btn btn-g"
            style={{ padding: "4px 8px", fontSize: 11 }}
            onClick={() => onNavigateToLicense(po.convertedLicenseId)}
          >
            <Icon name="arrow-right" size={12} />{po.convertedLicenseRetired ? "View Retired License" : "View License"}
          </button>
          {po.convertedLicenseRef && (
            <span style={{ color: "var(--text-3)", fontSize: 10 }}>{po.convertedLicenseRef}</span>
          )}
        </div>
      );
    }
    if (po.status === "converted" && (po.convertedLicenseIds?.length ?? 0) > 1 && (po.items?.length ?? 0) > 0) {
      return <span style={{ color: "var(--text-3)", fontSize: 11 }}>Open a line to view license</span>;
    }
    if (po.status === "converted") {
      return <span style={{ color: "var(--text-3)", fontSize: 11 }}>Licenses created</span>;
    }
    if (po.status === "cancelled") {
      return <span style={{ color: "var(--text-3)", fontSize: 11 }}>Reference only</span>;
    }
    return <span style={{ color: "var(--text-3)", fontSize: 11 }}>Open order</span>;
  };

  return (
    <div className="tbl-wrap">
      <div className="tbl-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search order, reference, supplier, or line items..."
          ariaLabel={readOnly ? "Search pending order history" : "Search pending orders"}
        />
        {readOnly && (
          <>
            <div style={{ flex: 1 }} />
            <button className="btn btn-g" onClick={onRefetch} title="Refresh pending order history" style={{ fontSize: 12 }}>
              <Icon name="refresh" size={13} />Refresh
            </button>
          </>
        )}
        {!readOnly && (
          <>
            <div style={{ flex: 1 }} />
            {onSetAllExpanded && displayed.some((order) => order.items?.length > 0) && (
              <>
                <button type="button" className="btn btn-g" onClick={() => onSetAllExpanded(!allExpanded)}>
                  {allExpanded ? "Collapse all" : "Expand all"}
                </button>
              </>
            )}
            {perms.canEdit && (
              <button
                type="button"
                className={`btn btn-g procurement-inline-toggle ${inlineEditEnabled ? "procurement-inline-toggle-active" : ""}`}
                onClick={onToggleInlineEdit}
                title={inlineEditEnabled ? "Finish editing" : "Edit pending orders"}
                aria-label={inlineEditEnabled ? "Done editing" : "Edit in table"}
                aria-pressed={inlineEditEnabled}
              >
                <Icon name={inlineEditEnabled ? "check" : "edit"} size={13} />
                {inlineEditEnabled ? "Done editing" : "Edit in table"}
              </button>
            )}
            <button className="btn btn-g" onClick={onRefetch} title="Refresh pending orders" style={{ fontSize: 12 }}>
              <Icon name="refresh" size={13} />Refresh
            </button>
            <button type="button" onClick={onExportCsv} className="btn btn-g" style={{ fontSize: 12 }}>
              <Icon name="download" size={13} />Export CSV
            </button>
          </>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: 28 }} />
              <SortableHeader column="poNumber" label="Order" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <SortableHeader column="supplier" label="Supplier" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <SortableHeader column="itemCount" label="Items" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <SortableHeader column="totalValue" label="Total PO Value" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <SortableHeader column="created" label="Created" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <th scope="col">Documents</th>
              <SortableHeader column="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <th scope="col">{readOnly ? "Reference" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--text-3)", padding: "24px 0", fontSize: 13 }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : displayed.map((po) => {
              const isExpanded = expandedPendingOrderIds ? expandedPendingOrderIds.has(po.id) : expandedPendingOrderId === po.id;
              const canInlineEditOrder = inlineEditEnabled && !readOnly && isPendingOrderEditable(po) && perms.canEdit;
              const canDelete = po.status === "pending" || po.status === "invoice_received";
              const isInvoiceReceived = po.status === "invoice_received";
              const evidenceStatus = po.evidenceTransferStatus ?? po.evidence_transfer_status;
              const evidenceDetail = po.evidenceTransferDetail ?? po.evidence_transfer_detail;
              const canRetryEvidence = po.status === "converted" && ["failed", "pending", "escalated"].includes(evidenceStatus);
              const hasPoNumber = hasPurchaseOrderNumber(po);
              const hasLineItems = (po.items?.length ?? 0) > 0;
              const purchaseOrderDocuments = (po.documents ?? []).filter((document) => document.category === "purchase_order");
              const quoteDocuments = quoteDocumentsForOrder(po);
              const documentMenuItems = [
                ...purchaseOrderDocuments.map((document, index) => ({
                  key: `po-${document.id ?? index}`,
                  label: downloadDocumentLabel(document, "PO"),
                  icon: "download",
                  disabled: !isFileAvailable(document),
                  title: documentAvailabilityHelp(document),
                  onClick: () => onDownloadPurchaseOrder(document),
                })),
                ...quoteDocuments.map((document, index) => ({
                  key: `preview-quote-${document.id ?? index}`,
                  label: `Preview ${documentFilename(document, "quote")}`,
                  icon: "eye",
                  disabled: !isPreviewablePdf(document),
                  title: !isFileAvailable(document)
                    ? documentAvailabilityHelp(document)
                    : "Preview is available for PDF quote documents",
                  onClick: () => onPreviewQuote(document),
                })),
                ...quoteDocuments.map((document, index) => ({
                  key: `quote-${document.id ?? index}`,
                  label: downloadDocumentLabel(document, "quote"),
                  icon: "download",
                  disabled: !isFileAvailable(document),
                  title: documentAvailabilityHelp(document),
                  onClick: () => onDownloadQuote(document),
                })),
                ...purchaseOrderDocuments.map((document, index) => ({
                  key: `delete-po-${document.id ?? index}`,
                  label: `Delete ${documentFilename(document, "PO")}`,
                  icon: "trash",
                  danger: true,
                  separatorBefore: index === 0,
                  hidden: !perms.canEdit,
                  onClick: () => onDeletePurchaseOrder(document),
                })),
                ...quoteDocuments.map((document, index) => ({
                  key: `delete-quote-${document.id ?? index}`,
                  label: `Delete ${documentFilename(document, "quote")}`,
                  icon: "trash",
                  danger: true,
                  separatorBefore: purchaseOrderDocuments.length === 0 && index === 0,
                  hidden: !perms.canEdit,
                  onClick: () => onDeleteQuote(document),
                })),
              ];
              const menuItems = [
                {
                  key: "edit",
                  label: "Edit",
                  icon: "edit",
                  hidden: !perms.canEdit,
                  onClick: () => onEdit(po),
                },
                {
                  key: "upload-po",
                  label: "Upload PO",
                  icon: "upload",
                  hidden: !perms.canEdit,
                  onClick: () => onUploadPurchaseOrder(po),
                },
                ...documentMenuItems,
                {
                  key: "add-line",
                  label: "Add License Line",
                  icon: "plus",
                  hidden: !perms.canEdit || po.status === "converted" || !hasLineItems,
                  onClick: () => onOpenAddItems(po),
                },
                {
                  key: "retry-evidence",
                  label: "Retry Evidence",
                  icon: "refresh",
                  hidden: !perms.canEdit || !canRetryEvidence,
                  onClick: () => onRetryEvidenceTransfer(po.id),
                },
                {
                  key: "cancel",
                  label: "Cancel Order",
                  icon: "trash",
                  danger: true,
                  separatorBefore: true,
                  hidden: !perms.canDelete,
                  disabled: !canDelete,
                  title: canDelete ? "Cancel this pending order" : "Cannot cancel this order",
                  onClick: () => onDelete(po.id),
                },
              ];
              const statusLabel = po.status === "cancelled"
                ? "Cancelled"
                : po.status === "converted"
                ? (evidenceStatus === "failed" ? "Evidence Failed" : evidenceStatus === "pending" ? "Evidence Pending" : evidenceStatus === "escalated" ? "Evidence Escalated" : "Converted")
                : !hasPoNumber ? "Awaiting PO" : isInvoiceReceived ? "Invoice Received" : "Pending";
              const statusClass = po.status === "cancelled"
                ? "badge-gray"
                : evidenceStatus === "failed" || evidenceStatus === "escalated"
                ? "badge-red"
                : evidenceStatus === "pending"
                  ? "badge-pending"
                  : isInvoiceReceived || po.status === "converted" ? "badge-green" : "badge-pending";

              return (
                <React.Fragment key={po.id}>
                  <tr
                    data-po-row={po.id}
                    className={`pending-order-summary-row${canInlineEditOrder ? " pending-order-row-inline-edit" : ""}`}
                    style={{
                      cursor: po.items?.length > 0 ? "pointer" : "default",
                      ...(highlightedRowId === po.id
                        ? { background: "var(--accent-m)", transition: "background 0.3s" }
                        : {}),
                    }}
                    onClick={() => po.items?.length > 0 && onRowToggle(expandedPendingOrderIds ? po.id : isExpanded ? null : po.id)}
                  >
                    <td style={{ color: "var(--text-3)", fontSize: 11, textAlign: "center" }}>
                      {po.items?.length > 0 ? (isExpanded ? "\u25be" : "\u25b8") : ""}
                    </td>
                    {canInlineEditOrder ? (
                      <td className="lp-editable-td pending-order-inline-identifiers">
                        <ProcurementInlineEditField
                          item={po}
                          fieldKey="poNumber"
                          label="PO number"
                          currentValue={po.poNumber}
                          placeholder="Add PO number"
                          userSettings={settings}
                          onSave={onInlineOrderFieldSave}
                        />
                        <div className="sourcing-inline-context">Pending Order #{po.id}</div>
                        <ProcurementInlineEditField
                          item={po}
                          fieldKey="procurementReference"
                          label="procurement reference"
                          currentValue={po.procurementReference}
                          placeholder="Add procurement reference"
                          userSettings={settings}
                          onSave={onInlineOrderFieldSave}
                          className="pending-order-inline-procurement-reference"
                        />
                      </td>
                    ) : (
                      <td>
                        <div className="pending-order-reference">{pendingOrderLabel(po)}</div>
                        {hasPoNumber && (
                          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>Pending Order #{po.id}</div>
                        )}
                        {po.procurementReference && (
                          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{po.procurementReference}</div>
                        )}
                      </td>
                    )}
                    {canInlineEditOrder ? (
                      <ProcurementInlineEditCell
                        item={po}
                        fieldKey="supplier"
                        label="Supplier"
                        currentValue={po.supplier}
                        referenceMode="supplier"
                        className="pending-order-inline-supplier"
                        userSettings={settings}
                        onSave={onInlineOrderFieldSave}
                      />
                    ) : <td>{po.supplier || "-"}</td>}
                    <td style={{ color: "var(--text-2)" }}>{po.items?.length ?? 0}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{formatPoTotal(po, locale)}</td>
                    <td style={{ color: "var(--text-2)", fontSize: 12 }}>
                      {formatDateTime(po.createdAt, settings)}
                    </td>
                    <td>
                      <OrderDocumentsCell order={po} />
                    </td>
                    <td>
                      <span className={`badge ${statusClass}`}>
                        <span className="badge-dot" />
                        {statusLabel}
                      </span>
                      {evidenceDetail && (
                        <div style={{ marginTop: 4, maxWidth: 220, fontSize: 10, color: "var(--text-3)" }}>
                          {evidenceDetail}
                        </div>
                      )}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="row-actions-inline">
                        {readOnly && renderReferenceCell(po)}
                        {readOnly && (
                          <RowActionsMenu
                            label={`More document actions for pending order ${po.id}`}
                            items={documentMenuItems}
                          />
                        )}
                        {!readOnly && perms.canEdit && po.status !== "converted" && !hasLineItems && (
                          <button
                            className="btn btn-p"
                            style={{ padding: "4px 6px", fontSize: 11 }}
                            onClick={() => onOpenAddItems(po)}
                          >
                            <Icon name="plus" size={12} />Add License
                          </button>
                        )}
                        {!readOnly && perms.canEdit && isPendingOrderEditable(po) && !hasPoNumber && hasLineItems && (
                          <button type="button" className="btn btn-p" onClick={() => onEdit(po)}>
                            <Icon name="plus" size={12} />Add PO number
                          </button>
                        )}
                        {!readOnly && perms.canEdit && po.status !== "converted" && hasPoNumber && po.items?.length === 1 && (
                          <button
                            className="btn btn-p"
                            style={{
                              padding: "4px 6px",
                              fontSize: 11,
                              opacity: hasPoNumber ? 1 : 0.45,
                              cursor: hasPoNumber ? "pointer" : "not-allowed",
                            }}
                            disabled={!hasPoNumber}
                            title={hasPoNumber ? "Convert to license" : "Add a PO number before creating active licenses"}
                            onClick={() => hasPoNumber && onOpenConvert(po)}
                          >
                            <Icon name="check" size={12} />Convert
                          </button>
                        )}
                        {!readOnly && perms.canEdit && po.status !== "converted" && hasPoNumber && po.items?.length > 1 && (
                          <button
                            className="btn btn-p"
                            style={{
                              padding: "4px 6px",
                              fontSize: 11,
                              opacity: hasPoNumber ? 1 : 0.45,
                              cursor: hasPoNumber ? "pointer" : "not-allowed",
                            }}
                            disabled={!hasPoNumber}
                            title={hasPoNumber ? "Convert to licenses" : "Add a PO number before creating active licenses"}
                            onClick={() => hasPoNumber && onOpenConvertAll(po)}
                          >
                            <Icon name="check" size={12} />Convert
                          </button>
                        )}
                        {!readOnly && (
                          <RowActionsMenu
                            label={`More actions for pending order ${po.id}`}
                            items={menuItems}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && po.items?.length > 0 && (
                    <PendingOrderItemsRow
                      po={po}
                      locale={locale}
                      userSettings={settings}
                      perms={perms}
                      readOnly={readOnly}
                      onAddItem={onOpenAddItems}
                      onDeleteItem={onDeleteItem}
                      onEditItem={onEditItem}
                      licenses={licenses}
                      showCurrency={showCurrency}
                      onNavigateToLicense={onNavigateToLicense}
                      inlineEditEnabled={inlineEditEnabled}
                      onInlineItemFieldSave={onInlineItemFieldSave}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
