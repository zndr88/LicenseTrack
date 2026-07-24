import { useState } from "react";
import { previewPortfolioReset, resetPortfolio } from "../../../api/settings.js";
import Icon from "../../ui/Icon.jsx";
import ModalShell from "../../ui/ModalShell.jsx";
import { SectionHeader } from "../SectionShared.jsx";

const CONFIRMATION = "RESET PORTFOLIO";

function countLabel(value, singular, plural = `${singular}s`) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function PortfolioResetSection({
  isOpen,
  isDirty,
  onToggle,
  onError,
  onToast,
  onPortfolioReset,
}) {
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);

  const openReview = async () => {
    setLoadingPreview(true);
    const { data, error } = await previewPortfolioReset();
    setLoadingPreview(false);
    if (error) {
      onError(error);
      return;
    }
    setPreview(data);
    setConfirmation("");
  };

  const closeReview = () => {
    if (resetting) return;
    setPreview(null);
    setConfirmation("");
  };

  const handleReset = async () => {
    if (confirmation !== CONFIRMATION) return;
    setResetting(true);
    const { data, error } = await resetPortfolio(confirmation);
    setResetting(false);
    if (error) {
      onError(error);
      return;
    }

    setPreview(null);
    setConfirmation("");
    await onPortfolioReset?.();
    onToast(
      data?.storage_cleanup_failed
        ? `Portfolio reset completed, but some stored files could not be removed. Recovery archive: ${data.archive_filename}`
        : `Portfolio reset completed. Recovery archive: ${data.archive_filename}`,
      data?.storage_cleanup_failed ? "warning" : "success",
    );
  };

  const counts = preview?.counts || {};

  return (
    <>
      <div className="setsec">
        <SectionHeader
          sectionKey="portfolioReset"
          icon="alert"
          title="Reset Portfolio Data"
          description="Start the license portfolio again while keeping users and configuration"
          iconColor="var(--red)"
          isOpen={isOpen}
          isDirty={isDirty}
          onToggle={onToggle}
        />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            <div className="set-section-stack">
              <div className="set-danger-box">
                <p className="set-danger-text">
                  <strong>Destructive action:</strong> Deletes all current and historical licenses,
                  sourcing requests, pending orders, contracts, audit events, and associated documents.
                  Users, settings, import mappings, integrations, extensions, and backup files are kept.
                  A database-and-document recovery archive is created before anything is deleted.
                </p>
              </div>
              <div className="set-form-actions">
                <button
                  type="button"
                  className="btn set-danger-button"
                  disabled={loadingPreview || resetting}
                  onClick={openReview}
                >
                  <Icon name="alert" size={14} />
                  {loadingPreview ? "Reviewing..." : "Review Portfolio Reset"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {preview && (
        <ModalShell
          title="Reset Portfolio Data"
          titleId="portfolio-reset-title"
          onClose={closeReview}
          overlayClassName="overlay"
          modalClassName="modal set-portfolio-reset-modal"
          footer={(
            <>
              <button type="button" className="btn btn-g" disabled={resetting} onClick={closeReview}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-d"
                disabled={confirmation !== CONFIRMATION || resetting}
                onClick={handleReset}
              >
                {resetting ? "Creating Archive & Resetting..." : "Reset Portfolio Data"}
              </button>
            </>
          )}
        >
          <div className="modal-bd set-portfolio-reset-body">
            <p>This reset will permanently remove:</p>
            <ul className="set-portfolio-reset-counts">
              <li>{countLabel(counts.licenses, "license")}, including renewal and maintenance history</li>
              <li>
                {countLabel(counts.sourcing_requests, "sourcing request")} and{" "}
                {countLabel(counts.sourcing_items, "sourcing item")}
              </li>
              <li>{countLabel(counts.pending_orders, "pending order")}, including completed and cancelled history</li>
              <li>{countLabel(counts.contracts, "contract")}</li>
              <li>{countLabel(counts.documents, "document record")}</li>
              <li>{countLabel(counts.audit_events, "audit event")}</li>
            </ul>
            <p>
              The next generated license reference will be <strong>{preview.next_license_ref}</strong>.
              Accounts and application configuration will remain unchanged.
            </p>
            <div className="fg">
              <label htmlFor="portfolio-reset-confirmation">
                Type <strong>{CONFIRMATION}</strong> to confirm
              </label>
              <input
                id="portfolio-reset-confirmation"
                className="fi"
                value={confirmation}
                autoComplete="off"
                disabled={resetting}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}
