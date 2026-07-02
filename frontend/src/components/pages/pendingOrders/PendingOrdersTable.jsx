import React from "react";
import Icon from "../../ui/Icon.jsx";
import SearchBox from "../../ui/SearchBox.jsx";
import DocumentButton from "../../ui/DocumentButton.jsx";
import { formatCost } from "../../../utils/helpers.js";
import { formatPoTotal } from "./usePendingOrdersPageState.js";
import { formatDateTime, formatNumber } from "../../../utils/formatting.js";

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

function PurchaseOrderDocumentsCell({ documents, onDownloadPurchaseOrder }) {
  const purchaseOrderDocuments = (documents ?? []).filter((document) => document.category === "purchase_order");

  if (!purchaseOrderDocuments.length) {
    return <span style={{ fontSize: 11, color: "var(--text-3)" }}>No PO</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      {purchaseOrderDocuments.map((document) => (
        <DocumentButton
          key={document.id}
          document={document}
          onDownload={onDownloadPurchaseOrder}
        />
      ))}
    </div>
  );
}

function PendingOrderItemsRow({
  po,
  locale,
  perms,
  onAddItem,
  onDeleteItem,
  onEditItem,
  onDownloadQuote,
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
              <th scope="col">Est. Unit Price</th>
              <th scope="col">Est. Total</th>
              <th scope="col">Currency</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item) => (
              <tr key={item.id} style={{ background: "var(--bg-2)" }}>
                <td style={{ paddingLeft: 40, fontWeight: 600 }}>
                  {item.publisherName}
                  {item.isRenewal && (
                    <span className="badge badge-pending po-inline-badge">
                      Renewal
                    </span>
                  )}
                </td>
                <td>{item.softwareDescription}</td>
                <td>{(() => { const q = parseFloat(item.quantity); return isNaN(q) ? "-" : formatNumber(q, { numberFormatLocale: locale }); })()}</td>
                <td>{formatCost(item.estimatedUnitPrice, item.currency, locale)}</td>
                <td>{formatCost(item.estimatedTotalPrice, item.currency, locale)}</td>
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
                    {perms.canEdit && (
                      <button className="btn btn-g" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => onEditItem(po, item)}>
                        <Icon name="edit" size={12} />Edit
                      </button>
                    )}
                    {perms.canDelete && (
                      <button className="btn btn-g" style={{ padding: "4px 8px", fontSize: 11, color: "var(--red)" }} onClick={() => onDeleteItem(po, item)}>
                        <Icon name="trash" size={12} />Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {perms.canEdit && (
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
  settings,
  onDelete,
  onEdit,
  onEditItem,
  onDeleteItem,
  onUploadPurchaseOrder,
  onDownloadPurchaseOrder,
  onDownloadQuote,
  onOpenAddItems,
  onOpenConvert,
  onOpenConvertAll,
  onRowToggle,
  perms,
  search,
  setSearch,
  sortCol,
  sortDir,
  onSort,
}) {
  return (
    <div className="tbl-wrap">
      <div className="tbl-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search PO number, supplier, or line items..."
          ariaLabel="Search pending orders"
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: 28 }} />
              <SortableHeader column="poNumber" label="PO Number" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <SortableHeader column="supplier" label="Supplier" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <SortableHeader column="itemCount" label="Items" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <SortableHeader column="totalValue" label="Total PO Value" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <SortableHeader column="created" label="Created" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <th scope="col">PO</th>
              <SortableHeader column="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--text-3)", padding: "24px 0", fontSize: 13 }}>
                  No orders match your search.
                </td>
              </tr>
            ) : displayed.map((po) => {
              const isExpanded = expandedPendingOrderId === po.id;
              const canDelete = po.status === "pending";
              const isInvoiceReceived = po.status === "invoice_received";
              const statusLabel = isInvoiceReceived ? "Invoice Received" : "Pending";
              const statusClass = isInvoiceReceived ? "badge-green" : "badge-pending";

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
                    <td className="mono" style={{ fontWeight: 600 }}>{po.poNumber}</td>
                    <td>{po.supplier || "-"}</td>
                    <td style={{ color: "var(--text-2)" }}>{po.items?.length ?? 0}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{formatPoTotal(po, locale)}</td>
                    <td style={{ color: "var(--text-2)", fontSize: 12 }}>
                      {formatDateTime(po.createdAt, settings)}
                    </td>
                    <td>
                      <PurchaseOrderDocumentsCell
                        documents={po.documents}
                        onDownloadPurchaseOrder={onDownloadPurchaseOrder}
                      />
                    </td>
                    <td>
                      <span className={`badge ${statusClass}`}>
                        <span className="badge-dot" />
                        {statusLabel}
                      </span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "nowrap", alignItems: "center", justifyContent: "flex-start" }}>
                        {perms.canEdit && (
                          <button
                            className="btn btn-g"
                            style={{ padding: "4px 6px", fontSize: 11 }}
                            onClick={() => onUploadPurchaseOrder(po)}
                          >
                            <Icon name="upload" size={12} />PO
                          </button>
                        )}
                        {perms.canEdit && (
                          <button
                            className="btn btn-g"
                            style={{ padding: "4px 6px", fontSize: 11 }}
                            onClick={() => onEdit(po)}
                          >
                            <Icon name="edit" size={12} />Edit
                          </button>
                        )}
                        {perms.canEdit && po.status !== "converted" && po.items?.length === 0 && (
                          <button
                            className="btn btn-p"
                            style={{ padding: "4px 6px", fontSize: 11 }}
                            onClick={() => onOpenAddItems(po)}
                          >
                            <Icon name="plus" size={12} />Add License
                          </button>
                        )}
                        {perms.canEdit && po.status !== "converted" && po.items?.length === 1 && (
                          <button
                            className="btn btn-p"
                            style={{ padding: "4px 6px", fontSize: 11 }}
                            onClick={() => onOpenConvert(po)}
                          >
                            <Icon name="check" size={12} />Convert
                          </button>
                        )}
                        {perms.canEdit && po.status !== "converted" && po.items?.length > 1 && (
                          <button
                            className="btn btn-p"
                            style={{ padding: "4px 6px", fontSize: 11 }}
                            onClick={() => onOpenConvertAll(po)}
                          >
                            <Icon name="check" size={12} />Convert
                          </button>
                        )}
                        {perms.canDelete && (
                          <button
                            className="btn btn-g"
                            style={{
                              padding: "4px 6px",
                              fontSize: 11,
                              color: canDelete ? "var(--red)" : "var(--text-3)",
                              cursor: canDelete ? "pointer" : "not-allowed",
                              opacity: canDelete ? 1 : 0.4,
                            }}
                            title={canDelete ? "Delete this pending order" : "Cannot delete: invoice already received"}
                            onClick={() => canDelete && onDelete(po.id)}
                          >
                            <Icon name="trash" size={12} />Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && po.items?.length > 0 && (
                    <PendingOrderItemsRow
                      po={po}
                      locale={locale}
                      perms={perms}
                      onAddItem={onOpenAddItems}
                      onDeleteItem={onDeleteItem}
                      onEditItem={onEditItem}
                      onDownloadQuote={onDownloadQuote}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
