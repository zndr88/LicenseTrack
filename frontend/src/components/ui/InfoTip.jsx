import Icon from "./Icon.jsx";
import Tooltip from "./Tooltip.jsx";

/** A small ⓘ that explains the thing next to it. `label` names it for screen readers. */
export default function InfoTip({ label, children }) {
  return (
    <Tooltip content={children}>
      <button type="button" className="info-tip" aria-label={label}>
        <Icon name="info" size={12} />
      </button>
    </Tooltip>
  );
}
