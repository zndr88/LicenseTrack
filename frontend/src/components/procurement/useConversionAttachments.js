import { useCallback, useRef, useState } from "react";
import { isProcurementDocumentCategory } from "../../utils/documentCategories.js";

export function useConversionAttachments(defaultTargetSourcingItemId = null) {
  const [attachments, setAttachments] = useState([]);
  const nextId = useRef(1);

  const addFiles = useCallback((category, files) => {
    if (!files.length) return;
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: `conversion-document-${nextId.current++}`,
        file,
        category,
        ...(!isProcurementDocumentCategory(category) && defaultTargetSourcingItemId != null
          ? { targetSourcingItemId: Number(defaultTargetSourcingItemId) }
          : {}),
      })),
    ]);
  }, [defaultTargetSourcingItemId]);

  const removeAttachment = useCallback((id) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const changeTarget = useCallback((id, targetSourcingItemId) => {
    setAttachments((current) => current.map((attachment) => (
      attachment.id === id ? { ...attachment, targetSourcingItemId } : attachment
    )));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  return { attachments, addFiles, removeAttachment, changeTarget, clearAttachments };
}
