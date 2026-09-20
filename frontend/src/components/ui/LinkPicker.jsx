import { useMemo, useState } from "react";

// Shared picker for linking one record to another (or several) in a succession
// chain. Each context supplies its own eligibility (the `candidates` list) and
// its own relationship check; the presentation and interaction are unified here
// so that sourcing term links and existing-license successor links look and
// behave the same.
//
// A candidate is a normalized option:
//   { id, title, subtitle?, meta?, searchText?, disabled?, disabledReason? }
//
// `relationship(candidate)` may return { tone: "ok" | "warning", text } and is
// rendered under a candidate once it is selected.
export default function LinkPicker({
  candidates,
  multiple = false,
  selectedIds = [],
  onChange,
  searchable = true,
  searchPlaceholder = "Search",
  emptyMessage = "No eligible records were found.",
  listLabel = "Eligible records",
  relationship,
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((candidate) => {
      const haystack = candidate.searchText
        ?? `${candidate.title ?? ""} ${candidate.subtitle ?? ""} ${candidate.meta ?? ""}`;
      return haystack.toLowerCase().includes(needle);
    });
  }, [candidates, query]);

  const choose = (candidate) => {
    if (candidate.disabled || disabled) return;
    const key = String(candidate.id);
    if (multiple) {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onChange(candidates.filter((item) => next.has(String(item.id))).map((item) => item.id));
    } else {
      onChange(selected.has(key) ? [] : [candidate.id]);
    }
  };

  return (
    <div className="link-picker">
      {searchable && (
        <input
          className="fi"
          type="search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div
        role="listbox"
        aria-label={listLabel}
        aria-multiselectable={multiple || undefined}
        className="link-picker-list"
      >
        {filtered.map((candidate) => {
          const isSelected = selected.has(String(candidate.id));
          const rel = isSelected && relationship ? relationship(candidate) : null;
          return (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={candidate.disabled || disabled}
              className={`link-picker-option${isSelected ? " is-selected" : ""}${candidate.disabled ? " is-disabled" : ""}`}
              onClick={() => choose(candidate)}
            >
              <span
                className={`link-picker-mark${multiple ? " is-multi" : ""}`}
                aria-hidden="true"
              />
              <span className="link-picker-option-body">
                <span className="link-picker-option-main">
                  <strong>{candidate.title}</strong>
                  {candidate.subtitle && <span>{candidate.subtitle}</span>}
                </span>
                {candidate.meta && <span className="link-picker-option-meta">{candidate.meta}</span>}
                {candidate.disabled && candidate.disabledReason && (
                  <span className="link-picker-option-note">{candidate.disabledReason}</span>
                )}
                {rel && <span className={`link-picker-relationship is-${rel.tone}`}>{rel.text}</span>}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && <div className="link-picker-empty">{emptyMessage}</div>}
      </div>
    </div>
  );
}
