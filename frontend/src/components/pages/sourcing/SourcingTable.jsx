import React from "react";
import Icon from "../../ui/Icon.jsx";
import SearchBox from "../../ui/SearchBox.jsx";
import RowActionsMenu from "../../ui/RowActionsMenu.jsx";
import ProcurementInlineEditCell from "../../procurement/ProcurementInlineEditCell.jsx";
import { formatCost } from "../../../utils/helpers.js";
import { formatDateTime } from "../../../utils/formatting.js";
import { sourcingRequestPublishers } from "./sourcingPageState.js";
import { procurementLineTotal, procurementTotalsByCurrency } from "../../../utils/procurementTotals.js";
import { formatQuantity } from "../../../utils/quantity.js";
import TermLinkContext from "../../procurement/TermLinkContext.jsx";

function SortIndicator({ col, sortCol, sortDir }) {
  return sortCol === col ? (
    <span style={{ marginLeft: 4, fontSize: 10, color: "var(--accent)", verticalAlign: "middle" }}>
      {sortDir === "asc" ? "▲" : "▼"}
    </span>
  ) : null;
}

function requestTotal(request, locale) {
  const entries = Object.entries(procurementTotalsByCurrency(request.items)).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "-";
  return entries.map(([currency, amount]) => formatCost(amount, currency, locale)).join(" + ");
}

function linePrice(value, currency, locale) {
  if (value == null || value === "") return "-";
  return formatCost(value, currency || "EUR", locale);
}

function hasLinkedPendingOrder(item) {
  return Boolean(item.pendingOrderId);
}

function isOpenSourcingItem(item) {
  return item.status == null || item.status === "sourcing";
}

