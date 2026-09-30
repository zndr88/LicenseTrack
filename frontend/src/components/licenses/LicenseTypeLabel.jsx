import FieldLabel from "../ui/FieldLabel.jsx";

// The one explanation of Maintenance vs Service (also stated in Help).
export const LICENSE_TYPE_HELP = [
  "Maintenance: updates and vendor support for a license you own.",
  "Service: consulting, training, implementation, standalone support contracts.",
];

/** The License Type label with its ⓘ. Used by every license-type picker. */
export default function LicenseTypeLabel({ htmlFor, optional = false }) {
  return (
    <FieldLabel
      htmlFor={htmlFor}
      infoLabel="What Maintenance and Service mean"
      info={LICENSE_TYPE_HELP.map((line) => <div key={line}>{line}</div>)}
    >
      License Type{optional && <> <span className="optional-label">(optional)</span></>}
    </FieldLabel>
  );
}
