import { formatDateTime } from "../../../utils/formatting.js";
import DetailSectionHeader from "./DetailSectionHeader.jsx";

export default function HistorySection({ license, userSettings, isOpen, onToggle }) {
  const createdBy = license.createdByName
    || license.createdByEmail
    || (license.createdBy ? `User #${license.createdBy}` : "Unknown / legacy record");

  return (
    <>
      <DetailSectionHeader sectionKey="history" title="History" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-history">
          <div className="fr dp-data-row">
            <div className="dp-field">
              <label>Created By</label>
              <div className="val">{createdBy}</div>
            </div>
          </div>
          <div className="fr dp-data-row">
            <div className="dp-field">
              <label>Created</label>
              <div className="val mono">{license.createdAt ? formatDateTime(license.createdAt, userSettings) : "\u2014"}</div>
            </div>
            <div className="dp-field">
              <label>Last Updated</label>
              <div className="val mono">{license.updatedAt ? formatDateTime(license.updatedAt, userSettings) : "\u2014"}</div>
            </div>
          </div>
        </div>
      )}
      <div className="dp-section-divider" />
    </>
  );
}
