import ConfirmDialog from "../../ui/ConfirmDialog.jsx";

export default function LicenseBulkActions({
  showBulkDeleteConfirm,
  setShowBulkDeleteConfirm,
  selectedIds,
  licenses,
  handleBulkDelete,
}) {
  if (!showBulkDeleteConfirm) return null;
  const selected = licenses.filter((license) => selectedIds.has(license.id));
  const visibleLabels = selected.slice(0, 5).map((license) =>
    license.licenseRef || `${license.publisherName} ${license.softwareDescription}`.trim()
  );
  const remaining = selected.length - visibleLabels.length;
  return (
    <ConfirmDialog
      title="Delete Licenses"
      message={(
        <>
          <div>Delete {selected.length} license(s)? This cannot be undone.</div>
          {visibleLabels.length > 0 && (
            <div style={{ marginTop: 8, color: "var(--text-2)" }}>
              {visibleLabels.join(", ")}{remaining > 0 ? `, and ${remaining} more` : ""}
            </div>
          )}
        </>
      )}
      confirmLabel="Delete"
      danger
      onConfirm={handleBulkDelete}
      onCancel={() => setShowBulkDeleteConfirm(false)}
    />
  );
}
