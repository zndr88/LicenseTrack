// The older copy command, for browsers that do not offer the clipboard: it is
// only available on https and localhost, and many installs run on plain http.
function copyWithSelection(text) {
  const previousFocus = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.left = "-9999px";
  document.body.appendChild(field);
  try {
    field.focus();
    field.select();
    return typeof document.execCommand === "function" && document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    field.remove();
    previousFocus?.focus?.();
  }
}

/** Copy text to the clipboard. Resolves to true when it worked, false when it did not. */
export async function copyText(text) {
  const value = String(text ?? "");
  try {
    if (window.navigator.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Refused (permissions, lost focus): try the older way below.
  }
  return copyWithSelection(value);
}
