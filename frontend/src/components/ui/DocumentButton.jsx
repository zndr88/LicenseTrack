import React from "react";
import Icon from "./Icon.jsx";

/**
 * Standard document download button - a compact grey pill with a download icon
 * and the ellipsized file name. This is the shared look and feel for every
 * downloadable document across the app; render it instead of hand-rolling
 * per-page variants so they never drift apart.
 *
 * Props:
 *   document     - object exposing `originalFilename` or `original_filename`.
 *   onDownload   - callback invoked with the document when clicked.
 *   labelPrefix  - optional short prefix shown before the filename.
 */
export default function DocumentButton({ document, onDownload, labelPrefix = "" }) {
  const filename = document.originalFilename ?? document.original_filename;
  return (
    <button
      type="button"
      className="btn btn-g document-button"
      title={`Download ${filename}`}
      onClick={(event) => {
        event.stopPropagation();
        onDownload(document);
      }}
    >
      <Icon name="download" size={11} />
      <span className="document-button-label">
        {labelPrefix}{filename}
      </span>
    </button>
  );
}
