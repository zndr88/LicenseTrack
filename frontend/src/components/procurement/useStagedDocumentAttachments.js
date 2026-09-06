import { useCallback, useRef, useState } from "react";
import { DOCUMENT_CATEGORIES, defaultDocumentScope } from "../../utils/documentCategories.js";

function initialCategoryScopes() {
  return Object.fromEntries(
    DOCUMENT_CATEGORIES.map((category) => [category.key, category.defaultScope]),
  );
}

export function useStagedDocumentAttachments(defaultTargetKey = null) {
  const [attachments, setAttachments] = useState([]);
  const [categoryScopes, setCategoryScopes] = useState(initialCategoryScopes);
  const nextId = useRef(1);

  const addFiles = useCallback((category, files) => {
    if (!files.length) return;
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: `conversion-document-${nextId.current++}`,
        file,
        category,
        scope: categoryScopes[category] ?? defaultDocumentScope(category),
        ...((categoryScopes[category] ?? defaultDocumentScope(category)) === "license" && defaultTargetKey != null
          ? { targetKey: String(defaultTargetKey) }
          : {}),
      })),
    ]);
  }, [categoryScopes, defaultTargetKey]);

  const removeAttachment = useCallback((id) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const changeTarget = useCallback((id, targetKey) => {
    setAttachments((current) => current.map((attachment) => (
      attachment.id === id ? { ...attachment, targetKey: String(targetKey) } : attachment
    )));
  }, []);

  const changeCategoryScope = useCallback((category, scope) => {
    setCategoryScopes((current) => ({ ...current, [category]: scope }));
    setAttachments((current) => current.map((attachment) => {
      if (attachment.category !== category) return attachment;
      if (scope === "shared") {
        const nextAttachment = { ...attachment, scope };
        delete nextAttachment.targetKey;
        return nextAttachment;
      }
      return {
        ...attachment,
        scope,
        ...(attachment.targetKey == null && defaultTargetKey != null
          ? { targetKey: String(defaultTargetKey) }
          : {}),
      };
    }));
  }, [defaultTargetKey]);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  return {
    attachments,
    categoryScopes,
    addFiles,
    removeAttachment,
    changeTarget,
    changeCategoryScope,
    clearAttachments,
  };
}
