// frontend/src/components/licenses/detail/RenewalWorkflowSection.jsx
import { useState, useEffect } from "react";
import { isRenewableLicense } from "../../../utils/licenseTypeRules.js";
import { formatDate } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import { useRenewalPanelModel } from "./useRenewalPanelModel.js";
import { isRenewalActionEligible } from "../../../utils/renewalBundle.js";

// PO bundles at or below this size stay expanded; larger ones start collapsed.
const BUNDLE_COLLAPSE_THRESHOLD = 8;

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
  onCreateRenewalBundle,
  onCancelRenewal,
  onNavigate,
  onNavigateToSourcing,
  onNavigateToPendingOrder,
  onLinkExistingSuccessor,
  onUnlinkExistingSuccessor,
  setConfirmAction,
  setToast,
  onDismiss,
}) {
  const { poSiblings, bundleCount, actionDays } = useRenewalPanelModel({ license, allLicenses, globalSettings });
  const [initiatingRenewal, setInitiatingRenewal] = useState(false);
  const [unlinkingSuccessor, setUnlinkingSuccessor] = useState(false);

  // Renewal bundle selection: the license being renewed is always included;
  // its PO siblings default to checked but can be excluded before initiating.
  const bundleMembers = [license, ...poSiblings];
  const memberIds = bundleMembers.map((member) => member.id);
  const memberIdsKey = memberIds.join(",");
  const [selectedRenewalIds, setSelectedRenewalIds] = useState(() => new Set(memberIds));
  // Collapse the list by default once a PO carries enough lines to be unwieldy.
  const [bundleExpanded, setBundleExpanded] = useState(bundleMembers.length <= BUNDLE_COLLAPSE_THRESHOLD);
  useEffect(() => {
    const ids = memberIdsKey ? memberIdsKey.split(",").map(Number) : [];
    setSelectedRenewalIds(new Set(ids));
    setBundleExpanded(ids.length <= BUNDLE_COLLAPSE_THRESHOLD);
  }, [memberIdsKey]);
  const selectedRenewalCount = selectedRenewalIds.size;
  const allRenewalSelected = selectedRenewalCount === bundleMembers.length;
  const toggleRenewalMember = (id) => setSelectedRenewalIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  // Select-all fills every line; clear keeps only the renewing license, which
  // is always part of its own renewal.
  const toggleSelectAllRenewal = () => setSelectedRenewalIds(
    allRenewalSelected ? new Set([license.id]) : new Set(memberIds),
  );

  const canStartRenewal = isRenewableLicense(license);
  const canLinkExistingSuccessor = Boolean(license.publisherName?.trim());
  const isWithinActionWindow = isRenewalActionEligible(license, actionDays);
  const showWorkflowBox = isWithinActionWindow &&
    license.lifecycleStatus !== "pending_renewal" && !license.renewedToId &&
    !license.retired && !license.retirementScheduled && canStartRenewal;
  const hasRenewalContent = showWorkflowBox ||
    Boolean(license.renewedToId && ["active", "expiring", "expired", "renewed"].includes(exp.status)) ||
    license.lifecycleStatus === "pending_renewal" ||
    Boolean(license.renewedFromId);
  const successor = license.renewedToId
    ? allLicenses.find((candidate) => candidate.id === license.renewedToId)
    : null;

  const confirmUnlinkExistingSuccessor = () => {
    setConfirmAction({
      title: "Unlink Existing Successor",
      message: "Remove this existing-purchase renewal link? The predecessor will return to its date-based status and the successor's former LT reference will be restored.",
      confirmLabel: "Unlink Successor",
      danger: true,
      onConfirm: async () => {
        setConfirmAction(null);
        setUnlinkingSuccessor(true);
        const result = await onUnlinkExistingSuccessor(license.id);
        setUnlinkingSuccessor(false);
        if (!result?.ok) {
          setToast(`Unlink failed: ${result?.error || "Unknown error"}`);
          return;
        }
        setToast("Existing successor unlinked");
      },
    });
  };

  if (!hasRenewalContent) return null;

  return (
    <div className="dp-renewal-area">
      {onDismiss && (
        <button type="button" className="dp-renewal-dismiss" aria-label="Hide renewal workflow" title="Hide until this license is reopened" onClick={onDismiss}>
          <Icon name="x" size={12} />
        </button>
      )}
      {/* Renewal Workflow box */}
      {showWorkflowBox && (
        <div className="dp-purple-box" style={{ paddingTop: 12, paddingBottom: 12 }}>
          <div className="dp-renewal-title">
            <Icon name="clock" size={14} color="var(--purple-text)" /> Renewal Workflow
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 10, lineHeight: 1.5 }}>
            {license.budgetOwnerEmail
              ? bundleCount > 1
                ? `${bundleCount} licenses share PO ${license.poNumber} and the same end date. Choose which to include below — one sourcing request is created with a line per selected license.`
                : `Initiating renewal will create a sourcing record routed through procurement. Once a successor is created, this license remains current until its own end date.`
              : "Set a budget owner email above to start procurement, or link the next term if it was already purchased under this PO."}
          </div>
          {license.budgetOwnerEmail && bundleCount > 1 && (
            <div className="dp-renewal-bundle">
              <div className="dp-renewal-bundle-head">
                <button
                  type="button"
                  className="dp-renewal-bundle-toggle"
                  onClick={() => setBundleExpanded((open) => !open)}
                  aria-expanded={bundleExpanded}
                >
                  <Icon name={bundleExpanded ? "chevron-down" : "chevron-right"} size={12} />
                  {selectedRenewalCount} of {bundleMembers.length} licenses selected
                </button>
                {perms.canEdit && (
                  <button type="button" className="dp-renewal-bundle-all" onClick={toggleSelectAllRenewal}>
                    {allRenewalSelected ? "Clear" : "Select all"}
                  </button>
                )}
              </div>
              {bundleExpanded && (
                <div className="dp-renewal-bundle-list">
                  {bundleMembers.map((member) => {
                    const isCurrent = member.id === license.id;
                    return (
                      <label key={member.id} className="dp-renewal-bundle-item">
                        <input
                          type="checkbox"
                          checked={selectedRenewalIds.has(member.id)}
                          disabled={isCurrent || !perms.canEdit}
                          onChange={() => toggleRenewalMember(member.id)}
                        />
                        <span>
                          {member.publisherName} — {member.softwareDescription}
                          <span style={{ color: "var(--text-3)", marginLeft: 6 }}>
                            qty {member.quantity || "—"}{isCurrent ? " · this license" : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {perms.canEdit && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {license.budgetOwnerEmail && (
                <button
                  className="btn btn-p"
                  style={{ fontSize: 11, padding: "6px 12px" }}
                  disabled={initiatingRenewal || selectedRenewalCount === 0}
                  onClick={async () => {
                    setInitiatingRenewal(true);
                    try {
                      const ids = bundleMembers
                        .map((member) => member.id)
                        .filter((id) => selectedRenewalIds.has(id));
                      const result = ids.length > 1 && onCreateRenewalBundle
                        ? await onCreateRenewalBundle(ids)
                        : await onCreateRenewal(license.id);
                      if (!result?.ok) return;
                      setToast(
                        ids.length > 1
                          ? `Renewal initiated - one sourcing request with ${ids.length} lines created`
                          : "Renewal initiated - sourcing record created"
                      );
                      setTimeout(() => setToast(null), 6000);
                    } finally {
                      setInitiatingRenewal(false);
                    }
                  }}
                >
                  <Icon name="clock" size={13} />{" "}
                  {initiatingRenewal ? "Initiating..." : selectedRenewalCount > 1 ? `Initiate Renewal (${selectedRenewalCount} licenses)` : "Initiate Renewal"}
                </button>
              )}
              {canLinkExistingSuccessor && (
                <button type="button" className="btn btn-g" style={{ fontSize: 11, padding: "6px 12px" }} onClick={onLinkExistingSuccessor}>
                  <Icon name="arrow-right" size={13} /> Link Existing Successor
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Successor secured while the predecessor still owns current coverage. */}
      {["active", "expiring", "expired"].includes(exp.status) && license.renewedToId && (
        <div className="dp-purple-box" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="dp-purple-title">Successor Linked</div>
            <div className="dp-toggle-desc">
              {exp.status === "expired"
                ? `This term has ended. The successor${successor?.startDate ? ` starts ${formatDate(successor.startDate, userSettings)}` : " is not active yet"}.`
                : ["active", "expiring", "perpetual"].includes(successor?.expirationStatus)
                  ? `This license remains ${exp.status} until its own end date. The successor is already active, so coverage overlaps until then.`
                : successor?.startDate
                  ? `This license remains ${exp.status} until its own end date. The successor starts ${formatDate(successor.startDate, userSettings)}.`
                  : `This license remains ${exp.status} until its own end date.`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn btn-g btn-sm" onClick={() => onNavigate(license.renewedToId)}>View Successor →</button>
            {perms.canEdit && license.existingSuccessorLinkedAt && (
              <button className="btn btn-g btn-sm" disabled={unlinkingSuccessor} onClick={confirmUnlinkExistingSuccessor}>
                {unlinkingSuccessor ? "Unlinking..." : "Unlink"}
              </button>
            )}
          </div>
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
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="btn btn-g btn-sm" onClick={() => onNavigate(license.renewedToId)}>View Renewal →</button>
              {perms.canEdit && license.existingSuccessorLinkedAt && (
                <button className="btn btn-g btn-sm" disabled={unlinkingSuccessor} onClick={confirmUnlinkExistingSuccessor}>
                  {unlinkingSuccessor ? "Unlinking..." : "Unlink"}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Pending Renewal (pipeline flow) */}
      {license.lifecycleStatus === "pending_renewal" && (() => {
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
              Sourcing record created — renewal is being processed through the procurement pipeline. When the successor is created, this license remains current until its own end date.
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
      {license.renewedFromId && (() => {
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
                This term follows {license.cotermFromIds.length} earlier license records.
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
    </div>
  );
}
