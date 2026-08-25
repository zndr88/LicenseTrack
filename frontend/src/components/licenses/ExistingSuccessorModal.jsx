import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { linkExistingSuccessor } from "../../api/licenses.js";
import { queryKeys } from "../../queryKeys.js";
import { invalidateRenewalWorkflow } from "../../queryInvalidation.js";
import { formatDate } from "../../utils/formatting.js";
import { getExpirationStatus, normalizeLicense } from "../../utils/helpers.js";
import ModalShell from "../ui/ModalShell.jsx";

const NON_RENEWABLE_TYPES = new Set(["service", "other"]);

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function entitlementIdentity(license) {
  return [
    license.publisherName,
    license.softwareDescription,
    license.skuCode,
    license.licenseMetric,
    license.licenseType,
  ].map(normalized).join("|");
}

export function getExistingSuccessorCandidates(predecessor, allLicenses, notificationDays) {
  const predecessorPo = normalized(predecessor.poNumber);
  if (!predecessorPo) return [];

  return allLicenses
    .filter((candidate) => candidate.id !== predecessor.id)
    .filter((candidate) => normalized(candidate.poNumber) === predecessorPo)
    .filter((candidate) => entitlementIdentity(candidate) === entitlementIdentity(predecessor))
    .filter((candidate) => !NON_RENEWABLE_TYPES.has(candidate.licenseType))
    .filter((candidate) => !candidate.retired && !candidate.isRetired && !candidate.lifecycleStatus)
    .filter((candidate) => !candidate.renewedFromId && !candidate.predecessorId && !candidate.renewedToId)
    .filter((candidate) => candidate.endDate && candidate.endDate > predecessor.endDate)
    .filter((candidate) => !predecessor.startDate || (candidate.startDate && candidate.startDate > predecessor.startDate))
    .map((candidate) => ({
      candidate,
      expiration: getExpirationStatus(
        candidate.endDate,
        notificationDays,
        candidate.retired,
        candidate.lifecycleStatus,
        candidate.renewedToId,
        candidate.startDate,
        candidate.licenseType,
      ),
    }))
    .filter(({ expiration }) => expiration.status === "active" || expiration.status === "upcoming")
    .sort((a, b) => String(a.candidate.startDate || "").localeCompare(String(b.candidate.startDate || "")));
}

function dateRelationship(predecessor, successor) {
  if (!predecessor.endDate || !successor.startDate) return null;
  const predecessorEnd = new Date(`${predecessor.endDate}T00:00:00`);
  const successorStart = new Date(`${successor.startDate}T00:00:00`);
  const dayMs = 24 * 60 * 60 * 1000;
  const delta = Math.round((successorStart - predecessorEnd) / dayMs) - 1;
  if (delta > 0) return { tone: "warning", text: `${delta}-day gap between terms` };
  if (delta < 0) return { tone: "warning", text: `${Math.abs(delta)}-day overlap between terms` };
  return { tone: "ok", text: "Terms are contiguous" };
}

export default function ExistingSuccessorModal({
  predecessor,
  allLicenses,
  globalSettings,
  userSettings,
  onUpdate,
  onSuccess,
  onClose,
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const candidates = useMemo(() => getExistingSuccessorCandidates(
    predecessor,
    allLicenses,
    globalSettings.notificationDays,
  ), [predecessor, allLicenses, globalSettings.notificationDays]);
  const filtered = candidates.filter(({ candidate }) => (
    `${candidate.licenseRef || ""} ${(candidate.licenseRefAliases || []).join(" ")} ${candidate.publisherName || ""} ${candidate.softwareDescription || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  ));
  const selected = candidates.find(({ candidate }) => String(candidate.id) === selectedId)?.candidate;
  const relationship = selected ? dateRelationship(predecessor, selected) : null;

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    const { data, error: requestError } = await linkExistingSuccessor(predecessor.id, selected.id);
    setSaving(false);
    if (requestError) {
      setError(requestError);
      return;
    }
    const updatedPredecessor = normalizeLicense(data.predecessor);
    const updatedSuccessor = normalizeLicense(data.successor);
    onUpdate(predecessor.id, updatedPredecessor);
    onUpdate(selected.id, updatedSuccessor);
    invalidateRenewalWorkflow(queryClient);
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseProcurementTrail(predecessor.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.licenseProcurementTrail(selected.id) });
    onSuccess?.(updatedSuccessor, data.formerSuccessorLicenseRef);
  };

  return (
    <ModalShell
      title="Link existing successor"
      titleId="existing-successor-title"
      onClose={onClose}
      closeOnOverlayClick={false}
      footer={(
        <>
          <button type="button" className="btn btn-g btn-sm" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-p btn-sm" disabled={!selected || saving} onClick={save}>
            {saving ? "Linking..." : "Link as renewal"}
          </button>
        </>
      )}
    >
      <div className="modal-bd existing-successor-modal">
        <p>
          Choose an active or upcoming license already purchased under PO <strong>{predecessor.poNumber}</strong>.
          No new sourcing request or pending order will be created.
        </p>
        <input
          className="fi"
          type="search"
          placeholder="Search by LT ref, publisher, or description"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        <div role="listbox" aria-label="Eligible existing successors" className="existing-successor-list">
          {filtered.map(({ candidate, expiration }) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={String(candidate.id) === selectedId}
              className={`existing-successor-option${String(candidate.id) === selectedId ? " is-selected" : ""}`}
              onClick={() => setSelectedId(String(candidate.id))}
            >
              <span className="existing-successor-option-main">
                <strong>{candidate.licenseRef || `License #${candidate.id}`}</strong>
                <span>{candidate.publisherName} · {candidate.softwareDescription}</span>
              </span>
              <span className="existing-successor-option-meta">
                {expiration.label} · {formatDate(candidate.startDate, userSettings)} – {formatDate(candidate.endDate, userSettings)}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="existing-successor-empty">
              No eligible active or upcoming licenses were found under this PO.
            </div>
          )}
        </div>

        {selected && (
          <div className="existing-successor-confirmation">
            <div className="dp-toggle-title">Renew into {selected.licenseRef}</div>
            <div className="dp-toggle-desc">
              The current license will become Renewed and the selected license will inherit chain reference {predecessor.licenseRef}.
              Its current reference {selected.licenseRef} remains reserved and searchable in history.
            </div>
            {relationship && (
              <div className={`existing-successor-date-check is-${relationship.tone}`}>{relationship.text}</div>
            )}
          </div>
        )}
        {error && <div className="field-error existing-successor-error">{error}</div>}
      </div>
    </ModalShell>
  );
}
