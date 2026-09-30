import { useContext, useEffect, useId, useState } from "react";
import Icon from "../ui/Icon.jsx";
import { ModalSectionExpansionContext } from "../ui/ModalSectionExpansionContext.js";

export default function LicenseFormSection({
  title,
  icon,
  children,
  className = "",
  defaultOpen = true,
  command = null,
}) {
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const sectionCommand = useContext(ModalSectionExpansionContext);
  const classes = ["license-form-section", className].filter(Boolean).join(" ");

  useEffect(() => {
    if (sectionCommand?.sequence) setOpen(sectionCommand.open);
  }, [sectionCommand]);

  // A parent can open or close the section with a new { sequence, open } command;
  // the user can still toggle it by hand afterwards.
  useEffect(() => {
    if (command?.sequence) setOpen(command.open);
  }, [command]);

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
