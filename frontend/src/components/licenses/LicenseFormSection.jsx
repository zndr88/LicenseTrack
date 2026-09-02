import { useId, useState } from "react";
import Icon from "../ui/Icon.jsx";

export default function LicenseFormSection({
  title,
  icon,
  children,
  className = "",
  defaultOpen = true,
}) {
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const classes = ["license-form-section", className].filter(Boolean).join(" ");

  return (
    <section className={classes} aria-labelledby={titleId}>
      <button
        type="button"
        className="license-form-section-header"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="license-form-section-title">
          {icon && <Icon name={icon} size={14} color="var(--text-2)" />}
          <span id={titleId}>{title}</span>
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color="var(--text-3)" />
      </button>
      {open && <div id={bodyId} className="license-form-section-body">{children}</div>}
    </section>
  );
}
