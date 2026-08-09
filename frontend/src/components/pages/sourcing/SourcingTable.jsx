import React from "react";
import Icon from "../../ui/Icon.jsx";
import SearchBox from "../../ui/SearchBox.jsx";
import RowActionsMenu from "../../ui/RowActionsMenu.jsx";
import { formatCost, formatPriceInput } from "../../../utils/helpers.js";
import { formatDateTime } from "../../../utils/formatting.js";
import { procurementLineTotal } from "../../../utils/procurementTotals.js";
import { formatQuantity } from "../../../utils/quantity.js";

function SortIndicator({ col, sortCol, sortDir }) {
  return sortCol === col ? (
    <span style={{ marginLeft: 4, fontSize: 10, color: "var(--accent)", verticalAlign: "middle" }}>
      {sortDir === "asc" ? "▲" : "▼"}
    </span>
  ) : null;
}

function requestTotal(request, locale) {
  const totals = {};
  for (const item of request.items ?? []) {
    const value = procurementLineTotal(item);
    if (value != null) totals[item.currency] = (totals[item.currency] ?? 0) + value;
  }
  const entries = Object.entries(totals);
  if (!entries.length) return "-";
  return entries.map(([currency, amount]) => formatCost(amount, currency, locale)).join(" + ");
}

function QuoteDocumentsCell({ documents }) {
  if (!documents.length) {
    return <span style={{ fontSize: 11, color: "var(--text-3)" }}>No quote</span>;
  }

  return <span className="badge badge-gray">{documents.length === 1 ? "1 quote" : `${documents.length} quotes`}</span>;
}

function SourcingStatusBadges({ item }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {item.isRenewal && (
        <span className="badge badge-pending">
          {item.cotermPredecessorIds?.length > 0 ? "Coterm Renewal" : "Renewal"}
        </span>
      )}

    </div>
  );
}

function hasLinkedPendingOrder(item) {
  return Boolean(item.pendingOrderId);
}

function isOpenSourcingItem(item) {
  return item.status == null || item.status === "sourcing";
}

export function isDirectFreewareItem(item) {
  if (item.licenseType !== "freeware") return false;
  return !(
    item.maintenanceCoverage === "included" &&
    Number(item.maintenanceCost) > 0
  );
}

function isDirectFreewareRequest(request) {
  const openItems = (request.items ?? []).filter(isOpenSourcingItem);
  return openItems.length > 0 && openItems.every(isDirectFreewareItem);
}

function pendingOrderLabel(item) {
  return item.pendingOrderPoNumber || (item.pendingOrderId ? `Pending Order #${item.pendingOrderId}` : null);
}

