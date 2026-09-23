import Icon from "../ui/Icon.jsx";

export function normaliseInvoiceNumbers(values) {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function toEditableRows(invoiceNumbers, fallbackPrimary) {
  const rows = normaliseInvoiceNumbers(
    Array.isArray(invoiceNumbers) ? invoiceNumbers : []
  );
  if (rows.length === 0 && fallbackPrimary) rows.push(fallbackPrimary);
  return rows.length > 0 ? rows : [""];
}

/**
 * Ordered invoice-number list editor (first row is the primary invoice).
 * Shared by the Invoice Numbers dialog and the full license Edit form so
 * neither can drop additional invoices.
 */
export default function InvoiceNumberRows({ rows, onChange, idPrefix = "invoice-number", onKeyDown, autoFocusEmpty = false }) {
  const setRow = (index, value) => onChange(rows.map((row, idx) => (idx === index ? value : row)));
  const addRow = () => onChange([...rows, ""]);
  const removeRow = (index) => {
    const next = rows.filter((_, idx) => idx !== index);
    onChange(next.length > 0 ? next : [""]);
  };
  const moveRow = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <>
      <div className="invoice-number-rows">
        {rows.map((row, index) => (
          <div className="invoice-number-row" key={index}>
            <div className="fg invoice-number-input">
              <label htmlFor={`${idPrefix}-${index}`}>{index === 0 ? "Primary invoice" : "Additional invoice"}</label>
              <input
                id={`${idPrefix}-${index}`}
                className="fi mono"
                value={row}
                onChange={(event) => setRow(index, event.target.value)}
                onKeyDown={onKeyDown}
                autoFocus={(autoFocusEmpty || rows.length > 1) && index === rows.length - 1 && row === ""}
              />
            </div>
            <div className="invoice-number-actions">
              <button
                type="button"
                className="doc-action-btn"
                aria-label="Move invoice up"
                title="Move up"
                disabled={index === 0}
                onClick={() => moveRow(index, -1)}
              >
                <Icon name="chevron-up" size={14} />
              </button>
              <button
                type="button"
                className="doc-action-btn"
                aria-label="Move invoice down"
                title="Move down"
                disabled={index === rows.length - 1}
                onClick={() => moveRow(index, 1)}
              >
                <Icon name="chevron-down" size={14} />
              </button>
              <button
                type="button"
                className="doc-action-btn remove"
                aria-label="Remove invoice number"
                title="Remove"
                onClick={() => removeRow(index)}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-g btn-sm" onClick={addRow}>
        <Icon name="plus" size={12} /> Add invoice number
      </button>
    </>
  );
}
