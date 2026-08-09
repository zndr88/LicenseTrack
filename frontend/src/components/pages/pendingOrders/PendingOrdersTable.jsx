import React from "react";
import Icon from "../../ui/Icon.jsx";
import SearchBox from "../../ui/SearchBox.jsx";
import DocumentButton from "../../ui/DocumentButton.jsx";
import RowActionsMenu from "../../ui/RowActionsMenu.jsx";
import { formatCost } from "../../../utils/helpers.js";
import { formatPoTotal } from "./usePendingOrdersPageState.js";
import { formatDateTime, formatNumber } from "../../../utils/formatting.js";
import { procurementLineTotal } from "../../../utils/procurementTotals.js";
import { hasPurchaseOrderNumber, pendingOrderLabel } from "../../../utils/procurementLabels.js";

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

function PurchaseOrderDocumentsCell({ documents }) {
  const purchaseOrderDocuments = (documents ?? []).filter((document) => document.category === "purchase_order");

  if (!purchaseOrderDocuments.length) {
    return <span style={{ fontSize: 11, color: "var(--text-3)" }}>No PO</span>;
  }

  return <span className="badge badge-gray">{purchaseOrderDocuments.length === 1 ? "1 PO" : `${purchaseOrderDocuments.length} POs`}</span>;
}

