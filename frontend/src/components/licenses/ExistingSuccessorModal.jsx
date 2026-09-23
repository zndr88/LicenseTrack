import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { linkExistingSuccessor } from "../../api/licenses.js";
import { queryKeys } from "../../queryKeys.js";
import { invalidateRenewalWorkflow } from "../../queryInvalidation.js";
import { formatDate } from "../../utils/formatting.js";
import { getExpirationPresentation, normalizeLicense } from "../../utils/helpers.js";
import { isRenewableLicense } from "../../utils/licenseTypeRules.js";
import { termDateRelationship } from "../../utils/termRelationship.js";
import LinkPicker from "../ui/LinkPicker.jsx";
import ModalShell from "../ui/ModalShell.jsx";

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function getExistingSuccessorCandidates(predecessor, allLicenses) {
  const publisher = normalized(predecessor.publisherName);
  if (!publisher) return [];

  return allLicenses
    .filter((candidate) => candidate.id !== predecessor.id)
    .filter((candidate) => normalized(candidate.publisherName) === publisher)
    .filter((candidate) => isRenewableLicense(candidate))
    .filter((candidate) => !candidate.retired && !candidate.isRetired && !candidate.retirementScheduled && !candidate.lifecycleStatus)
    .filter((candidate) => !candidate.renewedFromId && !candidate.predecessorId && !candidate.renewedToId)
    .filter((candidate) => !candidate.cotermFromIds?.length)
    .filter((candidate) => candidate.endDate && candidate.endDate > predecessor.endDate)
    .filter((candidate) => !predecessor.startDate || (candidate.startDate && candidate.startDate > predecessor.startDate))
    .filter((candidate) => candidate.expirationStatus === "active" || candidate.expirationStatus === "upcoming")
    .map((candidate) => ({
      candidate,
      expiration: getExpirationPresentation(candidate),
    }))
    .sort((a, b) => String(a.candidate.startDate || "").localeCompare(String(b.candidate.startDate || "")));
}

export default function ExistingSuccessorModal({
  predecessor,
  allLicenses,
  userSettings,
  onUpdate,
  onSuccess,
  onClose,
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const candidates = useMemo(() => getExistingSuccessorCandidates(
    predecessor,
    allLicenses,
  ), [predecessor, allLicenses]);
  const options = useMemo(() => candidates.map(({ candidate, expiration }) => ({
    id: candidate.id,
    title: candidate.licenseRef || `License #${candidate.id}`,
    subtitle: `${candidate.publisherName} · ${candidate.softwareDescription}`,
    meta: `${expiration.label} · ${formatDate(candidate.startDate, userSettings)} – ${formatDate(candidate.endDate, userSettings)}`,
    searchText: `${candidate.licenseRef || ""} ${(candidate.licenseRefAliases || []).join(" ")} ${candidate.publisherName || ""} ${candidate.softwareDescription || ""}`,
  })), [candidates, userSettings]);
  const selected = candidates.find(({ candidate }) => String(candidate.id) === selectedId)?.candidate;
  const relationship = selected ? termDateRelationship(predecessor, selected) : null;

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
          Choose an active or upcoming license already purchased from <strong>{predecessor.publisherName}</strong>.
          Descriptions and PO numbers can differ.
          No new sourcing request or pending order will be created.
        </p>
        <LinkPicker
          candidates={options}
          selectedIds={selectedId ? [selectedId] : []}
          onChange={(ids) => setSelectedId(ids.length ? String(ids[ids.length - 1]) : "")}
          searchPlaceholder="Search by LT ref, publisher, or description"
          listLabel="Eligible existing successors"
          emptyMessage="No eligible active or upcoming licenses were found for this publisher."
          disabled={saving}
        />

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
