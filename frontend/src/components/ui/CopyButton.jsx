import Icon from "./Icon.jsx";
import { copyText } from "../../utils/copyText.js";

/**
 * Small icon button that copies `value` to the clipboard and reports the result
 * through `onNotify(message, type)`. Renders nothing for an empty value.
 * `label` names what is copied ("PO number"); it is used for the accessible
 * name and the messages.
 */
export default function CopyButton({ value, label, onNotify, copiedMessage, className = "dp-field-edit-icon dp-copy-icon", children }) {
  if (value == null || value === "") return null;
  const handleCopy = async () => {
    const capitalised = label.charAt(0).toUpperCase() + label.slice(1);
    if (await copyText(value)) onNotify?.(copiedMessage ?? `${capitalised} copied`);
    else onNotify?.(`Could not copy the ${label}. Select the text and copy it by hand.`, "error");
  };
  return (
    <button type="button" className={className} aria-label={children ? undefined : `Copy ${label}`} title={children ? undefined : `Copy ${label}`} onClick={handleCopy}>
      {children ?? <Icon name="copy" size={11} />}
    </button>
  );
}
