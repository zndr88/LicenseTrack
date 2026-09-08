import ModalShell from "../../ui/ModalShell.jsx";

export default function PoDocumentWarning({ warning, onClose }) {
  if (!warning) return null;
  return (
    <ModalShell
      title="Verify attached documents"
      titleId="po-document-warning-title"
      onClose={onClose}
      overlayClassName="overlay confirm-dialog-overlay"
      modalClassName="modal confirm-dialog-modal"
      footer={<button className="btn btn-p" onClick={onClose}>Understood</button>}
    >
      <div className="modal-bd confirm-dialog-body">
        The PO number changed from "{warning.oldPoNumber || "None"}" to "{warning.newPoNumber || "None"}".
        This license has attached documents. Verify that the documents shown are correct for the updated PO number.
        Shared document visibility may change. No documents were moved, deleted, or reassigned.
      </div>
    </ModalShell>
  );
}
