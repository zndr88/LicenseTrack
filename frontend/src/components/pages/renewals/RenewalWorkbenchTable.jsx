import React from "react";
import { formatCost } from "../../../utils/helpers.js";
import {
  STATUS_LABELS,
  STATUS_BADGE_CLASS,
  RISK_CLASS,
  getRiskFlagDisplay,
  getPrimaryAction,
  rowTone,
} from "./workbenchRules.js";
import {
  formatDate,
  getCustomFieldValue,
  renderCustomFieldDisplay,
} from "./workbenchColumns.js";

function formatDays(days) {
  if (days === null || days === undefined) return "-";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  return `${days}d`;
}

function renderCell(column, row, { startingId, locale, userSettings, canStartRenewal, canOpenPipeline, onNavigateToLicense, onNavigateToSourcing, onNavigateToPendingOrder, onStartRenewal }) {
  const risks = getRiskFlagDisplay(row.riskFlags ?? []);
  const hiddenRiskTitle = risks.hidden.map((flag) => flag.label).join(", ");
  const primaryAction = getPrimaryAction(row, { canOpenPipeline, canStartRenewal });

  if (column.isCustom) {
    const field = getCustomFieldValue(row, column);
    const displayValue = renderCustomFieldDisplay(field, row, locale, userSettings);
    return (
      <td key={column.id} className={`rw-custom-cell${displayValue === "-" ? " rw-muted-cell" : ""}`} title={displayValue !== "-" ? displayValue : undefined}>
        {displayValue}
      </td>
    );
  }

  switch (column.id) {
    case "dueDate":
      return <td key={column.id} className="mono">{formatDate(row.endDate, userSettings)}</td>;
    case "days":
      return <td key={column.id} className="mono lp-mono-bold">{formatDays(row.daysUntilExpiry)}</td>;
    case "license":
      return (
        <td key={column.id}>
          <div className="pub-cell">{row.publisherName}</div>
          <div className="sw-cell">{row.softwareDescription}</div>
        </td>
      );
    case "licenseRef":
      return <td key={column.id} className="mono">{row.licenseRef || "-"}</td>;
    case "supplier":
      return <td key={column.id}>{row.supplier || "-"}</td>;
    case "budgetOwner":
      return <td key={column.id}>{row.budgetOwnerEmail || "-"}</td>;
    case "value":
      return (
        <td key={column.id} className="mono lp-mono-bold">
          {formatCost(row.estimatedAnnualValue, row.currency, locale)}
        </td>
      );
    case "status":
      return (
        <td key={column.id}>
          <span className={`badge ${STATUS_BADGE_CLASS[row.renewalStatus] ?? "badge-gray"}`}>
            <span className="badge-dot" />
            {STATUS_LABELS[row.renewalStatus] ?? row.renewalStatus}
          </span>
        </td>
      );
    case "riskFlags":
      return (
        <td key={column.id}>
          <div className="rw-risk-list">
            {risks.visible.map((flag) => (
              <span
                key={flag.code}
                className={`badge rw-risk-badge rw-risk-${flag.severity} ${RISK_CLASS[flag.severity] ?? "badge-gray"}`}
                title={flag.label}
              >
                {flag.label}
              </span>
            ))}
            {risks.hidden.length > 0 && (
              <span className="badge badge-gray rw-risk-more" title={hiddenRiskTitle}>+{risks.hidden.length}</span>
            )}
          </div>
        </td>
      );
    case "actions":
      return (
        <td key={column.id}>
          <div className="rw-actions">
            {primaryAction === "start" && (
              <button
                type="button"
                className="btn btn-p rw-action-btn"
                aria-label={`Initiate renewal for ${row.softwareDescription}`}
                title="Initiate renewal"
                disabled={startingId === row.licenseId}
                onClick={(event) => {
                  event.stopPropagation();
                  onStartRenewal(row);
                }}
              >
                {startingId === row.licenseId ? "Initiating" : "Initiate Renewal"}
              </button>
            )}
            {primaryAction === "sourcing" && (
              <button
                type="button"
                className="btn btn-p rw-action-btn"
                aria-label={`Open sourcing item for ${row.softwareDescription}`}
                title="Open sourcing item"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigateToSourcing?.(row.sourcingItemId);
                }}
              >
                Sourcing
              </button>
            )}
            {primaryAction === "po" && (
              <button
                type="button"
                className="btn btn-p rw-action-btn"
                aria-label={`Open pending order for ${row.softwareDescription}`}
                title="Open pending order"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigateToPendingOrder?.(row.pendingOrderId);
                }}
              >
                PO
              </button>
            )}
            <button
              type="button"
              className="btn btn-g rw-action-btn"
              aria-label={`Open license ${row.softwareDescription}`}
              title="Open license"
              onClick={(event) => {
                event.stopPropagation();
                onNavigateToLicense?.(row.licenseId);
              }}
            >
              Open
            </button>
          </div>
        </td>
      );
    default:
      return null;
  }
}

export default function RenewalWorkbenchTable({
  visibleColumns,
  visibleRows,
  startingId,
  locale,
  userSettings,
  canStartRenewal,
  canOpenPipeline,
  onNavigateToLicense,
  onNavigateToSourcing,
  onNavigateToPendingOrder,
  onStartRenewal,
}) {
  const cellContext = { startingId, locale, userSettings, canStartRenewal, canOpenPipeline, onNavigateToLicense, onNavigateToSourcing, onNavigateToPendingOrder, onStartRenewal };

  return (
    <div className="lp-tbl-wrap">
      <table className="license-table rw-table">
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th key={column.id}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr
              key={row.licenseId}
              tabIndex={0}
              style={rowTone(row)}
              onClick={() => onNavigateToLicense?.(row.licenseId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onNavigateToLicense?.(row.licenseId);
                }
              }}
            >
              {visibleColumns.map((column) => renderCell(column, row, cellContext))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
