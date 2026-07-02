import React from "react";

const Toggle = ({ value, onChange, ariaLabel }) => (
  <button
    role="switch"
    aria-checked={value}
    aria-label={ariaLabel}
    type="button"
    className={`toggle ${value ? "on" : ""}`}
    onClick={() => onChange(!value)}
    onKeyDown={(e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onChange(!value);
      }
    }}
  >
    <div className="toggle-k" />
  </button>
);

export default React.memo(Toggle);
