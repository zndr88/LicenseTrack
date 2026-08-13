import React, { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../ui/Icon.jsx";

export default function CostCentreDropdown({ costCentres, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef(null);
  const listboxRef = useRef(null);
  const searchRef = useRef(null);

  const filteredCostCentres = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return costCentres;
    return costCentres.filter((costCentre) => costCentre.toLowerCase().includes(needle));
  }, [costCentres, query]);

  useEffect(() => {
    if (!open) return;
    setFocusedIndex(-1);
    setQuery("");
    window.requestAnimationFrame(() => searchRef.current?.focus());
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
    <div ref={ref} className="report-dept-dropdown">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`chip report-dept-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
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
          className="report-dept-menu"
          onKeyDown={(e) => {
            const isTyping = e.target === searchRef.current
              && !["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key);
            if (isTyping) return;

            const total = 1 + filteredCostCentres.length;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setFocusedIndex((i) => Math.min(i + 1, total - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setFocusedIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (focusedIndex === 0) {
                onChange([]);
                setOpen(false);
              } else if (focusedIndex > 0) {
                toggle(filteredCostCentres[focusedIndex - 1]);
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
        >
          <div className="report-dept-search">
            <Icon name="search" size={13} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search departments..."
              aria-label="Search departments"
              onChange={(event) => {
                setQuery(event.target.value);
                setFocusedIndex(-1);
              }}
            />
          </div>
          <div
            role="option"
            aria-selected={selected.length === 0}
            onClick={() => { onChange([]); setOpen(false); }}
            className={`report-dept-option report-dept-all${focusedIndex === 0 ? " focused" : ""}`}
            onMouseEnter={() => setFocusedIndex(0)}
          >
            <Icon name="check" size={13} color={selected.length === 0 ? "var(--accent)" : "transparent"} />
            <span>All departments</span>
          </div>
          {costCentres.length > 0 && (
            <div className="report-dept-divider" />
          )}
          <div className="report-dept-options">
            {filteredCostCentres.length === 0 ? (
              <div className="report-dept-empty">No departments match</div>
            ) : filteredCostCentres.map((cc, idx) => {
              const checked = selected.includes(cc);
              const isFocused = focusedIndex === idx + 1;
              return (
                <div
                  key={cc}
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(cc)}
                  className={`report-dept-option${isFocused ? " focused" : ""}`}
                  onMouseEnter={() => setFocusedIndex(idx + 1)}
                >
                  <div className={`report-dept-check${checked ? " checked" : ""}`}>
                    {checked && <Icon name="check" size={10} color="white" />}
                  </div>
                  <span>{cc}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
