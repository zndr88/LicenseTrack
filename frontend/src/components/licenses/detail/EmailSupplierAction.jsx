import { useState } from "react";
import Icon from "../../ui/Icon.jsx";
import ModalShell from "../../ui/ModalShell.jsx";
import { buildMultiLicenseEmailHref, buildSingleLicenseEmailHref } from "../../../utils/licenseEmailLinks.js";
import { normalizeProcurementPoNumber } from "../../../utils/procurementIdentity.js";

const normaliseEmailScopeValue = (value) => (value ?? "").trim().toLowerCase();

// The purchase a line belongs to: its pending order, else its manual batch,
// else its normalized PO number (ID-1/ID-2, without the currency split).
function purchaseKey(license) {
  if (license?.pendingOrderId != null) return `pending-order:${license.pendingOrderId}`;
  if (license?.procurementBundleId) return `procurement-bundle:${license.procurementBundleId}`;
  const po = normalizeProcurementPoNumber(license?.poNumber);
  return po ? `po:${po}` : null;
}

function getSamePurchaseLicenses(license, allLicenses) {
  const key = purchaseKey(license);
  const publisher = normaliseEmailScopeValue(license.publisherName);
  const supplier = normaliseEmailScopeValue(license.supplier);
  if (!key || !publisher) return [license];

  const matches = (allLicenses || []).filter((candidate) =>
    purchaseKey(candidate) === key
    && normaliseEmailScopeValue(candidate.publisherName) === publisher
    && normaliseEmailScopeValue(candidate.supplier) === supplier
  );
  return matches.length > 0 ? matches : [license];
}

function EmailSupplierScopeDialog({ license, matchingLicenses, singleHref, allHref, onClose }) {
  return (
    <ModalShell
      title="Email Supplier"
      titleId="dialog-title-email-supplier"
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

export default function EmailSupplierAction({ license, allLicenses }) {
  const [emailScopePrompt, setEmailScopePrompt] = useState(false);
  const publisherPoLicenses = getSamePurchaseLicenses(license, allLicenses);
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
        <Icon name="mail" size={14} />Email Supplier
      </a>
      {emailScopePrompt && (
        <EmailSupplierScopeDialog
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
