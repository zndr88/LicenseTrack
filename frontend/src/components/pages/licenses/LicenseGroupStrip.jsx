import { useState } from "react";
import Icon from "../../ui/Icon.jsx";
import { COLUMN_DEFS } from "./licenseColumns.js";
import { GROUPABLE_COLUMNS, MAX_GROUP_LEVELS, getGroupableColumn, groupingKeyForColumn } from "./registryGrouping.js";

function columnLabel(columnKey) {
  return COLUMN_DEFS.find((column) => column.key === columnKey)?.label || "This column";
}

export default function LicenseGroupStrip({ groupBy, onChange, onExpandAll, onCollapseAll }) {
  const [notice, setNotice] = useState("");
  const add = (key) => {
    if (!key || groupBy.includes(key)) return;
    if (groupBy.length >= MAX_GROUP_LEVELS) {
      setNotice(`Up to ${MAX_GROUP_LEVELS} grouping levels`);
      return;
    }
    setNotice("");
    onChange([...groupBy, key]);
  };
  const remaining = GROUPABLE_COLUMNS.filter((column) => !groupBy.includes(column.key));

  return (
    <section
      className="lp-group-strip"
      aria-label="Grouping"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const columnKey = event.dataTransfer.getData("colKey");
        const key = groupingKeyForColumn(columnKey);
        if (key) add(key);
        else if (columnKey) setNotice(`${columnLabel(columnKey)} can't be used for grouping`);
      }}
    >
      {groupBy.length === 0 ? (
        <span className="lp-group-hint">Drag a column header here to group by that column</span>
      ) : (
        groupBy.map((key, index) => (
          <span key={key} className="lp-group-chip">
            {index > 0 && <Icon name="chevron-right" size={12} />}
            {getGroupableColumn(key).label}
            <button
              type="button"
              className="lp-group-chip-remove"
              aria-label={`Remove grouping by ${getGroupableColumn(key).label}`}
              onClick={() => { setNotice(""); onChange(groupBy.filter((k) => k !== key)); }}
            >
              <Icon name="x" size={11} />
            </button>
          </span>
        ))
      )}
      {groupBy.length === 2 && (
        <button type="button" className="toolbar-btn" aria-label="Swap grouping levels" onClick={() => onChange([groupBy[1], groupBy[0]])}>
          <Icon name="refresh" size={13} />
        </button>
      )}
      {notice && <span className="lp-group-notice" role="status">{notice}</span>}
      <span className="lp-group-actions">
        {groupBy.length < MAX_GROUP_LEVELS && (
          <select
            className="fi fi-select lp-group-picker"
            aria-label="Add grouping"
            value=""
            onChange={(event) => add(event.target.value)}
          >
            <option value="">+ Add grouping</option>
            {remaining.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
        )}
        {groupBy.length > 0 && (
          <>
            <button type="button" className="btn btn-g lp-compact-action" onClick={onExpandAll}>Expand all</button>
            <button type="button" className="btn btn-g lp-compact-action" onClick={onCollapseAll}>Collapse all</button>
          </>
        )}
      </span>
    </section>
  );
}
