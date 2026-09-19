import React, { useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import Icon from "./Icon.jsx";
import { ModalSectionExpansionContext } from "./ModalSectionExpansionContext.js";

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

  const handleKeyDown = (event) => {
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape(event);
      return;
    }
    onKeyDown(event);
  };

  const setAllSections = (open) => setSectionCommand((current) => ({ sequence: current.sequence + 1, open }));

  return (
    <div className={overlayClassName} onClick={handleOverlayClick} style={overlayStyle}>
      <div
        className={modalClassName}
        ref={modalRef}
        onKeyDown={handleKeyDown}
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
