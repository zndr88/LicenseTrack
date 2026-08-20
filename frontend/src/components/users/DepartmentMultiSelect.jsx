import React, { useEffect, useRef, useState } from "react";

const DepartmentMultiSelect = ({ available, selected, onChange, disabled, id }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const visibleAvailable = available.filter((dept) => dept.isActive || selected.includes(dept.name));
  const allSelected = visibleAvailable.length > 0 && visibleAvailable.every((dept) => selected.includes(dept.name));

  let triggerLabel;
  let triggerColor;
  if (selected.length === 0) {
    triggerLabel = "No access (no departments selected)";
    triggerColor = "var(--orange-text)";
  } else if (allSelected) {
    triggerLabel = "All departments";
    triggerColor = "var(--text)";
  } else {
    triggerLabel = `${selected.length} department${selected.length === 1 ? "" : "s"} selected`;
    triggerColor = "var(--text)";
  }

  const toggle = (dept) => {
    if (selected.includes(dept.name)) {
      onChange(selected.filter((d) => d !== dept.name));
    } else {
      onChange([...selected, dept.name]);
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        id={id}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "5px 8px",
          fontSize: 12,
          fontFamily: "var(--font-ui)",
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r)",
          color: triggerColor,
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          appearance: "none",
          outline: "none",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 400,
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            padding: "4px 0",
            minWidth: "100%",
            maxHeight: 220,
            overflowY: "auto",
            boxShadow: "var(--shadow-md)",
            marginTop: 2,
          }}
        >
          {/* Select all */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              fontSize: 11,
              fontFamily: "var(--font-ui)",
              color: "var(--text-2)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange(allSelected ? [] : visibleAvailable.map((dept) => dept.name))}
            />
            Select all
          </label>

          {/* Clear all */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              fontSize: 11,
              fontFamily: "var(--font-ui)",
              color: "var(--text-2)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            <input
              type="checkbox"
              checked={selected.length === 0}
              onChange={() => onChange([])}
            />
            Clear all
          </label>

          <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />

          {visibleAvailable.length === 0 ? (
            <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-ui)" }}>
              No departments available
            </div>
          ) : (
            visibleAvailable.map((dept) => (
              <label
                key={dept.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontFamily: "var(--font-ui)",
                  color: "var(--text)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(dept.name)}
                  onChange={() => toggle(dept)}
                />
                {dept.name}{!dept.isActive && " (inactive)"}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default DepartmentMultiSelect;
