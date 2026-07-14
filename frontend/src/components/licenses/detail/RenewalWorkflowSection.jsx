// frontend/src/components/licenses/detail/RenewalWorkflowSection.jsx
import { useState } from "react";
import { formatDate } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import { useRenewalPanelModel } from "./useRenewalPanelModel.js";

export default function RenewalWorkflowSection({
  license,
  perms,
  exp,
  allLicenses,
  sourcingItems,
  pendingOrders,
  globalSettings,
  userSettings,
  onCreateRenewal,
  onCancelRenewal,
  onNavigate,
  onNavigateToSourcing,
  onNavigateToPendingOrder,
  setToast,
}) {
  const { poSiblings, bundleCount } = useRenewalPanelModel({ license, allLicenses, globalSettings });
  const [initiatingRenewal, setInitiatingRenewal] = useState(false);

  return (
    <>
      {/* Renewal Workflow box */}
      {(exp.status === "expiring" || exp.status === "expired") &&
        !license.renewedToId && !license.retired && (
        <div className="dp-purple-box" style={{ padding: "12px 14px" }}>
          <div className="dp-renewal-title">
            <Icon name="clock" size={14} color="var(--purple-text)" /> Renewal Workflow
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 10, lineHeight: 1.5 }}>
            {license.budgetOwnerEmail
              ? bundleCount > 1
                ? `${bundleCount} licenses share PO ${license.poNumber}. ${bundleCount} sourcing records will be created to route through procurement.`
                : `Initiating renewal will create a sourcing record routed through procurement. This license will be retired once the renewal is complete and a successor license will be created with the new dates.`
              : "Set a budget owner email above to enable automated renewal notifications."}
          </div>
          {perms.canEdit && license.budgetOwnerEmail && (
            <button
              className="btn btn-p"
              style={{ fontSize: 11, padding: "6px 12px" }}
              disabled={initiatingRenewal}
              onClick={async () => {
                setInitiatingRenewal(true);
                try {
                  const allToRenew = [license, ...poSiblings];
                  let createdCount = 0;
                  for (const lic of allToRenew) {
                    const result = await onCreateRenewal(lic.id);
                    if (!result?.ok) {
                      if (createdCount > 0) {
                        setToast(`Renewal partially initiated - ${createdCount} of ${bundleCount} sourcing records created`);
                        setTimeout(() => setToast(null), 6000);
                      }
                      return;
                    }
                    createdCount += 1;
                  }
                  setToast(
                    bundleCount > 1
                      ? `Renewal initiated - ${bundleCount} sourcing records created`
                      : "Renewal initiated - sourcing record created"
                  );
                  setTimeout(() => setToast(null), 6000);
                } finally {
                  setInitiatingRenewal(false);
                }
              }}
            >
              <Icon name="clock" size={13} />{" "}
              {initiatingRenewal ? "Initiating..." : bundleCount > 1 ? `Initiate Renewal (${bundleCount} licenses)` : "Initiate Renewal"}
            </button>
          )}
        </div>
      )}

      {/* Draft already created */}
      {(exp.status === "expiring" || exp.status === "active") && license.renewedToId && (
        <div className="dp-purple-box" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="dp-purple-title">Renewal Draft Created</div>
            <div className="dp-toggle-desc">Notification sent to budget owner. Draft awaiting procurement.</div>
          </div>
          <button className="btn btn-g btn-sm" onClick={() => onNavigate(license.renewedToId)}>View Draft →</button>
        </div>
      )}

      {/* Renewed - successor exists */}
      {exp.status === "renewed" && license.renewedToId && (() => {
        const successor = allLicenses.find((l) => l.id === license.renewedToId);
        const cotermCount = successor?.cotermFromIds?.length ?? 0;
        return (
          <div className="dp-neutral-box">
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>Renewed</div>
              <div className="dp-toggle-desc">Term ended — this license has been succeeded by a renewal</div>
              {cotermCount > 1 && (
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                  Consolidated with {cotermCount - 1} other license(s) into a combined renewal.
                </div>
              )}
            </div>
            <button className="btn btn-g btn-sm" onClick={() => onNavigate(license.renewedToId)}>View Renewal →</button>
          </div>
        );
      })()}

      {/* Pending Renewal (pipeline flow) */}
      {exp.status === "pending_renewal" && !license.renewedFromId && (() => {
        const linkedSI = (sourcingItems ?? []).find(
          (si) =>
            si.renewalForLicenseId === license.id ||
            (si.cotermPredecessorIds ?? []).includes(license.id)
        );
        const linkedPo = linkedSI?.status === "converted"
          ? (pendingOrders ?? []).find((po) => po.items?.some((item) => item.id === linkedSI.id))
          : null;
        return (
          <div className="dp-purple-box">
            <div className="dp-purple-title">Renewal in Progress</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2, lineHeight: 1.5 }}>
              Sourcing record created — renewal is being processed through the procurement pipeline. This license will be retired once the renewal is complete and a successor license will be created with the new dates.
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {linkedPo && (
                <button className="btn btn-g btn-sm" style={{ fontSize: 11 }}
                  onClick={() => onNavigateToPendingOrder(linkedPo.id)}>
                  <Icon name="arrow-right" size={12} /> View in Pending Orders
                </button>
              )}
              {!linkedPo && linkedSI && (
                <button className="btn btn-g btn-sm" style={{ fontSize: 11 }}
                  onClick={() => onNavigateToSourcing(linkedSI.id)}>
                  <Icon name="arrow-right" size={12} /> View in Sourcing Overview
                </button>
              )}
              {perms.canEdit && (
                <button className="btn btn-g btn-sm" style={{ color: "var(--orange)" }}
                  onClick={() => onCancelRenewal(license.id)}>
                  <Icon name="x" size={12} /> Cancel Renewal
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Renewed From (successor links back to predecessor) */}
      {license.renewedFromId && license.lifecycleStatus !== "pending_renewal" && (() => {
        const isCoterm = license.cotermFromIds?.length > 0;
        if (!isCoterm) {
          return (
            <div className="dp-neutral-box">
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>Renewed From</div>
                <div className="dp-toggle-desc">This license was created as a renewal of a previous term.</div>
              </div>
              <button className="btn btn-g btn-sm" onClick={() => onNavigate(license.renewedFromId)}>← View Previous</button>
            </div>
          );
        }
        return (
          <div className="dp-neutral-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>Consolidated Renewal</div>
              <div className="dp-toggle-desc">
                This license was created by merging {license.cotermFromIds.length} cotermed renewal sourcing items.
              </div>
            </div>
            {license.cotermFromIds.map((predId) => {
              const pred = allLicenses.find((l) => l.id === predId);
              return (
                <div key={predId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  {pred ? (
                    <>
                      <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5 }}>
                        {pred.publisherName} — {pred.softwareDescription}
                        <span style={{ color: "var(--text-3)", marginLeft: 6 }}>
                          qty {pred.quantity || "—"} · ends {pred.endDate ? formatDate(pred.endDate, userSettings) : "perpetual"}
                        </span>
                      </div>
                      <button className="btn btn-g btn-sm" style={{ flexShrink: 0 }} onClick={() => onNavigate(predId)}>
                        View →
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--text-3)", opacity: 0.7 }}>
                      License #{predId} (not loaded)
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </>
  );
}