function documentFilename(document, fallback) {
  return document.originalFilename ?? document.original_filename ?? fallback;
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

function PendingOrderItemsRow({
  po,
  locale,
  perms,
  readOnly = false,
  onAddItem,
  onDeleteItem,
  onEditItem,
  onDownloadQuote,
  onNavigateToLicense,
}) {
  return (
    <tr>
      <td colSpan={9} style={{ padding: 0, background: "var(--bg-2)" }}>
        <table style={{ width: "100%", borderTop: "1px solid var(--border)" }}>
          <thead>
            <tr style={{ background: "var(--bg-3)" }}>
              <th scope="col" style={{ paddingLeft: 40 }}>Publisher</th>
              <th scope="col">Description</th>
              <th scope="col">Qty</th>
              <th scope="col">Licence Unit Price</th>
              <th scope="col">Line Total</th>
              <th scope="col">Currency</th>
              <th scope="col">{readOnly ? "Context" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item) => (
              <tr key={item.id} style={{ background: "var(--bg-2)" }}>
                <td style={{ paddingLeft: 40, fontWeight: 600 }}>
                  {item.publisherName}
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400, marginTop: 2 }}>
                    Pending Order Line ID #{item.id}
                  </div>
                  {item.isRenewal && (
                    <span className="badge badge-pending po-inline-badge">
                      Renewal
                    </span>
                  )}
                </td>
                <td>{item.softwareDescription}</td>
                <td>{(() => { const q = parseFloat(item.quantity); return isNaN(q) ? "-" : formatNumber(q, { numberFormatLocale: locale }); })()}</td>
                <td>{formatCost(item.estimatedUnitPrice, item.currency, locale)}</td>
                <td>{formatCost(procurementLineTotal(item), item.currency, locale)}</td>
                <td>{item.currency}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {(item.quoteDocuments ?? []).map((document) => (
                      <DocumentButton
                        key={document.id}
                        document={document}
                        onDownload={onDownloadQuote}
                        labelPrefix="Quote: "
                      />
                    ))}
                    {readOnly && (
                      <span className={`badge ${item.isRenewal ? "badge-pending" : "badge-gray"}`}>
                        {item.isRenewal ? "Renewal" : "New Purchase"}
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
                        <Icon name="arrow-right" size={12} />View License
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
            ))}
            {!readOnly && perms.canEdit && (
              <tr style={{ background: "var(--bg-2)" }}>
                <td colSpan={7} style={{ paddingLeft: 40 }}>
                  <button className="btn btn-g" style={{ padding: "5px 9px", fontSize: 11 }} onClick={() => onAddItem(po)}>
                    <Icon name="plus" size={12} />Add License Line
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          {po.totalPoValue && (
            <tfoot>
              <tr style={{ background: "var(--bg-3)", borderTop: "1px solid var(--border)" }}>
                <td colSpan={4} style={{ paddingLeft: 40, fontSize: 12, color: "var(--text-2)" }}>
                  Total PO Value
                </td>
                <td colSpan={3} className="mono" style={{ fontWeight: 700 }}>
                  {formatPoTotal(po, locale)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </td>
    </tr>
  );
}

export default function PendingOrdersTable({
  displayed,
  expandedPendingOrderId,
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
  footer = null,
}) {
  const readOnly = mode === "history";
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
            <Icon name="arrow-right" size={12} />View License
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
              <th scope="col">PO</th>
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
              const isExpanded = expandedPendingOrderId === po.id;
              const canDelete = po.status === "pending" || po.status === "invoice_received";
              const isInvoiceReceived = po.status === "invoice_received";
              const evidenceStatus = po.evidenceTransferStatus ?? po.evidence_transfer_status;
              const evidenceDetail = po.evidenceTransferDetail ?? po.evidence_transfer_detail;
              const canRetryEvidence = po.status === "converted" && ["failed", "pending"].includes(evidenceStatus);
              const hasPoNumber = hasPurchaseOrderNumber(po);
              const hasLineItems = (po.items?.length ?? 0) > 0;
              const purchaseOrderDocuments = (po.documents ?? []).filter((document) => document.category === "purchase_order");
              const quoteDocuments = quoteDocumentsForOrder(po);
              const historyMenuItems = [
                ...purchaseOrderDocuments.map((document, index) => ({
                  key: `po-${document.id ?? index}`,
                  label: `Download ${documentFilename(document, "PO")}`,
                  icon: "download",
                  onClick: () => onDownloadPurchaseOrder(document),
                })),
                ...quoteDocuments.map((document, index) => ({
                  key: `quote-${document.id ?? index}`,
                  label: `Download ${documentFilename(document, "quote")}`,
                  icon: "download",
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
                ...purchaseOrderDocuments.map((document, index) => ({
                  key: `po-${document.id ?? index}`,
                  label: `Download ${documentFilename(document, "PO")}`,
                  icon: "download",
                  onClick: () => onDownloadPurchaseOrder(document),
                })),
                ...quoteDocuments.map((document, index) => ({
                  key: `quote-${document.id ?? index}`,
                  label: `Download ${documentFilename(document, "quote")}`,
                  icon: "download",
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
                    style={{
                      cursor: po.items?.length > 0 ? "pointer" : "default",
                      ...(highlightedRowId === po.id
                        ? { background: "var(--accent-m)", transition: "background 0.3s" }
                        : {}),
                    }}
                    onClick={() => po.items?.length > 0 && onRowToggle(isExpanded ? null : po.id)}
                  >
                    <td style={{ color: "var(--text-3)", fontSize: 11, textAlign: "center" }}>
                      {po.items?.length > 0 ? (isExpanded ? "\u25be" : "\u25b8") : ""}
                    </td>
                    <td>
                      <div className="mono" style={{ fontWeight: 600 }}>{pendingOrderLabel(po)}</div>
                      {hasPoNumber && (
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>Pending Order #{po.id}</div>
                      )}
                      {po.procurementReference && (
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{po.procurementReference}</div>
                      )}
                    </td>
                    <td>{po.supplier || "-"}</td>
                    <td style={{ color: "var(--text-2)" }}>{po.items?.length ?? 0}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{formatPoTotal(po, locale)}</td>
                    <td style={{ color: "var(--text-2)", fontSize: 12 }}>
                      {formatDateTime(po.createdAt, settings)}
                    </td>
                    <td>
                      <PurchaseOrderDocumentsCell documents={po.documents} />
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
                            items={historyMenuItems}
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
                        {!readOnly && perms.canEdit && po.status !== "converted" && po.items?.length === 1 && (
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
                        {!readOnly && perms.canEdit && po.status !== "converted" && po.items?.length > 1 && (
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
                      perms={perms}
                      readOnly={readOnly}
                      onAddItem={onOpenAddItems}
                      onDeleteItem={onDeleteItem}
                      onEditItem={onEditItem}
                      onDownloadQuote={onDownloadQuote}
                      onNavigateToLicense={onNavigateToLicense}
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
