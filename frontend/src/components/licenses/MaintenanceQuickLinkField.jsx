import { useState } from "react";
import LinkPicker from "../ui/LinkPicker.jsx";

/** Optional search to link an existing maintenance record while coverage is Separately tracked. */
export default function MaintenanceQuickLinkField({ candidates, value, onChange }) {
  const [showHidden, setShowHidden] = useState(false);
  return (
    <div className="fg">
      <span className="fg-label">Link an existing maintenance record (optional)</span>
      <LinkPicker
        candidates={showHidden ? candidates.all : candidates.visible}
        selectedIds={value ? [Number(value)] : []}
        onChange={(ids) => onChange(ids[0] ? String(ids[0]) : "")}
        searchPlaceholder="Search by LT ref, publisher, description, PO, contract, or date"
        listLabel="Existing maintenance records"
        emptyMessage="No eligible maintenance records were found."
        hiddenCount={showHidden ? 0 : candidates.hidden.length}
        onShowHidden={() => setShowHidden(true)}
      />
    </div>
  );
}
