import { useEffect } from "react";

/** Inline prompt shown after the supplier changes while the old supplier contact is still set. */
export default function SupplierContactPrompt({ contactInputId, onKeep, onClear }) {
  useEffect(() => {
    document.getElementById(contactInputId)?.focus();
  }, [contactInputId]);

  return (
    <div className="supplier-contact-prompt" role="alert">
      <span>Supplier changed — update the supplier contact? Leaving it empty is fine.</span>
      <div className="supplier-contact-prompt-actions">
        <button type="button" className="btn btn-g" onClick={onKeep}>Keep</button>
        <button type="button" className="btn btn-g" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}