function isOpenSourcingRequest(request) {
  return request.status == null || request.status === "sourcing";
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
  userSettings,
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
  inlineEditEnabled,
  onInlineFieldSave,
}) {
  const currencies = [...new Set((request.items ?? []).map((item) => item.currency || "EUR"))].sort().join(", ");
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
              <th scope="col">Unit Qty</th>
              <th scope="col">Est. Unit Price{currencies ? ` (${currencies})` : ""}</th>
              <th scope="col">Est. Line Total{currencies ? ` (${currencies})` : ""}</th>
              <th scope="col">{readOnly ? "Context" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {(request.items ?? []).map((si) => {
              const renewalLicense = si.isRenewal ? licenses.find((l) => l.id === si.renewalForLicenseId) : null;
              const previousDescription = renewalLicense?.softwareDescription?.trim();
              const renewalContext = si.isRenewal && (
                <div className="sourcing-inline-context">
                  <span className="badge badge-pending">
                    {si.cotermPredecessorIds?.length > 0 ? "Coterm Renewal" : "Renewal"}
                  </span>
                  {previousDescription && previousDescription !== si.softwareDescription?.trim() && (
                    <div>Previous license: {previousDescription}</div>
                  )}
                </div>
              );
              const isChecked = selectedForMerge.has(si.id);
              const canInlineEdit = inlineEditEnabled && !readOnly && isOpenSourcingItem(si) && perms.canEdit;
              return (
                <tr
                  key={si.id}
                  data-sourcing-row={si.id}
                  className={canInlineEdit ? "sourcing-row-inline-edit" : undefined}
                  style={highlightedRowId === si.id ? { backgroundColor: "var(--accent-m)", transition: "background 0.3s" } : { backgroundColor: "var(--bg-2)" }}
                >
                  <td style={{ paddingLeft: 40, textAlign: "center", verticalAlign: "middle" }}>
                    {!readOnly && isOpenSourcingItem(si) && si.renewalForLicenseId != null ? (
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
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell
                      item={si}
                      fieldKey="publisherName"
                      label="Publisher"
                      currentValue={si.publisherName}
                      required
                      referenceMode="publisher"
                      className="sourcing-inline-publisher"
                      userSettings={userSettings}
                      onSave={onInlineFieldSave}
                    >
                      <div className="sourcing-inline-context">Sourcing Line ID #{si.id}</div>
                    </ProcurementInlineEditCell>
                  ) : (
                    <td style={{ fontWeight: 600 }}>
                      {si.publisherName}
                      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400, marginTop: 2 }}>
                        Sourcing Line ID #{si.id}
                      </div>
                    </td>
                  )}
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell
                      item={si}
                      fieldKey="softwareDescription"
                      label="Description"
                      currentValue={si.softwareDescription}
                      required
                      className="sourcing-inline-description"
                      userSettings={userSettings}
                      onSave={onInlineFieldSave}
                    >
                      {renewalContext}
                      <TermLinkContext item={si} items={request.items ?? []} />
                    </ProcurementInlineEditCell>
                  ) : (
                    <td>
                      {si.softwareDescription}
                      {renewalContext}
                      <TermLinkContext item={si} items={request.items ?? []} />
                    </td>
                  )}
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell item={si} fieldKey="quantity" label="Quantity" currentValue={si.quantity} valueType="quantity" userSettings={userSettings} onSave={onInlineFieldSave} />
                  ) : (
                    <td>{formatQuantity(si.quantity, { numberFormatLocale: locale }) || "-"}</td>
                  )}
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell item={si} fieldKey="quantityPerUnit" label="Unit quantity" currentValue={si.quantityPerUnit} valueType="quantity" userSettings={userSettings} onSave={onInlineFieldSave} />
                  ) : (
                    <td>{formatQuantity(si.quantityPerUnit, userSettings) || "-"}</td>
                  )}
                  {canInlineEdit ? (
                    <ProcurementInlineEditCell item={si} fieldKey="estimatedUnitPrice" label="Estimated unit price" currentValue={si.estimatedUnitPrice} valueType="money" userSettings={userSettings} onSave={onInlineFieldSave} />
                  ) : (
                    <td>{linePrice(si.estimatedUnitPrice, si.currency, locale)}</td>
                  )}
                  <td>{linePrice(procurementLineTotal(si), si.currency, locale)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {si.isRenewal ? null : si.licenseType === "freeware" ? (
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
                          <Icon name="arrow-right" size={12} />{si.convertedLicenseRetired ? "View Retired License" : "View License"}
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
  expandedRequestIds = null,
  onRowToggle,
  onSetAllExpanded,
  onToggleSelect,
  onEditItem,
  onEditRequest,
  onDeleteItem,
  onAddItem,
  onConvert,
  onOpenDocuments,
  onDeleteRequest,
  onNavigateToPendingOrder,
  onNavigateToLicense,
  onConvertFreeware,
  onRefetch,
  onExportCsv,
  inlineEditEnabled = false,
  onToggleInlineEdit,
  onInlineFieldSave,
  onInlineRequestFieldSave,
  footer = null,
}) {
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const readOnly = mode === "history";
  const expandableRequests = displayed.filter((request) => request.items?.length > 0);
  const allExpanded = expandableRequests.length > 0 && expandableRequests.every((request) => (
    expandedRequestIds ? expandedRequestIds.has(request.id) : expandedRequestId === request.id
  ));
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
          <Icon name="arrow-right" size={12} />{directLicenses[0].convertedLicenseRetired ? "View Retired License" : "View License"}
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
        {onSetAllExpanded && displayed.some((request) => request.items?.length > 0) && (
          <>
            <button type="button" className="btn btn-g" onClick={() => onSetAllExpanded(!allExpanded)}>
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </>
        )}
        {!readOnly && perms.canEdit && (
          <button
            type="button"
            className={`btn btn-g procurement-inline-toggle ${inlineEditEnabled ? "procurement-inline-toggle-active" : ""}`}
            onClick={onToggleInlineEdit}
            title={inlineEditEnabled ? "Finish editing" : "Edit sourcing lines"}
            aria-label={inlineEditEnabled ? "Done editing" : "Edit in table"}
            aria-pressed={inlineEditEnabled}
          >
            <Icon name={inlineEditEnabled ? "check" : "edit"} size={13} />
            {inlineEditEnabled ? "Done editing" : "Edit in table"}
          </button>
        )}
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
              <th scope="col" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort("publisher")}>Publisher<SortIndicator col="publisher" sortCol={sortCol} sortDir={sortDir} /></th>
              <th scope="col" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort("itemCount")}>Items<SortIndicator col="itemCount" sortCol={sortCol} sortDir={sortDir} /></th>
              <th scope="col" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort("total")}>Est. Total<SortIndicator col="total" sortCol={sortCol} sortDir={sortDir} /></th>
              <th scope="col">Status</th>
              <th scope="col" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort("created")}>Created<SortIndicator col="created" sortCol={sortCol} sortDir={sortDir} /></th>
              <th scope="col">{readOnly ? "Reference" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-3)", padding: "24px 0", fontSize: 13 }}>{emptyMessage}</td></tr>
            ) : displayed.map((request) => {
              const hasItems = (request.items?.length ?? 0) > 0;
              const createdDateTime = formatDateTime(request.createdAt, userSettings);
              const canInlineEditRequest = inlineEditEnabled && !readOnly && isOpenSourcingRequest(request) && perms.canEdit;
              const shouldExpand = expandedRequestIds
                ? expandedRequestIds.has(request.id)
                : expandedRequestId === request.id;
              const isExpanded = hasItems && shouldExpand;
              const handleRowToggle = () => {
                if (!hasItems) return;
                if (expandedRequestIds) {
                  onRowToggle(request.id);
                } else {
                  onRowToggle(isExpanded ? null : request.id);
                }
              };
              const menuItems = [
                {
                  key: "edit-request",
                  label: "Edit Sourcing Request",
                  icon: "edit",
                  hidden: !perms.canEdit,
                  onClick: () => onEditRequest(request),
                },
                {
                  key: "documents",
                  label: "Documents",
                  icon: "file",
                  onClick: () => onOpenDocuments(request),
                },
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
                    className={canInlineEditRequest ? "sourcing-request-row-inline-edit" : undefined}
                    style={{ cursor: hasItems ? "pointer" : "default" }}
                    onClick={handleRowToggle}
                  >
                    <td style={{ color: "var(--text-3)", fontSize: 11, textAlign: "center" }}>
                      {hasItems ? (isExpanded ? "▾" : "▸") : ""}
                    </td>
                    {canInlineEditRequest ? (
                      <ProcurementInlineEditCell
                        item={request}
                        fieldKey="supplier"
                        label="Supplier"
                        currentValue={request.supplier}
                        referenceMode="supplier"
                        className="sourcing-inline-supplier"
                        userSettings={userSettings}
                        onSave={onInlineRequestFieldSave}
                      >
                        <div className="sourcing-inline-context">
                          Sourcing Request ID #{request.id}
                          {request.contactEmail ? ` · ${request.contactEmail}` : ""}
                        </div>
                      </ProcurementInlineEditCell>
                    ) : (
                      <td style={{ fontWeight: 600 }}>
                        {request.supplier || "Unassigned supplier"}
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                          Sourcing Request ID #{request.id}
                          {request.contactEmail ? ` · ${request.contactEmail}` : ""}
                        </div>
                      </td>
                    )}
                    <td style={{ color: "var(--text-2)", fontSize: 12 }}>{sourcingRequestPublishers(request) || "-"}</td>
                    <td style={{ color: "var(--text-2)" }}>{request.items?.length ?? 0}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{requestTotal(request, locale)}</td>
                    <td>{renderStatusBadge(request)}</td>
                    <td style={{ color: "var(--text-2)", fontSize: 12 }}>
                      {request.createdAt ? <time dateTime={request.createdAt} title={createdDateTime} aria-label={createdDateTime}>
                        {createdDateTime.split(" ")[0]}
                      </time> : "-"}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      {readOnly ? (
                        <div className="row-actions-inline">
                          {renderReferenceCell(request)}
                          <RowActionsMenu
                            label={`More document actions for sourcing request ${request.id}`}
                            items={[{ key: "documents", label: "Documents", icon: "file", onClick: () => onOpenDocuments(request) }]}
                          />
                        </div>
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
                      userSettings={userSettings}
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
                      inlineEditEnabled={inlineEditEnabled}
                      onInlineFieldSave={onInlineFieldSave}
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
