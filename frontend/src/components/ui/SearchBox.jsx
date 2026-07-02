import React from "react";

/**
 * Shared search box matching the License Overview toolbar search.
 * Plain input (no leading icon) with an inline clear (✕) button that
 * appears once there is text. Styling lives in `.search-input*` classes.
 */
export default function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
  ariaLabel = "Search",
}) {
  return (
    <div className="search-input-wrap">
      <input
        className="search-input"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingRight: value ? 28 : undefined }}
      />
      {value && (
        <button
          type="button"
          className="search-input-clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          ✕
        </button>
      )}
    </div>
  );
}
