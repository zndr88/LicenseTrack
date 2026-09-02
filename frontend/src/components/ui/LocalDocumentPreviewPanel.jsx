import { useEffect, useState } from "react";
import { useLocalDocumentPreview } from "../../hooks/useLocalDocumentPreview.js";
import DocumentPreviewPanel from "./DocumentPreviewPanel.jsx";

export default function LocalDocumentPreviewPanel({
  ariaLabel,
  file,
  label,
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = useLocalDocumentPreview(file);

  useEffect(() => {
    setExpanded(false);
  }, [file]);

  if (!file) return null;

  return (
    <DocumentPreviewPanel
      ariaLabel={ariaLabel}
      className="document-assisted-preview"
      expanded={expanded}
      filename={file.name}
      kind={preview.kind}
      label={label}
      loading={(preview.kind === "pdf" || preview.kind === "image") && !preview.url}
      onToggleExpanded={() => setExpanded((value) => !value)}
      text={preview.text}
      url={preview.url}
    />
  );
}
