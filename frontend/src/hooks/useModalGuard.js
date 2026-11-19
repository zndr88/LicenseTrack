import { useCallback, useState } from "react";

/**
 * Intercepts modal close attempts when isDirty is true.
 * Shows a confirmation dialog before allowing close.
 *
 * Usage:
 *   const { showDiscardDialog, setShowDiscardDialog, requestClose } =
 *     useModalGuard({ isDirty, onClose });
 *
 *   // Use requestClose instead of calling onClose directly, including as the
 *   // ModalShell onClose, which is also what Escape calls.
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

  return { showDiscardDialog, setShowDiscardDialog, requestClose };
}
