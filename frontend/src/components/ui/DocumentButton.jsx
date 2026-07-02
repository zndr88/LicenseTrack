import React from "react";
import Icon from "./Icon.jsx";

/**
 * Standard document download button — a compact grey pill with a download icon
 * and the (ellipsised) file name. This is the shared look and feel for every
 * downloadable document across the app (purchase orders, quotes, etc.); render
 * it instead of hand-rolling per-page variants so they never drift apart.
 *
 * Props:
 *   document     — object exposing `originalFilename` (camelCase) or
 *                  `original_filename` (snake_case).
 *   onDownload   — callback invoked with the document when the button is clicked.
 *   labelPrefix  — optional short prefix shown before the filename (e.g. "Quote: ").
 */
export default function DocumentButton({ document, onDownload, labelPrefix = "" }) {
  const filename = document.originalFilename ?? document.original_filename;
  return (
    <button
      type="button"
      className="btn btn-g"
      title={`Download ${filename}`}
      style={{
        maxWidth: 190,
        padding: "3px 7px",
        fontSize: 11,
        justifyContent: "flex-start",
      }}
      onClick={(event) => {
        event.stopPropagation();
        onDownload(document);
      }}
    >
      <Icon name="download" size={11} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {labelPrefix}{filename}
      </span>
    </button>
  );
}
