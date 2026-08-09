import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";

export default function RowActionsMenu({ items = [], label = "More actions" }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const visibleItems = items.filter((item) => !item.hidden);

  function updateMenuPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const menuWidth = 180;
    const panelHeight = panelRef.current?.offsetHeight ?? 0;
    const viewportPadding = 8;
    const left = Math.min(
      window.innerWidth - menuWidth - viewportPadding,
      Math.max(viewportPadding, rect.right - menuWidth),
    );
    let top = rect.bottom + 6;
    if (panelHeight && top + panelHeight > window.innerHeight - viewportPadding) {
      top = Math.max(viewportPadding, rect.top - panelHeight - 6);
    }
    setMenuStyle({ left, top, minWidth: menuWidth });
  }

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      const target = event.target;
      if (
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    function handleViewportChange() {
      updateMenuPosition();
    }

    updateMenuPosition();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  if (!visibleItems.length) return null;

  const menu = open && typeof document !== "undefined"
    ? createPortal(
      <div
        className="row-actions-menu"
        role="menu"
        ref={panelRef}
        style={menuStyle ?? undefined}
      >
        {visibleItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`row-actions-item${item.danger ? " danger" : ""}${item.separatorBefore ? " separated" : ""}`}
            role="menuitem"
            disabled={item.disabled}
            title={item.title}
            onClick={(event) => {
              event.stopPropagation();
              if (item.disabled) return;
              setOpen(false);
              item.onClick?.(event);
            }}
          >
            {item.icon && <Icon name={item.icon} size={14} />}
            <span>{item.label}</span>
          </button>
        ))}
      </div>,
      document.body,
    )
    : null;

  return (
    <div
      className="row-actions-menu-wrap"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-g row-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => {
          if (!open) updateMenuPosition();
          setOpen((value) => !value);
        }}
      >
        <span className="row-actions-kebab" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      {menu}
    </div>
  );
}
