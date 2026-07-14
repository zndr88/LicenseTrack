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
      overlayClassName="overlay discard-dialog-overlay"
      modalClassName="discard-dialog"
    >
      <div className="discard-dialog-title">Discard unsaved changes?</div>
      <div className="discard-dialog-copy">
        Your edits will be lost if you close without saving.
      </div>
      <div className="discard-dialog-actions">
        <button className="btn btn-g" onClick={onKeep}>
          Keep editing
        </button>
        <button className="btn discard-dialog-confirm" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </ModalShell>
  );
}
