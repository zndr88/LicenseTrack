import { useState } from "react";
import ModalShell from "../ui/ModalShell.jsx";
import DiscardChangesDialog from "../ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";
import { draftDocumentTargetMap, uploadDraftDocuments } from "../../utils/draftDocuments.js";
import DocumentStagingWorkspace from "./DocumentStagingWorkspace.jsx";
import { useStagedDocumentAttachments } from "./useStagedDocumentAttachments.js";

export default function WorkflowDocumentsModal({
  title, parentId, items = [], documents = [], upload, previewDocument,
  downloadDocument, onDeleteDocument, onChanged, onClose, userSettings,
}) {
  const readOnly = !upload;
  const {
    attachments, categoryScopes, addFiles, removeAttachment, changeTarget,
    changeCategoryScope, clearAttachments,
  } = useStagedDocumentAttachments(items[0]?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({
    isDirty: attachments.length > 0,
    onClose,
  });

  const saveDocuments = async () => {
    setSaving(true);
    setError(null);
    const { errors } = await uploadDraftDocuments({
      parentId,
      attachments,
      targetIdsByKey: draftDocumentTargetMap(items.map((item) => String(item.id)), items),
      upload,
    });
    if (errors.length) {
      setError(errors.join("; "));
      clearAttachments();
      await onChanged?.();
      setSaving(false);
      return;
    }
    await onChanged?.();
    onClose();
  };

  return <>
    <ModalShell
      title={title}
      sectionControls
      titleId="dialog-title-workflow-documents"
      onClose={requestClose}
      modalClassName="modal document-assisted-modal procurement-document-modal"
      modalStyle={{ width: "min(760px, 94vw)", maxWidth: "min(760px, 94vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
      footer={<>
        <button type="button" className="btn btn-g" onClick={requestClose} disabled={saving}>Close</button>
        {!readOnly && <button type="button" className="btn btn-p" onClick={saveDocuments} disabled={saving || !attachments.length}>
          {saving ? "Uploading..." : "Upload documents"}
        </button>}
      </>}
    >
      {error && <p className="field-error" role="alert">{error}</p>}
        <DocumentStagingWorkspace
          attachments={attachments}
          categoryScopes={categoryScopes}
          documents={documents}
          inputIdPrefix={`workflow-documents-${parentId}`}
          onAddFiles={addFiles}
          onRemoveAttachment={removeAttachment}
          onTargetChange={changeTarget}
          onCategoryScopeChange={changeCategoryScope}
          previewDocument={previewDocument}
          downloadDocument={downloadDocument}
          onDeleteDocument={onDeleteDocument}
          targetOptions={items.map((item, index) => ({ value: String(item.id), label: item.softwareDescription || `Line ${index + 1}` }))}
          userSettings={userSettings}
          defaultOpen
          readOnly={readOnly}
        />
    </ModalShell>
    {showDiscardDialog && <DiscardChangesDialog
      onDiscard={() => { clearAttachments(); onClose(); }}
      onKeep={() => setShowDiscardDialog(false)}
    />}
  </>;
}
