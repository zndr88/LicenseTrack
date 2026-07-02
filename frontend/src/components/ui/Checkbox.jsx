import React from "react";
import Icon from "./Icon.jsx";

const Checkbox = ({ checked, onChange, label }) => (
  <button
    role="checkbox"
    aria-checked={checked}
    type="button"
    className="cb-row"
    onClick={() => onChange(!checked)}
    onKeyDown={(e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onChange(!checked);
      }
    }}
  >
    <div className={`cb-box ${checked ? "on" : ""}`}>{checked && <Icon name="check" size={12} color="white" />}</div>
    <span>{label}</span>
  </button>
);

export default React.memo(Checkbox);