function SourcingItemsRow({
  request,
  licenses,
  locale,
  perms,
  readOnly = false,
  highlightedRowId,
  selectedForMerge,
  onNavigateToPendingOrder,
  onNavigateToLicense,
  onConvertFreeware,
  onToggleSelect,
  onEditItem,
  onDeleteItem,
  onAddItem,
}) {
  return (
    <tr>
      <td colSpan={8} style={{ padding: 0, background: "var(--bg-2)" }}>
        <table style={{ width: "100%", borderTop: "1px solid var(--border)" }}>
          <thead>
            <tr style={{ background: "var(--bg-3)" }}>
              <th scope="col" style={{ width: 32, paddingLeft: 40 }} />
              <th scope="col">Publisher</th>
              <th scope="col">Description</th>
              <th scope="col">Qty</th>
              <th scope="col">Est. Licence Unit Price</th>
              <th scope="col">Est. Line Total</th>
              <th scope="col">Currency</th>
              <th scope="col">{readOnly ? "Context" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {(request.items ?? []).map((si) => {
              const renewalLicense = si.isRenewal ? licenses.find((l) => l.id === si.renewalForLicenseId) : null;
              const isChecked = selectedForMerge.has(si.id);
              return (
                <tr key={si.id} data-sourcing-row={si.id} style={highlightedRowId === si.id ? { background: "var(--accent-m)", transition: "background 0.3s" } : { background: "var(--bg-2)" }}>
                  <td style={{ paddingLeft: 40, textAlign: "center", verticalAlign: "middle" }}>
                    {!readOnly && isOpenSourcingItem(si) && si.isRenewal ? (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleSelect(si.id)}
                        style={{ cursor: "pointer", accentColor: "var(--accent)", width: 14, height: 14 }}
                      />
                    ) : (
                      <input type="checkbox" disabled style={{ opacity: 0.2, width: 14, height: 14 }} />
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {si.publisherName}
                    <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400, marginTop: 2 }}>
                      Sourcing Line ID #{si.id}
                    </div>
                    {renewalLicense && (
                      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400, marginTop: 2 }}>
                        Renewing: {renewalLicense.publisherName}
                      </div>
                    )}
                  </td>
                  <td>
                    {si.softwareDescription}
                    {renewalLicense && (
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                        {renewalLicense.softwareDescription}
                      </div>
                    )}
                  </td>
                  <td>{formatQuantity(si.quantity, { numberFormatLocale: locale }) || "-"}</td>
                  <td>{si.estimatedUnitPrice ? formatPriceInput(si.estimatedUnitPrice, locale) : "-"}</td>
                  <td>{procurementLineTotal(si) != null ? formatPriceInput(procurementLineTotal(si), locale) : "-"}</td>
                  <td>{si.currency}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {si.isRenewal ? (
                        <SourcingStatusBadges item={si} />
                      ) : si.licenseType === "freeware" ? (
                        <span className="badge badge-blue">Freeware / Open Source</span>
                      ) : !readOnly && hasLinkedPendingOrder(si) ? (
                        <span className="badge badge-pending">Pending Order</span>
                      ) : readOnly ? (
                        <span className="badge badge-gray">New Purchase</span>
                      ) : null}
                      {readOnly && si.convertedLicenseId && onNavigateToLicense && (
                        <button
                          className="btn btn-g"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => onNavigateToLicense(si.convertedLicenseId)}
                        >
                          <Icon name="arrow-right" size={12} />View License
                        </button>
                      )}
                      {hasLinkedPendingOrder(si) && onNavigateToPendingOrder && (
                        <button
                          className="btn btn-g"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={(event) => {
                            event.stopPropagation();
                            onNavigateToPendingOrder(si.pendingOrderId);
                          }}
                        >
                          <Icon name="arrow-right" size={12} />View PO
                        </button>
                      )}
                      {readOnly && si.pendingOrderStatus === "converted" && !onNavigateToPendingOrder && (
                        <span style={{ color: "var(--text-3)", fontSize: 11 }}>
                          PO converted
                        </span>
                      )}
                      {!readOnly && isOpenSourcingItem(si) && isDirectFreewareItem(si) && perms.canEdit && (
                        <button className="btn btn-p" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => onConvertFreeware(si)}>
                          <Icon name="check" size={12} />Convert to Registry
                        </button>
                      )}
                      {!readOnly && isOpenSourcingItem(si) && perms.canEdit && (
                        <button className="btn btn-g" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => onEditItem(si, request)}>
                          <Icon name="edit" size={12} />Edit
                        </button>
                      )}
                      {!readOnly && isOpenSourcingItem(si) && perms.canDelete && (
                        <button className="btn btn-g" style={{ padding: "4px 8px", fontSize: 11, color: "var(--red)" }} onClick={() => onDeleteItem(si.id)}>
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
                <td colSpan={8} style={{ paddingLeft: 40 }}>
                  <button className="btn btn-g" style={{ padding: "5px 9px", fontSize: 11 }} onClick={() => onAddItem(request)}>
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

export default function SourcingTable({
  tableRef,
  displayed,
  licenses,
  userSettings,
  perms,
  mode = "active",
  search,
  setSearch,
  selectedForMerge,
  mergeEligible,
  onOpenMerge,
  onSort,
  sortCol,
  sortDir,
  highlightedRowId,
  expandedRequestId,
  onRowToggle,
  onToggleSelect,
  onEditItem,
  onDeleteItem,
  onAddItem,
  onConvert,
  onUploadQuote,
  onDownloadQuote,
  onDeleteRequest,
  onNavigateToPendingOrder,
  onNavigateToLicense,
  onConvertFreeware,
  onRefetch,
  onExportCsv,
}) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const readOnly = mode === "history";
  const emptyMessage = readOnly ? "No historical requests match your search." : "No requests match your search.";
  const renderStatusBadge = (request) => {
    if (request.status === "cancelled") {
      return (
        <span className="badge badge-gray">
          <span className="badge-dot" />
          Cancelled
        </span>
      );
    }
    if (request.status === "converted") {
      return (
        <span className="badge badge-green">
          <span className="badge-dot" />
          Converted
        </span>
      );
    }
    return (
      <span className="badge badge-blue">
        <span className="badge-dot" />
        Sourcing
      </span>
    );
  };
  const linkedPendingOrderItemsForRequest = (request) => {
    const seen = new Set();
    return (request.items ?? []).filter((item) => {
      if (!hasLinkedPendingOrder(item) || seen.has(item.pendingOrderId)) return false;
      seen.add(item.pendingOrderId);
      return true;
    });
  };
  const renderReferenceCell = (request) => {
    const linkedPendingOrderItems = linkedPendingOrderItemsForRequest(request);
    if (request.status === "converted" && linkedPendingOrderItems.length === 1 && onNavigateToPendingOrder) {
      const item = linkedPendingOrderItems[0];
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
          <button
            className="btn btn-g"
            style={{ padding: "4px 8px", fontSize: 11 }}
            onClick={() => onNavigateToPendingOrder(item.pendingOrderId)}
          >
            <Icon name="arrow-right" size={12} />View PO
          </button>
          <span style={{ color: "var(--text-3)", fontSize: 10 }}>{pendingOrderLabel(item)}</span>
        </div>
      );
    }
    if (request.status === "converted" && linkedPendingOrderItems.length > 1) {
      return <span style={{ color: "var(--text-3)", fontSize: 11 }}>Open a line to choose PO</span>;
    }
    if (
      request.status === "converted" &&
      (request.items ?? []).some((item) => item.pendingOrderStatus === "converted")
    ) {
      return <span style={{ color: "var(--text-3)", fontSize: 11 }}>PO converted</span>;
    }
    const directLicenses = (request.items ?? []).filter((item) => item.convertedLicenseId);
    if (request.status === "converted" && directLicenses.length === 1 && onNavigateToLicense) {
      return (
        <button
          className="btn btn-g"
          style={{ padding: "4px 8px", fontSize: 11 }}
          onClick={() => onNavigateToLicense(directLicenses[0].convertedLicenseId)}
        >
          <Icon name="arrow-right" size={12} />View License
        </button>
      );
    }
    if (request.status === "converted" && directLicenses.length > 1) {
      return <span style={{ color: "var(--text-3)", fontSize: 11 }}>Open a line to choose license</span>;
    }
    return <span style={{ color: "var(--text-3)", fontSize: 11 }}>No linked PO</span>;
  };

  return (
    <div className="tbl-wrap" ref={tableRef}>
      <div className="tbl-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search supplier, publisher, or description..."
          ariaLabel="Search sourcing requests"
        />
        {!readOnly && perms.canEdit && selectedForMerge.size > 0 && (
          <button
            className="btn btn-sm"
            style={{
              fontSize: 11, padding: "5px 12px",
              background: mergeEligible ? "var(--purple-dim)" : "var(--bg-3)",
              color: mergeEligible ? "var(--purple-text)" : "var(--text-3)",
              border: `1px solid ${mergeEligible ? "var(--purple-border)" : "var(--border)"}`,
              borderRadius: "var(--r)", cursor: mergeEligible ? "pointer" : "not-allowed",
            }}
            disabled={!mergeEligible}
            onClick={onOpenMerge}
          >
            <Icon name="check" size={12} />
            Merge Selected ({selectedForMerge.size})
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={onRefetch} title="Refresh sourcing items" style={{ fontSize: 12 }}>
          <Icon name="refresh" size={13} />Refresh
        </button>
        {!readOnly && (
          <button type="button" onClick={onExportCsv} className="btn btn-g" style={{ fontSize: 12 }}>
            <Icon name="download" size={13} />Export CSV
          </button>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: 28 }} />
              <th scope="col" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort("supplier")}>Supplier<SortIndicator col="supplier" sortCol={sortCol} sortDir={sortDir} /></th>
              <th scope="col" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort("itemCount")}>Items<SortIndicator col="itemCount" sortCol={sortCol} sortDir={sortDir} /></th>
              <th scope="col" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort("total")}>Est. Total<SortIndicator col="total" sortCol={sortCol} sortDir={sortDir} /></th>
              <th scope="col" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort("created")}>Created<SortIndicator col="created" sortCol={sortCol} sortDir={sortDir} /></th>
              <th scope="col">Quote</th>
              <th scope="col">Status</th>
              <th scope="col">{readOnly ? "Reference" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-3)", padding: "24px 0", fontSize: 13 }}>{emptyMessage}</td></tr>
            ) : displayed.map((request) => {
              const isExpanded = expandedRequestId === request.id;
              const quoteDocuments = request.quoteDocuments ?? [];
              const openItems = (request.items ?? []).filter(isOpenSourcingItem);
              const canEditSingleLine = perms.canEdit && openItems.length === 1;
              const menuItems = [
                {
                  key: "edit",
                  label: "Edit",
                  icon: "edit",
                  hidden: !canEditSingleLine,
                  onClick: () => onEditItem(openItems[0], request),
                },
                {
                  key: "upload-quote",
                  label: "Upload Quote",
                  icon: "upload",
                  hidden: !perms.canEdit,
                  onClick: () => onUploadQuote(request),
                },
                ...quoteDocuments.map((document, index) => ({
                  key: `quote-${document.id ?? index}`,
                  label: quoteDocuments.length === 1 ? "Download Quote" : `Download Quote ${index + 1}`,
                  icon: "download",
                  onClick: () => onDownloadQuote(document),
                })),
                {
                  key: "add-line",
                  label: "Add License Line",
                  icon: "plus",
                  hidden: !perms.canEdit,
                  onClick: () => onAddItem(request),
                },
                {
                  key: "cancel",
                  label: "Cancel Request",
                  icon: "archive",
                  danger: true,
                  separatorBefore: true,
                  hidden: !perms.canDelete,
                  onClick: () => onDeleteRequest(request),
                },
              ];
              return (
                <React.Fragment key={request.id}>
                  <tr
                    data-sourcing-request-row={request.id}
                    style={{ cursor: request.items?.length > 0 ? "pointer" : "default" }}
                    onClick={() => request.items?.length > 0 && onRowToggle(isExpanded ? null : request.id)}
                  >
                    <td style={{ color: "var(--text-3)", fontSize: 11, textAlign: "center" }}>
                      {request.items?.length > 0 ? (isExpanded ? "▾" : "▸") : ""}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {request.supplier || "Unassigned supplier"}
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                        Sourcing Request ID #{request.id}
                        {request.contactEmail ? ` · ${request.contactEmail}` : ""}
                      </div>
                    </td>
                    <td style={{ color: "var(--text-2)" }}>{request.items?.length ?? 0}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{requestTotal(request, locale)}</td>
                    <td style={{ color: "var(--text-2)", fontSize: 12 }}>
                      {formatDateTime(request.createdAt, userSettings)}
                    </td>
                    <td>
                      <QuoteDocumentsCell documents={quoteDocuments} />
                    </td>
                    <td>{renderStatusBadge(request)}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      {readOnly ? (
                        renderReferenceCell(request)
                      ) : (
                        <div className="row-actions-inline">
                          {perms.canEdit && (
                            <button className="btn btn-p" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => onConvert(request)}>
                              <Icon name="check" size={12} />
                              {isDirectFreewareRequest(request)
                                ? "Convert to Registry"
                                : "Convert"}
                            </button>
                          )}
                          <RowActionsMenu
                            label={`More actions for sourcing request ${request.id}`}
                            items={menuItems}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <SourcingItemsRow
                      request={request}
                      licenses={licenses}
                      locale={locale}
                      perms={perms}
                      readOnly={readOnly}
                      highlightedRowId={highlightedRowId}
                      selectedForMerge={selectedForMerge}
                      onNavigateToPendingOrder={onNavigateToPendingOrder}
                      onNavigateToLicense={onNavigateToLicense}
                      onConvertFreeware={onConvertFreeware}
                      onToggleSelect={onToggleSelect}
                      onEditItem={onEditItem}
                      onDeleteItem={onDeleteItem}
                      onAddItem={onAddItem}
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
