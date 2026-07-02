// frontend/src/components/licenses/detail/DetailSectionHeader.jsx
import Icon from "../../ui/Icon.jsx";

export default function DetailSectionHeader({ sectionKey, title, isOpen, onToggle, children }) {
  return (
    <button
      type="button"
      className="dp-section-header"
      onClick={() => onToggle(sectionKey)}
      aria-expanded={isOpen}
      aria-controls={`dp-section-${sectionKey}`}
      onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}
    >
      <span className="dp-section-title">{children ?? title}</span>
      <span style={{ display: "inline-flex", flexShrink: 0, transform: isOpen ? "none" : "rotate(90deg)", transition: "transform 0.15s" }}>
        <Icon name="chevron-down" size={13} color="var(--text-3)" />
      </span>
    </button>
  );
}
