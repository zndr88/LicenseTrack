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
      overlayClassName="overlay email-tpl-overlay"
      modalClassName="modal email-tpl-modal"
      footer={(
        <>
          <button type="button" className="btn btn-g set-form-button" onClick={requestClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-p set-form-button"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </>
      )}
    >
      <div className="modal-bd">
        <div>
          <p className="email-tpl-section-title">Budget Owner Alert</p>
          <hr className="email-tpl-divider" />

          <div className="fg email-tpl-field">
            <label htmlFor="email-tpl-budget-intro" className="email-tpl-label">Intro paragraph</label>
            <textarea
              id="email-tpl-budget-intro"
              className="fi email-tpl-textarea"
              rows={4}
              value={draft.emailTemplateBudgetOwnerIntro}
              onChange={(e) => onChange(d => ({ ...d, emailTemplateBudgetOwnerIntro: e.target.value }))}
            />
          </div>

          <div className="fg email-tpl-field-last">
            <label htmlFor="email-tpl-budget-signoff" className="email-tpl-label">Sign-off</label>
            <textarea
              id="email-tpl-budget-signoff"
              className="fi email-tpl-textarea"
              rows={3}
              value={draft.emailTemplateBudgetOwnerSignoff}
              onChange={(e) => onChange(d => ({ ...d, emailTemplateBudgetOwnerSignoff: e.target.value }))}
            />
          </div>
        </div>

        <hr className="email-tpl-section-divider" />

        <div>
          <p className="email-tpl-section-title">Manager Digest</p>
          <hr className="email-tpl-divider" />

          <div className="fg email-tpl-field-last">
            <label htmlFor="email-tpl-manager-intro" className="email-tpl-label">Intro line</label>
            <textarea
              id="email-tpl-manager-intro"
              className="fi email-tpl-textarea"
              rows={2}
              value={draft.emailTemplateManagerIntro}
              onChange={(e) => onChange(d => ({ ...d, emailTemplateManagerIntro: e.target.value }))}
            />
            <p className="email-tpl-hint">
              Use <code className="email-tpl-code">{"{total}"}</code> to insert the notification count.
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
