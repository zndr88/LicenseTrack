import React from "react";
import Icon from "./Icon.jsx";
import ModalShell from "./ModalShell.jsx";

const ConfirmDialog = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <ModalShell
      title={title || "Confirm"}
      titleId="dialog-title-confirm"
      onClose={onCancel}
      overlayClassName="overlay confirm-dialog-overlay"
      modalClassName="modal confirm-dialog-modal"
      footer={(
        <>
          <button className="btn btn-g" onClick={onCancel}>{cancelLabel || "Cancel"}</button>
          <button className={`btn ${danger ? "btn-d" : "btn-p"}`} onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel || "Confirm"}
          </button>
        </>
      )}
    >
      <div className="modal-bd confirm-dialog-body">
        <div className="confirm-dialog-content">
          <div className={`confirm-dialog-icon ${danger ? "danger" : "warning"}`}>
            <Icon name="alert" size={20} color={danger ? "var(--red)" : "var(--orange)"} />
          </div>
          <div>
            <div className="confirm-dialog-message">{message}</div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

export default ConfirmDialog;
