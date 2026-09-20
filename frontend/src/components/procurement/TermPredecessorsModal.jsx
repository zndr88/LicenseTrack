import { useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";

export default function TermPredecessorsModal({ target, items, onSave, onCancel }) {
  const [selected, setSelected] = useState(() => new Set(
    items.filter((item) => item.successorSourcingItemId === target.id).map((item) => item.id),
  ));
  const [saving, setSaving] = useState(false);
  const candidates = items.filter((item) => item.id !== target.id && item.sourcingRequestId === target.sourcingRequestId);

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      if (await onSave(target.id, [...selected])) onCancel();
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
        {candidates.map((item) => {
          const linkedElsewhere = item.successorSourcingItemId != null && item.successorSourcingItemId !== target.id;
          return (
            <label key={item.id} className="term-predecessor-choice">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                disabled={linkedElsewhere || saving}
                onChange={() => toggle(item.id)}
              />
              <span>
                <strong>{item.softwareDescription}</strong> · Line #{item.id}
                {item.startDate && item.endDate && <small> · {item.startDate} to {item.endDate}</small>}
                {linkedElsewhere && <small> · Already linked to another next term</small>}
              </span>
            </label>
          );
        })}
      </div>
    </ModalShell>
  );
}
