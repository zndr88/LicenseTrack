import { useMemo, useState } from "react";
import { formatDate } from "../../utils/formatting.js";
import { termDateRelationship } from "../../utils/termRelationship.js";
import Icon from "../ui/Icon.jsx";
import LinkPicker from "../ui/LinkPicker.jsx";
import ModalShell from "../ui/ModalShell.jsx";

// Every line that already leads (directly or transitively) to `target`. Picking
// one of these as the next term would form a cycle, so they are not offered.
function ancestorIds(target, items) {
  const ancestors = new Set();
  let frontier = items.filter((item) => item.successorSourcingItemId === target.id).map((item) => item.id);
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      if (ancestors.has(id)) continue;
      ancestors.add(id);
      for (const predecessor of items.filter((item) => item.successorSourcingItemId === id)) {
        next.push(predecessor.id);
      }
    }
    frontier = next;
  }
  return ancestors;
}

export default function TermSuccessorModal({ target, items, userSettings, onSave, onCreateNew, onCancel }) {
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);

  const excluded = useMemo(() => ancestorIds(target, items), [target, items]);
  const candidates = useMemo(() => items
    .filter((item) => item.id !== target.id
      && item.sourcingRequestId === target.sourcingRequestId
      && !excluded.has(item.id))
    .map((item) => ({
      id: item.id,
      title: item.softwareDescription || `Line #${item.id}`,
      subtitle: item.publisherName || null,
      meta: item.startDate && item.endDate
        ? `${formatDate(item.startDate, userSettings)} – ${formatDate(item.endDate, userSettings)}`
        : null,
    })), [items, target, excluded, userSettings]);

  const relationship = (option) => {
    const item = items.find((candidate) => candidate.id === option.id);
    return item ? termDateRelationship(target, item) : null;
  };

  const chosen = items.find((item) => String(item.id) === selectedId);

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    try {
      // A successor keeps its existing predecessors (consolidation); this line
      // is added alongside them.
      const predecessorIds = [
        ...items.filter((item) => item.successorSourcingItemId === chosen.id).map((item) => item.id),
        target.id,
      ];
      if (await onSave(chosen.id, [...new Set(predecessorIds)])) onCancel();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`Next term for ${target.softwareDescription}`}
      titleId="term-successor-title"
      onClose={onCancel}
      modalClassName="modal"
      footer={<>
        <button className="btn btn-g" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-p" onClick={save} disabled={!chosen || saving}>Set next term</button>
      </>}
    >
      <div className="modal-bd">
        <p>Choose the later term this line rolls into. Pick another line already in this request, or create a new term line.</p>
        <LinkPicker
          candidates={candidates}
          selectedIds={selectedId ? [selectedId] : []}
          onChange={(ids) => setSelectedId(ids.length ? String(ids[ids.length - 1]) : "")}
          relationship={relationship}
          searchPlaceholder="Search later terms"
          listLabel="Later terms this line can roll into"
          emptyMessage="No other lines in this request can be its next term."
          disabled={saving}
        />
        <button
          type="button"
          className="btn btn-g term-successor-create"
          onClick={onCreateNew}
          disabled={saving}
        >
          <Icon name="plus" size={12} /> Create a new term line instead
        </button>
      </div>
    </ModalShell>
  );
}
