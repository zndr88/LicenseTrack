import { useState } from "react";
import Icon from "../../ui/Icon.jsx";
import ModalShell from "../../ui/ModalShell.jsx";
import { buildMultiLicenseEmailHref, buildSingleLicenseEmailHref } from "../../../utils/licenseEmailLinks.js";

const normaliseEmailScopeValue = (value) => (value ?? "").trim().toLowerCase();

function getSamePublisherPoLicenses(license, allLicenses) {
  const poNumber = normaliseEmailScopeValue(license.poNumber);
  const publisherName = normaliseEmailScopeValue(license.publisherName);
  if (!poNumber || !publisherName) return [license];

  const matches = (allLicenses || []).filter((candidate) =>
    normaliseEmailScopeValue(candidate.poNumber) === poNumber &&
    normaliseEmailScopeValue(candidate.publisherName) === publisherName
  );

  return matches.length > 0 ? matches : [license];
}

function EmailPublisherScopeDialog({ license, matchingLicenses, singleHref, allHref, onClose }) {
  return (
    <ModalShell
      title="Email Publisher"
      titleId="dialog-title-email-publisher"
      onClose={onClose}
      overlayStyle={{ zIndex: 300 }}
      modalStyle={{ width: 460, maxWidth: "92vw" }}
      footer={(
        <>
          <button className="btn btn-g" onClick={onClose}>Cancel</button>
          <a href={singleHref} className="btn btn-g" onClick={onClose}>This License Only</a>
          <a href={allHref} className="btn btn-p" onClick={onClose}>All Matching Licenses</a>
        </>
      )}
    >
      <div className="modal-bd" style={{ paddingBottom: 8 }}>
        <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, margin: 0 }}>
          This PO has {matchingLicenses.length} license lines for {license.publisherName}. Send an email about all matching lines in this purchase order, or only the selected license line?
        </p>
      </div>
    </ModalShell>
  );
}

export default function EmailPublisherAction({ license, allLicenses }) {
  const [emailScopePrompt, setEmailScopePrompt] = useState(false);
  const publisherPoLicenses = getSamePublisherPoLicenses(license, allLicenses);
  const singlePublisherEmailHref = buildSingleLicenseEmailHref(license);
  const allPublisherEmailHref = buildMultiLicenseEmailHref(license, publisherPoLicenses);
  const hasPublisherPoChoice = publisherPoLicenses.length > 1;

  return (
    <>
      <a
        href={singlePublisherEmailHref}
        className="btn btn-p dp-email-btn"
        onClick={(event) => {
          if (!hasPublisherPoChoice) return;
          event.preventDefault();
          setEmailScopePrompt(true);
        }}
      >
        <Icon name="mail" size={14} />Email Publisher
      </a>
      {emailScopePrompt && (
        <EmailPublisherScopeDialog
          license={license}
          matchingLicenses={publisherPoLicenses}
          singleHref={singlePublisherEmailHref}
          allHref={allPublisherEmailHref}
          onClose={() => setEmailScopePrompt(false)}
        />
      )}
    </>
  );
}
