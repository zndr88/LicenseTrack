import ConfirmDialog from "../../ui/ConfirmDialog.jsx";

export default function LicenseBulkActions({
  showBulkDeleteConfirm,
  setShowBulkDeleteConfirm,
  selectedIds,
  handleBulkDelete,
}) {
  if (!showBulkDeleteConfirm) return null;
  return (
    <ConfirmDialog
      title="Delete Licenses"
      message={`Delete ${selectedIds.size} license(s)? This cannot be undone.`}
      confirmLabel="Delete"
      danger
      onConfirm={handleBulkDelete}
      onCancel={() => setShowBulkDeleteConfirm(false)}
    />
  );
}
