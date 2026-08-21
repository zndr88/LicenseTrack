import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getLicense, linkMaintenanceToParent } from "../../api/licenses.js";
import { queryKeys } from "../../queryKeys.js";
import ModalShell from "../ui/ModalShell.jsx";

const PARENT_TYPES = new Set(["perpetual", "oem", "freeware"]);

export default function LegacyMaintenanceLinkModal({ license, allLicenses = [], onSuccess, onClose }) {
  const queryClient = useQueryClient();
  const [parentId, setParentId] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [linkedRefreshFailed, setLinkedRefreshFailed] = useState(false);
  const parents = useMemo(() => allLicenses
    .filter((item) => PARENT_TYPES.has(item.licenseType) && !item.isRetired && !item.retired)
    .filter((item) => `${item.licenseRef || ""} ${item.publisherName || ""} ${item.softwareDescription || ""}`.toLowerCase().includes(query.trim().toLowerCase())), [allLicenses, query]);

  const save = async () => {
    if (!parentId) return;
    setSaving(true);
    setError("");
    const result = await linkMaintenanceToParent(Number(parentId), license.id);
    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
    const refreshed = await getLicense(license.id);
    setSaving(false);
    if (refreshed.data) onSuccess?.(refreshed.data, Number(parentId));
    else setLinkedRefreshFailed(true);
  };

  return (
    <ModalShell title="Link legacy maintenance" titleId="legacy-maintenance-link-title" onClose={onClose} footer={(
      <>
        <button type="button" className="btn btn-g btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-p btn-sm" disabled={!parentId || saving || linkedRefreshFailed} onClick={save}>
          {saving ? "Linking..." : "Link maintenance"}
        </button>
      </>
    )}>
      <div className="modal-bd">
        {linkedRefreshFailed && (
          <div className="legacy-maintenance-link-success">
            Maintenance linked, but the refreshed record could not be loaded. Close this dialog and refresh the license list before continuing.
            <button type="button" className="btn btn-g btn-sm" onClick={onClose}>Close</button>
          </div>
        )}
        {!linkedRefreshFailed && <>
        <p>This maintenance record was imported without its original purchase parent. Choose an eligible parent to complete the link.</p>
        <input className="fi" type="search" placeholder="Search by LT ref, publisher, or description" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
        <div role="listbox" aria-label="Eligible parent licenses" className="legacy-maintenance-parent-list">
          {parents.map((parent) => (
            <button key={parent.id} type="button" role="option" aria-selected={String(parent.id) === String(parentId)} className={`legacy-maintenance-parent-option${String(parent.id) === String(parentId) ? " is-selected" : ""}`} onClick={() => setParentId(String(parent.id))}>
              {parent.licenseRef || `LT-${parent.id}`} — {parent.publisherName} / {parent.softwareDescription}
            </button>
          ))}
          {parents.length === 0 && <div className="legacy-maintenance-parent-empty">No eligible parent licenses found.</div>}
        </div>
        {error && <div className="field-error legacy-maintenance-link-error">{error}</div>}
        </>}
      </div>
    </ModalShell>
  );
}
