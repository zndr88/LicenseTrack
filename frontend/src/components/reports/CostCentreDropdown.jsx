import React, { useEffect, useRef, useState } from "react";
import Icon from "../ui/Icon.jsx";

export default function CostCentreDropdown({ costCentres, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef(null);
  const listboxRef = useRef(null);

  useEffect(() => {
    if (open) { setFocusedIndex(-1); listboxRef.current?.focus(); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  function toggle(val) {
    if (selected.includes(val)) {
      onChange(selected.filter((v) => v !== val));
    } else {
      onChange([...selected, val]);
    }
  }

  let label;
  if (selected.length === 0) label = "All departments";
  else if (selected.length === 1) label = selected[0];
  else label = `${selected.length} departments selected`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: open ? "var(--bg-hover)" : undefined }}
      >
        <Icon name="filter" size={12} />
        <span>{label}</span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={11} />
      </button>

      {open && (
        <div
          ref={listboxRef}
          role="listbox"
          tabIndex={0}
          aria-multiselectable="true"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
            background: "var(--bg-2)", border: "1px solid var(--border)",
            borderRadius: "var(--r)", padding: "4px 0", minWidth: 200,
            boxShadow: "var(--shadow-md)", outline: "none",
          }}
          onKeyDown={(e) => {
            const total = 1 + costCentres.length;
            if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIndex((i) => Math.min(i + 1, total - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (focusedIndex === 0) { onChange([]); setOpen(false); }
              else if (focusedIndex > 0) { toggle(costCentres[focusedIndex - 1]); }
            }
            else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          }}
        >
          <div
            role="option"
            aria-selected={selected.length === 0}
            onClick={() => { onChange([]); setOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "7px 12px",
              cursor: "pointer", fontSize: 13, fontWeight: 500,
              background: focusedIndex === 0 ? "var(--bg-hover)" : undefined,
            }}
            onMouseEnter={(e) => { setFocusedIndex(0); e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = focusedIndex === 0 ? "var(--bg-hover)" : "transparent"; }}
          >
            <Icon name="check" size={13} color={selected.length === 0 ? "var(--accent)" : "transparent"} />
            All departments
          </div>
          {costCentres.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
          )}
          {costCentres.map((cc, idx) => {
            const checked = selected.includes(cc);
            const isFocused = focusedIndex === idx + 1;
            return (
              <div
                key={cc}
                role="option"
                aria-selected={checked}
                onClick={() => toggle(cc)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 12px",
                  cursor: "pointer", fontSize: 13,
                  background: isFocused ? "var(--bg-hover)" : undefined,
                }}
                onMouseEnter={(e) => { setFocusedIndex(idx + 1); e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isFocused ? "var(--bg-hover)" : "transparent"; }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-lt)"}`,
                  background: checked ? "var(--accent)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {checked && <Icon name="check" size={10} color="white" />}
                </div>
                {cc}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
