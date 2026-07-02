import React from "react";
import ModalShell from "./ModalShell.jsx";

/**
 * Minimal confirmation dialog shown when closing a dirty modal.
 * Rendered on top of the existing modal.
 */
export default function DiscardChangesDialog({ onDiscard, onKeep }) {
  return (
    <ModalShell
      ariaLabel="Discard unsaved changes?"
      closeOnOverlayClick={false}
      showCloseButton={false}
      overlayStyle={{ zIndex: 9999 }}
      modalClassName={null}
      modalStyle={{
        background: "var(--bg-1)", border: "1px solid var(--border)",
        borderRadius: "var(--r)", padding: "24px 28px", minWidth: 320,
        maxWidth: "min(400px, 92vw)", boxShadow: "var(--shadow-md)",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 8 }}>
        Discard unsaved changes?
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 20, lineHeight: 1.6 }}>
        Your edits will be lost if you close without saving.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-g" onClick={onKeep}>
          Keep editing
        </button>
        <button
          className="btn"
          style={{ background: "var(--red)", color: "var(--bg-0)", border: "none" }}
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
    </ModalShell>
  );
}
