import { useEffect, useId, useRef, useState } from "react";
import { useNumberFormatSettings } from "./NumberFormatContext.js";
import { numberFormatExample, parseTypedNumberResult, toInputText } from "../../utils/formatting.js";

export { isValidNumberValue } from "../../utils/formatting.js";

const DEFAULT_SETTINGS = { numberFormatLocale: "en-US" };

function errorMessage(error, text, settings) {
  if (error === "ambiguous") {
    const digits = text.replace(/[^\d-]/g, "");
    const asDecimal = toInputText(text.replace(/[^\d.-]/g, ""), settings);
    return `"${text.trim()}" is ambiguous in your number format. Type ${digits} for a whole number, or ${asDecimal} for a decimal.`;
  }
  return `Not a valid number in your number format (for example ${numberFormatExample(settings)}).`;
}

/**
 * The one input for numbers people type (prices, quantities, totals, costs).
 *
 * - Shows `value` (a stored, canonical number such as "1234.5") in the
 *   user's number format, and keeps exactly what the user types.
 * - Reads the typed text once, with the same rules as the server.
 * - Calls onChange with the canonical value ("" when blank). When the text
 *   isn't a valid number, it calls onChange with the typed text unchanged and
 *   shows a message; the value is never cleared or rewritten. The server
 *   rejects non-canonical numbers, so invalid text can't be stored.
 * - `invalid` marks the field for the form's own rules (for example "must be
 *   greater than zero"); describe those with `describedBy`.
 */
export default function NumberInput({
  value,
  onChange,
  settings: settingsProp,
  minFractionDigits = 0,
  className = "fi",
  onBlur,
  describedBy,
  invalid = false,
  ...inputProps
}) {
  const contextSettings = useNumberFormatSettings();
  const settings = settingsProp ?? contextSettings ?? DEFAULT_SETTINGS;
  const [text, setText] = useState(() => toInputText(value ?? "", settings, { minFractionDigits }));
  const [error, setError] = useState(null);
  const [showError, setShowError] = useState(false);
  const lastEmitted = useRef(value ?? "");
  const messageId = useId();

  // A new value from outside (reset, auto-calculated total, reload) replaces the text.
  useEffect(() => {
    const incoming = value ?? "";
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    setText(toInputText(incoming, settings, { minFractionDigits }));
    setError(null);
    setShowError(false);
  }, [value, settings, minFractionDigits]);

  const handleChange = (event) => {
    const typed = event.target.value;
    setText(typed);
    const result = parseTypedNumberResult(typed, settings);
    const next = result.error ? typed : (result.value ?? "");
    setError(result.error);
    if (!result.error) setShowError(false);
    lastEmitted.current = next;
    onChange?.(next);
  };

  const handleBlur = (event) => {
    if (error) {
      setShowError(true);
    } else if (lastEmitted.current !== "") {
      setText(toInputText(lastEmitted.current, settings, { minFractionDigits }));
    }
    onBlur?.(event);
  };

  const message = error && showError ? errorMessage(error, text, settings) : null;
  const described = [describedBy, message ? messageId : null].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <input
        {...inputProps}
        className={className}
        inputMode="decimal"
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        aria-invalid={message || invalid ? true : undefined}
        aria-describedby={described}
        data-number-input=""
      />
      {message && <span id={messageId} className="field-error" role="alert">{message}</span>}
    </>
  );
}
