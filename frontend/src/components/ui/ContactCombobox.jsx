import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { searchContactReferences } from "../../api/referenceData.js";
import { queryKeys } from "../../queryKeys.js";

const MIN_SEARCH_LENGTH = 2;
const DEBOUNCE_MS = 220;

function cleanSearch(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

/** Free-text email input with suggestions derived from saved license contacts. */
const ContactCombobox = forwardRef(function ContactCombobox({
  id,
  value = "",
  onChange,
  onBlur,
  className = "fi",
  disabled = false,
  multiple = false,
  ...inputProps
}, forwardedRef) {
  const generatedId = useId();
  const inputId = id || `contact-combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputValue = String(value || "");
  const tokenStart = multiple ? inputValue.lastIndexOf(",") + 1 : 0;
  const cleanedValue = cleanSearch(inputValue.slice(tokenStart));
  const canSearch = cleanedValue.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    setDebouncedSearch("");
    setActiveIndex(-1);
    if (!isOpen || !canSearch) return undefined;
    const timer = window.setTimeout(() => setDebouncedSearch(cleanedValue), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [canSearch, cleanedValue, isOpen]);

  const { data: contacts = [], error, isFetching } = useQuery({
    queryKey: queryKeys.contactReferenceSearch(debouncedSearch),
    queryFn: async () => {
      const result = await searchContactReferences(debouncedSearch);
      if (result.error) throw new Error(result.error);
      return result.data || [];
    },
    enabled: isOpen && debouncedSearch.length >= MIN_SEARCH_LENGTH,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickAway = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickAway);
    return () => document.removeEventListener("mousedown", handleClickAway);
  }, [isOpen]);

  const searchIsCurrent = cleanSearch(debouncedSearch).toLowerCase() === cleanedValue.toLowerCase();
  const options = searchIsCurrent ? contacts : [];
  const activeOption = activeIndex >= 0 ? options[activeIndex] : null;

  useEffect(() => {
    if (activeIndex >= options.length) setActiveIndex(-1);
  }, [activeIndex, options.length]);

  const choose = (contact) => {
    const prefix = multiple && tokenStart > 0 ? `${inputValue.slice(0, tokenStart).trimEnd()} ` : "";
    onChange(`${prefix}${contact.email}`);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => (options.length ? Math.min(index + 1, options.length - 1) : -1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => (options.length ? (index < 0 ? options.length - 1 : Math.max(index - 1, 0)) : -1));
    } else if (event.key === "Enter" && isOpen && activeOption) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setActiveIndex(-1);
    }
    if (!event.defaultPrevented) inputProps.onKeyDown?.(event);
  };

  const waitingForSearch = canSearch && (!searchIsCurrent || isFetching);

  return (
    <div className="reference-combobox" ref={rootRef}>
      <input
        {...inputProps}
        ref={forwardedRef}
        id={inputId}
        className={className}
        type="email"
        multiple={multiple || undefined}
        value={inputValue}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={activeOption ? `${listId}-option-${activeIndex}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={(event) => {
          setIsOpen(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget)) setIsOpen(false);
          onBlur?.(event);
        }}
        onKeyDown={handleKeyDown}
      />
      {isOpen && canSearch && (
        <div className="reference-combobox-menu" id={listId} role="listbox">
          {waitingForSearch && <div className="reference-combobox-status" role="status">Searching...</div>}
          {!waitingForSearch && error && (
            <div className="reference-combobox-status reference-combobox-error" role="alert">
              {error instanceof Error ? error.message : "Unable to search contacts"}
            </div>
          )}
          {!waitingForSearch && !error && options.map((contact, index) => (
            <button
              type="button"
              key={contact.email.toLowerCase()}
              id={`${listId}-option-${index}`}
              className={`reference-combobox-option${index === activeIndex ? " is-active" : ""}`}
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(contact)}
            >
              <span>{contact.email}</span>
            </button>
          ))}
          {!waitingForSearch && !error && options.length === 0 && (
            <div className="reference-combobox-status">No matching contact found.</div>
          )}
        </div>
      )}
    </div>
  );
});

export default ContactCombobox;
