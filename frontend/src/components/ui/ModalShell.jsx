import React, { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import Icon from "./Icon.jsx";
import { ModalSectionExpansionContext } from "./ModalSectionExpansionContext.js";

// Open dialogs in the order they were opened; the last one is on top.
const openDialogs = [];

/**
 * Escape closes the dialog: it calls `onEscape` when given, otherwise
 * `onClose`. Only the topmost open dialog reacts. Pass `closeOnEscape={false}`
 * to opt out; a disabled close button also switches it off.
 */
export default function ModalShell({
  title,
  titleId,
  ariaLabel,
  header,
  children,
  footer,
  onClose,
  onEscape,
  showCloseButton = true,
  closeButtonAriaLabel = "Close",
  closeButtonDisabled = false,
  closeOnEscape = true,
  closeOnOverlayClick = true,
  overlayClassName = "overlay",
  overlayStyle,
  modalClassName = "modal",
  modalStyle,
  sectionControls = false,
}) {
  const { modalRef, onKeyDown } = useFocusTrap(true);
  const [sectionCommand, setSectionCommand] = useState({ sequence: 0, open: true });
  const labelledBy = title || header ? titleId : undefined;

  const handleOverlayClick = (event) => {
    if (closeOnOverlayClick) {
      onClose?.(event);
      return;
    }
    event.stopPropagation();
  };

  const escapeRef = useRef(null);
  escapeRef.current = closeOnEscape && !closeButtonDisabled ? (onEscape ?? onClose) : null;

  // Listens on the document so Escape also works when focus has left the
  // dialog. A field or menu inside that handles Escape itself goes first.
  useEffect(() => {
    const entry = {};
    openDialogs.push(entry);
    const handleEscape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (openDialogs[openDialogs.length - 1] !== entry) return;
      if (event.target?.closest?.('[role="combobox"][aria-expanded="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      escapeRef.current?.(event);
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      openDialogs.splice(openDialogs.indexOf(entry), 1);
    };
  }, []);

  const setAllSections = (open) => setSectionCommand((current) => ({ sequence: current.sequence + 1, open }));

  return (
    <div className={overlayClassName} onClick={handleOverlayClick} style={overlayStyle}>
      <div
        className={modalClassName}
        ref={modalRef}
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
      >
        {header ?? (title && (
          <div className="modal-hd">
            <h3 id={titleId}>{title}</h3>
            <div className="modal-hd-actions">
              {sectionControls && <div className="modal-section-controls" role="group" aria-label="Section controls">
                <button type="button" onClick={() => setAllSections(true)}>Expand all</button>
                <button type="button" onClick={() => setAllSections(false)}>Collapse all</button>
              </div>}
              {showCloseButton && (
              <button
                className="modal-close"
                aria-label={closeButtonAriaLabel}
                disabled={closeButtonDisabled}
                onClick={onClose}
              >
                <Icon name="x" size={18} />
              </button>
              )}
            </div>
          </div>
        ))}
        <ModalSectionExpansionContext.Provider value={sectionControls ? sectionCommand : null}>
          {children}
        </ModalSectionExpansionContext.Provider>
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
    </div>
  );
}
