import { getLineAmount } from "../../utils/lineAmount.js";
import { formatCost } from "../../utils/helpers.js";

/** Read-only Line Total for line forms: always quantity x unit price. */
export default function CalculatedLineTotal({ id, quantity, unitPrice, currency, locale }) {
  const amount = getLineAmount({ quantity, unitPrice });
  return (
    <div className="fg">
      <span className="fg-label" id={`${id}-label`}>Line Total</span>
      <div className="mono" role="group" aria-labelledby={`${id}-label`}>
        {formatCost(amount, currency, locale)}
      </div>
    </div>
  );
}
