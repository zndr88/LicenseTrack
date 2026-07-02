import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Manages focus for modal dialogs:
 * - Saves the element that triggered the modal open
 * - Moves focus inside the modal on open
 * - Traps Tab/Shift+Tab within the modal
 * - Restores focus to the trigger element on close (or unmount)
 *
 * Works for both:
 *   (a) Always-mounted modals with an isOpen boolean
 *   (b) Conditionally rendered modals — pass isOpen=true
 *
 * Usage:
 *   const { modalRef, onKeyDown } = useFocusTrap(isOpen);
 *   <div ref={modalRef} onKeyDown={onKeyDown} ...>
 */
export function useFocusTrap(isOpen) {
  const modalRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Capture the element focused before the modal opened
    triggerRef.current = document.activeElement;

    // Move focus to the first focusable child
    const frameId = requestAnimationFrame(() => {
      if (!modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll(FOCUSABLE_SELECTORS);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    });

    // Cleanup: runs when isOpen becomes false OR when component unmounts.
    // Either way, restore focus to whatever triggered the modal.
    return () => {
      cancelAnimationFrame(frameId);
      const trigger = triggerRef.current;
      if (trigger && typeof trigger.focus === "function") {
        trigger.focus();
        triggerRef.current = null;
      }
    };
  }, [isOpen]);

  // Tab / Shift+Tab trap
  function onKeyDown(e) {
    if (e.key !== "Tab") return;
    if (!modalRef.current) return;

    const focusable = Array.from(
      modalRef.current.querySelectorAll(FOCUSABLE_SELECTORS)
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return { modalRef, onKeyDown };
}
