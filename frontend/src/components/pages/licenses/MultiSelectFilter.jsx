import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function MultiSelectFilter({ id, options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const ref = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const maxH = Math.min(200, spaceBelow > 120 ? spaceBelow - 8 : rect.top - 8);
    const top = spaceBelow > 120 ? rect.bottom + 2 : rect.top - maxH - 2;
    setDropdownStyle({
      position: "fixed",
      top,
      left: rect.left,
      minWidth: rect.width,
      maxHeight: maxH,
      zIndex: 9999,
    });
  }, [open]);

  const label = value.length === 0 ? placeholder : `${value.length} selected`;

  const dropdown = open && (
    <div ref={ref} style={{
      ...dropdownStyle,
      background: "var(--bg-2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--r)",
      padding: "4px 0",
      overflowY: "auto",
      boxShadow: "var(--shadow-sm)",
    }}>
      {options.map((opt) => (
        <label key={opt.value} style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          fontSize: 11,
          fontFamily: "var(--font-ui)",
          color: "var(--text)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}>
          <input
            type="checkbox"
            checked={value.includes(opt.value)}
            onChange={() => {
              if (value.includes(opt.value)) {
                onChange(value.filter((v) => v !== opt.value));
              } else {
                onChange([...value, opt.value]);
              }
            }}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          padding: "3px 7px",
          fontSize: 11,
          fontFamily: "var(--font-ui)",
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r)",
          color: value.length > 0 ? "var(--text)" : "var(--text-3)",
          width: "100%",
          cursor: "pointer",
          textAlign: "left",
          appearance: "none",
          outline: "none",
        }}
      >
        {label}
      </button>
      {createPortal(dropdown, document.body)}
    </div>
  );
}
