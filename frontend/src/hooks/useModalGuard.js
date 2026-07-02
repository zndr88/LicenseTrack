import { useEffect, useCallback, useState } from "react";

/**
 * Intercepts modal close attempts when isDirty is true.
 * Shows a confirmation dialog before allowing close.
 *
 * Usage:
 *   const { showDiscardDialog, setShowDiscardDialog, requestClose } =
 *     useModalGuard({ isDirty, onClose });
 *
 *   // Use requestClose instead of calling onClose directly.
 *   // Render <DiscardChangesDialog> when showDiscardDialog is true.
 */
export function useModalGuard({ isDirty, onClose }) {
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const requestClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardDialog(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  // Intercept Escape key
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [requestClose]);

  return { showDiscardDialog, setShowDiscardDialog, requestClose };
}
