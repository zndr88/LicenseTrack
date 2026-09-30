import InfoTip from "./InfoTip.jsx";

/**
 * A form label with an optional ⓘ. `info` is background explanation only;
 * anything that prevents a mistake stays visible under the field.
 * `children` should be plain text when `info` is set (it names the ⓘ), or pass
 * `infoLabel` to name the ⓘ explicitly.
 */
export default function FieldLabel({ htmlFor, info, infoLabel, as = "label", className, children }) {
  // as="span" is for a heading that isn't tied to one input
  // (High-Value Thresholds, Supplier Contact in License Details).
  const text = as === "span"
    ? <span className={className ?? "fg-label"}>{children}</span>
    : <label htmlFor={htmlFor} className={className}>{children}</label>;
  if (!info) return text;
  const name = infoLabel ?? `About ${typeof children === "string" ? children : "this field"}`;
  return (
    <div className="fg-label-row">
      {text}
      <InfoTip label={name}>{info}</InfoTip>
    </div>
  );
}
