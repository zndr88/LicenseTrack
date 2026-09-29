import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The one tooltip. Wraps a single DOM element (button, span, …) and shows
 * `content` on hover and on keyboard focus; Escape closes it. The bubble is
 * rendered in document.body so modals and table cells don't clip it.
 * Desktop only: no touch handling (LicenseTrack has no mobile support).
 * The child must be a DOM element without its own ref.
 */
export default function Tooltip({ content, children, placement = "top" }) {
  const id = useId();
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPosition({
      left: rect.left + rect.width / 2,
      top: placement === "top" ? rect.top : rect.bottom,
    });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (content == null || content === "") return children;

  const chain = (name, next) => (event) => {
    children.props[name]?.(event);
    next();
  };
  const describedBy = [children.props["aria-describedby"], open ? id : null].filter(Boolean).join(" ");

  return (
    <>
      {cloneElement(children, {
        ref: anchorRef,
        "aria-describedby": describedBy || undefined,
        onMouseEnter: chain("onMouseEnter", () => setOpen(true)),
        onMouseLeave: chain("onMouseLeave", () => setOpen(false)),
        onFocus: chain("onFocus", () => setOpen(true)),
        onBlur: chain("onBlur", () => setOpen(false)),
      })}
      {open && createPortal(
        <div
          role="tooltip"
          id={id}
          className={`tip tip--${placement}`}
          style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
