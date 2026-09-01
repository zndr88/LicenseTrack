import { useEffect, useState } from "react";
import { localDocumentPreviewKind } from "../utils/documentPreview.js";

export function useLocalDocumentPreview(file) {
  const kind = localDocumentPreviewKind(file);
  const [url, setUrl] = useState(null);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!file || !kind || kind === "text") {
      setUrl(null);
      return undefined;
    }

    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file, kind]);

  useEffect(() => {
    let current = true;
    setText("");
    if (file && kind === "text") {
      file.text().then((value) => {
        if (current) setText(value);
      });
    }
    return () => { current = false; };
  }, [file, kind]);

  return { kind, url, text };
}
