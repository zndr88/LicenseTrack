import React from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import Icon from "./Icon.jsx";

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
  overlayStyle,
  modalClassName = "modal",
  modalStyle,
}) {
  const { modalRef, onKeyDown } = useFocusTrap(true);
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

  return (
    <div className="overlay" onClick={handleOverlayClick} style={overlayStyle}>
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
        ))}
        {children}
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
    </div>
  );
}
