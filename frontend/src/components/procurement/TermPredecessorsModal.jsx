import { useState } from "react";
import { formatDate } from "../../utils/formatting.js";
import { canFollowInTermChain } from "../../utils/licenseTypeRules.js";
import { termDateRelationship } from "../../utils/termRelationship.js";
import LinkPicker from "../ui/LinkPicker.jsx";
import ModalShell from "../ui/ModalShell.jsx";

export default function TermPredecessorsModal({ target, items, userSettings, onSave, onCancel }) {
  const [selectedIds, setSelectedIds] = useState(() =>
    items.filter((item) => item.successorSourcingItemId === target.id).map((item) => item.id),
  );
  const [saving, setSaving] = useState(false);

  const candidates = items
    .filter((item) => item.id !== target.id && item.sourcingRequestId === target.sourcingRequestId)
    .map((item) => {
      const linkedElsewhere = item.successorSourcingItemId != null && item.successorSourcingItemId !== target.id;
      const typeMismatch = !canFollowInTermChain(item, target);
      return {
        id: item.id,
        title: item.softwareDescription || `Line #${item.id}`,
        subtitle: item.publisherName || null,
        meta: item.startDate && item.endDate
          ? `${formatDate(item.startDate, userSettings)} – ${formatDate(item.endDate, userSettings)}`
          : null,
        disabled: linkedElsewhere || typeMismatch,
        disabledReason: typeMismatch
          ? "Maintenance terms can only follow maintenance terms"
          : linkedElsewhere ? "Already linked to another next term" : null,
      };
    });

  const relationship = (option) => {
    const item = items.find((candidate) => candidate.id === option.id);
    return item ? termDateRelationship(item, target) : null;
  };

  const save = async () => {
    setSaving(true);
    try {
      if (await onSave(target.id, [...selectedIds])) onCancel();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`Predecessors for ${target.softwareDescription}`}
      titleId="term-predecessors-title"
      onClose={onCancel}
      modalClassName="modal"
      footer={<>
        <button className="btn btn-g" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-p" onClick={save} disabled={saving}>Save term links</button>
      </>}
    >
      <div className="modal-bd">
        <p>Select the earlier term or terms that this line succeeds. Each earlier line can have only one next term.</p>
        <LinkPicker
          candidates={candidates}
          multiple
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          relationship={relationship}
          searchPlaceholder="Search earlier terms"
          listLabel="Earlier terms this line can succeed"
          emptyMessage="No other lines in this request can be linked."
          disabled={saving}
        />
      </div>
    </ModalShell>
  );
}
