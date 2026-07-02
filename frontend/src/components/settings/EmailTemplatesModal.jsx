import { useRef } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";

export default function EmailTemplatesModal({ draft, onChange, onSave, onCancel, saving }) {
  const initialDraftRef = useRef(draft);
  const isDirty =
    draft.emailTemplateBudgetOwnerIntro !== initialDraftRef.current.emailTemplateBudgetOwnerIntro ||
    draft.emailTemplateBudgetOwnerSignoff !== initialDraftRef.current.emailTemplateBudgetOwnerSignoff ||
    draft.emailTemplateManagerIntro !== initialDraftRef.current.emailTemplateManagerIntro;
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty, onClose: onCancel });

  return (
    <>
    <ModalShell
      title="Email Templates"
      titleId="dialog-title-email-templates"
      onClose={requestClose}
      closeButtonAriaLabel="Close email templates dialog"
      overlayStyle={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      modalStyle={{
        borderRadius: "var(--r-lg)",
        maxWidth: "min(680px, 92vw)",
        width: "100%",
        maxHeight: "90vh",
      }}
      footer={(
        <>
          <button type="button" className="btn btn-g" onClick={requestClose} style={{ fontSize: 13 }}>Cancel</button>
          <button
            type="button"
            className="btn btn-p"
            onClick={onSave}
            disabled={saving}
            style={{ fontSize: 13 }}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        {/* Budget Owner Alert */}
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>Budget Owner Alert</p>
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0 14px" }} />

          <div className="fg" style={{ marginBottom: 14 }}>
            <label htmlFor="email-tpl-budget-intro" style={{ fontSize: 12 }}>Intro paragraph</label>
            <textarea
              id="email-tpl-budget-intro"
              className="fi"
              rows={4}
              value={draft.emailTemplateBudgetOwnerIntro}
              onChange={(e) => onChange(d => ({ ...d, emailTemplateBudgetOwnerIntro: e.target.value }))}
              style={{ resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 13 }}
            />
          </div>

          <div className="fg" style={{ marginBottom: 4 }}>
            <label htmlFor="email-tpl-budget-signoff" style={{ fontSize: 12 }}>Sign-off</label>
            <textarea
              id="email-tpl-budget-signoff"
              className="fi"
              rows={3}
              value={draft.emailTemplateBudgetOwnerSignoff}
              onChange={(e) => onChange(d => ({ ...d, emailTemplateBudgetOwnerSignoff: e.target.value }))}
              style={{ resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 13 }}
            />
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" }} />

        {/* Manager Digest */}
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>Manager Digest</p>
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0 14px" }} />

          <div className="fg" style={{ marginBottom: 4 }}>
            <label htmlFor="email-tpl-manager-intro" style={{ fontSize: 12 }}>Intro line</label>
            <textarea
              id="email-tpl-manager-intro"
              className="fi"
              rows={2}
              value={draft.emailTemplateManagerIntro}
              onChange={(e) => onChange(d => ({ ...d, emailTemplateManagerIntro: e.target.value }))}
              style={{ resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 13 }}
            />
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
              Use <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{"{total}"}</code> to insert the notification count.
            </p>
          </div>
        </div>
      </div>
    </ModalShell>
    {showDiscardDialog && (
      <DiscardChangesDialog
        onKeep={() => setShowDiscardDialog(false)}
        onDiscard={onCancel}
      />
    )}
    </>
  );
}
