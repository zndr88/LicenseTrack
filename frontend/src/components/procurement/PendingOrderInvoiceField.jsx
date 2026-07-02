export default function PendingOrderInvoiceField({ invoiceFile, onChange }) {
  return (
    <div className="fg">
      <label htmlFor="cpo-invoice-file">Invoice Document</label>
      <input
        id="cpo-invoice-file"
        type="file"
        className="fi"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {invoiceFile && (
        <div style={{ marginTop: 5, fontSize: 11, color: "var(--text-2)" }}>
          {invoiceFile.name}
        </div>
      )}
    </div>
  );
}
