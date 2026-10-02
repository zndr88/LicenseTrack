import Icon from "../../ui/Icon.jsx";
import Tooltip from "../../ui/Tooltip.jsx";
import { formatCostByCurrency } from "../../../utils/helpers.js";
import { formatDate } from "../../../utils/formatting.js";

const PO_MISMATCH_TEXT = "The manual PO total differs from the sum of this PO's lines.";

// Keeps focus and key presses on the warning from toggling the group row.
const stop = (event) => event.stopPropagation();

function lineCountText({ shownCount, totalCount }) {
  const noun = totalCount === 1 ? "line" : "lines";
  return shownCount === totalCount ? `${totalCount} ${noun}` : `${shownCount} of ${totalCount} ${noun}`;
}

export default function LicenseGroupRow({ node, colSpan, expanded, onToggle, locale, userSettings }) {
  const { summary } = node;
  return (
    <tr className="lp-group-row" data-depth={node.depth} onClick={() => onToggle(node.id)}>
      <td colSpan={colSpan}>
        <div className="lp-group-cell" style={{ paddingLeft: 8 + node.depth * 20 }}>
          <button
            type="button"
            className="lp-group-toggle"
            aria-expanded={expanded}
            onClick={(event) => { event.stopPropagation(); onToggle(node.id); }}
          >
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
            <span className="lp-group-label">{node.columnLabel} · {node.label}</span>
          </button>
          <span className="lp-group-meta">{lineCountText(summary)}</span>
          <span className="lp-group-meta mono">{formatCostByCurrency(summary.lineSumByCurrency, locale)}</span>
          {summary.earliestEndDate && (
            <span className="lp-group-meta">Earliest end {formatDate(summary.earliestEndDate, userSettings)}</span>
          )}
          {summary.poTotalByCurrency && (
            <span className="lp-group-meta mono">
              Total PO Value {formatCostByCurrency(summary.poTotalByCurrency, locale)}
              {summary.poOverrideMismatch && (
                <Tooltip content={PO_MISMATCH_TEXT}>
                  <span
                    className="lp-group-warning"
                    tabIndex={0}
                    role="img"
                    aria-label="PO total mismatch"
                    onClick={stop}
                    onKeyDown={stop}
                  >
                    <Icon name="alert" size={12} color="var(--orange-text)" />
                  </span>
                </Tooltip>
              )}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
