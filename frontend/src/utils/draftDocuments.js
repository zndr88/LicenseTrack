export function draftDocumentTargetMap(keys, items) {
  return Object.fromEntries((keys ?? []).map((key, index) => [String(key), items?.[index]?.id]));
}

export async function uploadDraftDocuments({ parentId, attachments = [], targetIdsByKey = {}, upload }) {
  const errors = [];
  for (const attachment of attachments) {
    const targetSourcingItemId = attachment.scope === "license"
      ? targetIdsByKey[String(attachment.targetKey)]
      : undefined;
    if (attachment.scope === "license" && targetSourcingItemId == null) {
      errors.push(`${attachment.file.name}: the selected line item is no longer available`);
      continue;
    }
    try {
      const { error } = await upload(parentId, attachment.file, {
        category: attachment.category,
        scope: attachment.scope,
        ...(targetSourcingItemId != null ? { targetSourcingItemId } : {}),
      });
      if (error) errors.push(`${attachment.file.name}: ${error}`);
    } catch (error) {
      errors.push(`${attachment.file.name}: ${error.message || "Upload failed"}`);
    }
  }
  return { errors };
}
