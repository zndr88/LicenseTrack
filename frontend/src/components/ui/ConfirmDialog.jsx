import React from "react";
import Icon from "./Icon.jsx";
import ModalShell from "./ModalShell.jsx";

const ConfirmDialog = ({ title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }) => {
  return (
    <ModalShell
      title={title || "Confirm"}
      titleId="dialog-title-confirm"
      onClose={onCancel}
      overlayStyle={{ zIndex: 300 }}
      modalStyle={{ width: 400, maxWidth: "92vw" }}
      footer={(
        <>
          <button className="btn btn-g" onClick={onCancel}>{cancelLabel || "Cancel"}</button>
          <button className={`btn ${danger ? "btn-d" : "btn-p"}`} onClick={onConfirm}>
            {confirmLabel || "Confirm"}
          </button>
        </>
      )}
    >
      <div className="modal-bd" style={{ paddingBottom: 8 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: danger ? "var(--red-m)" : "var(--orange-m)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="alert" size={20} color={danger ? "var(--red)" : "var(--orange)"} />
          </div>
          <div>
            <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{message}</p>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

export default ConfirmDialog;
