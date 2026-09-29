import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getLicense, linkMaintenanceToParent } from "../../api/licenses.js";
import { queryKeys } from "../../queryKeys.js";
import ModalShell from "../ui/ModalShell.jsx";
import LinkPicker from "../ui/LinkPicker.jsx";
import { useAllLicenses } from "../../hooks/useAllLicenses.js";
import { isMaintenanceParentType } from "../../utils/maintenanceCoverage.js";
import { isHiddenFromLinking, parentCandidate } from "../../utils/maintenanceLinking.js";

export default function LegacyMaintenanceLinkModal({ license, onSuccess, onClose }) {
  const queryClient = useQueryClient();
  const { licenses } = useAllLicenses();
  const [parentId, setParentId] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [linkedRefreshFailed, setLinkedRefreshFailed] = useState(false);
  const eligible = useMemo(() => licenses.filter((item) => isMaintenanceParentType(item.licenseType)), [licenses]);
  const visible = useMemo(
    () => (showHidden ? eligible : eligible.filter((item) => !isHiddenFromLinking(item))),
    [eligible, showHidden],
  );
  const candidates = useMemo(() => visible.map(parentCandidate), [visible]);

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
        <LinkPicker
          candidates={candidates}
          selectedIds={parentId ? [Number(parentId)] : []}
          onChange={(ids) => setParentId(ids[0] ? String(ids[0]) : "")}
          searchPlaceholder="Search by LT ref, publisher, description, PO, contract, or date"
          listLabel="Eligible parent licenses"
          emptyMessage="No eligible parent licenses found."
          hiddenCount={showHidden ? 0 : eligible.length - visible.length}
          onShowHidden={() => setShowHidden(true)}
        />
        {error && <div className="field-error legacy-maintenance-link-error">{error}</div>}
        </>}
      </div>
    </ModalShell>
  );
}
