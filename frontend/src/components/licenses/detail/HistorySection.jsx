import { useQuery } from "@tanstack/react-query";
import { getLicenseProcurementTrail } from "../../../api/licenses.js";
import { queryKeys } from "../../../queryKeys.js";
import { formatDateTime, formatMoney } from "../../../utils/formatting.js";
import { pendingOrderLabel } from "../../../utils/procurementLabels.js";
import Icon from "../../ui/Icon.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";

function statusLabel(value) {
  return String(value || "").replace(/_/g, " ").toUpperCase();
}

function TrailRow({ label, title, meta, children }) {
  return (
    <div className="dp-neutral-box dp-trail-row">
      <div className="dp-trail-copy">
        <div className="dp-trail-title">{label}</div>
        <div className="dp-toggle-desc dp-trail-description">{title}</div>
        {meta && <div className="dp-note">{meta}</div>}
      </div>
      {children && <div className="dp-trail-actions">{children}</div>}
    </div>
  );
}

export function ProcurementTrail({
  trail,
  loading,
  error,
  userSettings,
  onNavigateToSourcing,
  onNavigateToPendingOrder,
}) {
  if (loading) {
    return (
      <div className="dp-trail-status">
        <span className="spinner" style={{ margin: 0, width: 14, height: 14 }} />
        Loading procurement trail...
      </div>
    );
  }

  if (error) {
    return <div className="dp-note">Procurement trail unavailable.</div>;
  }

  const sourcingRequest = trail?.sourcingRequest;
  const sourcingItem = trail?.sourcingItem;
  const pendingOrder = trail?.pendingOrder;
  const conversion = trail?.conversion;
  const hasTrail = sourcingRequest || sourcingItem || pendingOrder;

  if (!hasTrail) {
    return <div className="dp-note">No linked procurement trail.</div>;
  }

  const sourceMetaParts = [];
  if (sourcingItem?.estimatedTotalPrice) {
    sourceMetaParts.push(formatMoney(sourcingItem.estimatedTotalPrice, sourcingItem.currency, userSettings));
  }
  if (sourcingItem?.renewalForLicenseId) {
    sourceMetaParts.push(`renewal of License Record ID #${sourcingItem.renewalForLicenseId}`);
  }
  if (conversion?.sourceMatchType === "matched") {
    sourceMetaParts.push("legacy match by PO line");
  }
  if (conversion?.sourceMatchType === "ambiguous") {
    sourceMetaParts.push("multiple PO lines match this license");
  }

  return (
    <div className="dp-trail">
      {sourcingRequest && (
        <TrailRow
          label="Sourcing Request"
          title={`Sourcing Request ID #${sourcingRequest.id} · ${sourcingRequest.supplier || "Unassigned supplier"}`}
          meta={[
            statusLabel(sourcingRequest.status),
            sourcingRequest.createdAt ? formatDateTime(sourcingRequest.createdAt, userSettings) : null,
          ].filter(Boolean).join(" · ")}
        >
          {sourcingItem?.id && onNavigateToSourcing && (
            <button type="button" className="btn btn-g btn-sm" onClick={() => onNavigateToSourcing(sourcingItem.id)}>
              <Icon name="arrow-right" size={12} />View Sourcing
            </button>
          )}
        </TrailRow>
      )}

      {sourcingItem && (
        <TrailRow
          label="Sourcing Line"
          title={`Sourcing Line ID #${sourcingItem.id} · ${sourcingItem.publisherName}`}
          meta={[sourcingItem.softwareDescription, ...sourceMetaParts].filter(Boolean).join(" · ")}
        />
      )}

      {pendingOrder && (
        <TrailRow
          label="Pending Order"
          title={`${pendingOrderLabel(pendingOrder)} - ${pendingOrder.supplier || "No supplier"}`}
          meta={[
            statusLabel(pendingOrder.status),
            `Pending Order #${pendingOrder.id}`,
            pendingOrder.procurementReference || null,
            pendingOrder.createdAt ? formatDateTime(pendingOrder.createdAt, userSettings) : null,
          ].filter(Boolean).join(" - ")}
        >
          {onNavigateToPendingOrder && (
            <button type="button" className="btn btn-g btn-sm" onClick={() => onNavigateToPendingOrder(pendingOrder.id)}>
              <Icon name="arrow-right" size={12} />View Order
            </button>
          )}
        </TrailRow>
      )}
    </div>
  );
}

export default function HistorySection({
  license,
  userSettings,
  isOpen,
  onToggle,
  onNavigateToSourcing,
  onNavigateToPendingOrder,
}) {
  const createdBy = license.createdByName
    || license.createdByEmail
    || (license.createdBy ? `User #${license.createdBy}` : "Unknown / legacy record");
  const { data: trail, isFetching, error } = useQuery({
    queryKey: queryKeys.licenseProcurementTrail(license.id),
    queryFn: async () => {
      const { data, error: requestError } = await getLicenseProcurementTrail(license.id);
      if (requestError) throw new Error(requestError);
      return data;
    },
    enabled: isOpen && Boolean(license.id),
    staleTime: 30_000,
  });

  return (
    <>
      <DetailSectionHeader sectionKey="history" title="History" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-history">
          <div className="fr dp-data-row">
            <div className="dp-field">
              <span className="dp-field-label">License Record ID</span>
              <div className="val mono">{license.id ?? "\u2014"}</div>
            </div>
            <div className="dp-field">
              <span className="dp-field-label">Created By</span>
              <div className="val">{createdBy}</div>
            </div>
          </div>
          <div className="fr dp-data-row">
            <div className="dp-field">
              <span className="dp-field-label">Created</span>
              <div className="val mono">{license.createdAt ? formatDateTime(license.createdAt, userSettings) : "\u2014"}</div>
            </div>
            <div className="dp-field">
              <span className="dp-field-label">Last Updated</span>
              <div className="val mono">{license.updatedAt ? formatDateTime(license.updatedAt, userSettings) : "\u2014"}</div>
            </div>
          </div>
          <div className="dp-trail-heading">Procurement Trail</div>
          <ProcurementTrail
            trail={trail}
            loading={isFetching}
            error={error}
            userSettings={userSettings}
            onNavigateToSourcing={onNavigateToSourcing}
            onNavigateToPendingOrder={onNavigateToPendingOrder}
          />
        </div>
      )}
      <div className="dp-section-divider" />
    </>
  );
}
