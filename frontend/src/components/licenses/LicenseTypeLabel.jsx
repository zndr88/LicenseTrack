import InfoTip from "../ui/InfoTip.jsx";

// The one explanation of Maintenance vs Service (also stated in Help).
export const LICENSE_TYPE_HELP = [
  "Maintenance: updates and vendor support for a license you own.",
  "Service: consulting, training, implementation, standalone support contracts.",
];

/** The License Type label with its ⓘ. Used by every license-type picker. */
export default function LicenseTypeLabel({ htmlFor, optional = false }) {
  return (
    <div className="fg-label-row">
      <label htmlFor={htmlFor}>
        License Type{optional && <> <span className="optional-label">(optional)</span></>}
      </label>
      <InfoTip label="What Maintenance and Service mean">
        {LICENSE_TYPE_HELP.map((line) => <div key={line}>{line}</div>)}
      </InfoTip>
    </div>
  );
}
