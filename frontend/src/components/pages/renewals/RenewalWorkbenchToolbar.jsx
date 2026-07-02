import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../ui/Icon.jsx";
import { getVisibleWorkbenchColumns } from "./workbenchColumns.js";

export default function RenewalWorkbenchToolbar({
  search,
  onSearchChange,
  optionalColumns,
  savedColumnVisibility,
  onToggleColumn,
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({});
  const columnsBtnRef = useRef(null);
  const columnsMenuRef = useRef(null);

  useEffect(() => {
    if (!columnsOpen) return;
    if (columnsBtnRef.current) {
      const r = columnsBtnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    const handleMouseDown = (event) => {
      if (
        columnsBtnRef.current && !columnsBtnRef.current.contains(event.target) &&
        columnsMenuRef.current && !columnsMenuRef.current.contains(event.target)
      ) {
        setColumnsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [columnsOpen]);

  return (
    <div className="tbl-bar lp-toolbar-bar">
      <div className="lp-row1-left">
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search renewals"
          aria-label="Search renewal workbench"
        />
      </div>

      <div className="lp-row1-right">
        <button
          ref={columnsBtnRef}
          type="button"
          className="chip rw-column-btn"
          aria-haspopup="listbox"
          aria-expanded={columnsOpen}
          title="Choose workbench columns"
          onClick={() => setColumnsOpen((open) => !open)}
        >
          <Icon name="columns" size={14} />
          Columns
        </button>
        {columnsOpen && createPortal(
          <div ref={columnsMenuRef} className="rw-column-menu" role="listbox" aria-label="Renewal workbench columns"
            style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
          >
            <div className="rw-column-menu-title">Built-in</div>
            {optionalColumns.filter((column) => !column.isCustom).map((column) => {
              const checked = getVisibleWorkbenchColumns([column], savedColumnVisibility).length > 0;
              return (
                <label key={column.id} className="rw-column-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleColumn(column.id)}
                  />
                  {column.label}
                </label>
              );
            })}
            {optionalColumns.some((column) => column.isCustom) && (
              <>
                <div className="rw-column-menu-title">Custom Fields</div>
                {optionalColumns.filter((column) => column.isCustom).map((column) => {
                  const checked = getVisibleWorkbenchColumns([column], savedColumnVisibility).length > 0;
                  return (
                    <label key={column.id} className="rw-column-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleColumn(column.id)}
                      />
                      {column.label}
                    </label>
                  );
                })}
              </>
            )}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
