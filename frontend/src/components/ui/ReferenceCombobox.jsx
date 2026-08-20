import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  cleanReferenceDisplay,
  normalizeReferenceSearch,
  searchReferenceData,
} from "../../api/referenceData.js";
import { queryKeys } from "../../queryKeys.js";

const MIN_SEARCH_LENGTH = 2;
const DEBOUNCE_MS = 220;

function displayAlias(item, value) {
  const normalized = normalizeReferenceSearch(value);
  const alias = (item.aliases || []).find(
    (candidate) => normalizeReferenceSearch(candidate.name) === normalized,
  );
  return alias ? `Alias: ${alias.name}` : null;
}

function keyboardOptionId(listId, option) {
  return option.type === "create"
    ? `${listId}-create`
    : `${listId}-reference-${option.item.id}`;
}

/** Accessible, controlled reference-data input used by non-RHF and RHF forms. */
const ReferenceCombobox = forwardRef(function ReferenceCombobox({
  id,
  mode,
  value = "",
  onChange,
  onBlur,
  placeholder,
  className = "fi",
  disabled = false,
  autoFocus = false,
  style,
  onKeyDown: externalKeyDown,
  onFocus: externalFocus,
  ...inputProps
}, forwardedRef) {
  const generatedId = useId();
  const inputId = id || `reference-combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputValue = String(value || "");
  const cleanedValue = cleanReferenceDisplay(inputValue);
  const normalizedSearch = normalizeReferenceSearch(inputValue);
  const canSearch = cleanedValue.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    setDebouncedSearch("");
    setActiveIndex(-1);
    if (!isOpen || !canSearch) return undefined;
    const timer = window.setTimeout(() => setDebouncedSearch(cleanedValue), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [canSearch, cleanedValue, isOpen, mode]);

  const {
    data: options = [],
    error: queryError,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.referenceDataSearch(mode, debouncedSearch),
    queryFn: async () => {
      const result = await searchReferenceData(mode, debouncedSearch);
      if (result.error) throw new Error(result.error);
      return result.data || [];
    },
    enabled: isOpen && debouncedSearch.length >= MIN_SEARCH_LENGTH,
    staleTime: 0,
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

  const searchIsCurrent = debouncedSearch.length >= MIN_SEARCH_LENGTH
    && normalizeReferenceSearch(debouncedSearch) === normalizedSearch;
  const visibleOptions = searchIsCurrent ? options : [];
  const exactReferenceMatch = visibleOptions.some((item) => (
    [item.name, ...(item.aliases || []).map((alias) => alias.name)]
      .some((candidate) => normalizeReferenceSearch(candidate) === normalizedSearch)
  ));
  const showCreate = searchIsCurrent && !isFetching && !queryError && !exactReferenceMatch;
  const keyboardOptions = [
    ...visibleOptions.filter((item) => item.isActive).map((item) => ({ type: "reference", item })),
    ...(showCreate ? [{ type: "create", value: cleanedValue }] : []),
  ];
  const activeOption = activeIndex >= 0 ? keyboardOptions[activeIndex] : null;

  useEffect(() => {
    if (activeIndex >= keyboardOptions.length) setActiveIndex(-1);
  }, [activeIndex, keyboardOptions.length]);

  const choose = (option) => {
    if (!option) return;
    onChange(option.type === "create" ? option.value : option.item.name);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => (
        keyboardOptions.length ? Math.min(index + 1, keyboardOptions.length - 1) : -1
      ));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => {
        if (!keyboardOptions.length) return -1;
        return index < 0 ? keyboardOptions.length - 1 : Math.max(index - 1, 0);
      });
    } else if (event.key === "Enter" && isOpen && activeOption) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setActiveIndex(-1);
    }
    if (!event.defaultPrevented) externalKeyDown?.(event);
  };

  const handleBlur = (event) => {
    if (!rootRef.current?.contains(event.relatedTarget)) {
      setIsOpen(false);
      setActiveIndex(-1);
    }
    onBlur?.(event);
  };

  const waitingForSearch = canSearch && (!searchIsCurrent || isFetching);
  const errorMessage = queryError instanceof Error ? queryError.message : null;

  return (
    <div className="reference-combobox" ref={rootRef} style={style}>
      <input
        {...inputProps}
        ref={forwardedRef}
        id={inputId}
        className={className}
        value={inputValue}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={activeOption ? keyboardOptionId(listId, activeOption) : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={(event) => {
          setIsOpen(true);
          externalFocus?.(event);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {isOpen && (
        <div className="reference-combobox-menu" id={listId} role="listbox">
          {!canSearch && (
            <div className="reference-combobox-status">
              Type at least {MIN_SEARCH_LENGTH} characters to search.
            </div>
          )}
          {waitingForSearch && (
            <div className="reference-combobox-status" role="status">Searching...</div>
          )}
          {canSearch && !waitingForSearch && errorMessage && (
            <div className="reference-combobox-status reference-combobox-error" role="alert">
              {errorMessage}
            </div>
          )}
          {canSearch && !waitingForSearch && !errorMessage && visibleOptions.map((item) => {
            const inactive = !item.isActive;
            const index = inactive
              ? -1
              : keyboardOptions.findIndex((option) => option.type === "reference" && option.item.id === item.id);
            const option = index >= 0 ? keyboardOptions[index] : null;
            return (
              <button
                type="button"
                key={item.id}
                id={`${listId}-reference-${item.id}`}
                className={`reference-combobox-option${index === activeIndex ? " is-active" : ""}${inactive ? " is-inactive" : ""}`}
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={inactive || undefined}
                disabled={inactive}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{item.name}</span>
                <span className="reference-combobox-meta">
                  {inactive
                    ? "Unavailable"
                    : displayAlias(item, inputValue)
                      || (item.aliases?.length
                        ? `${item.aliases.length} alias${item.aliases.length === 1 ? "" : "es"}`
                        : "")}
                </span>
              </button>
            );
          })}
          {canSearch && !waitingForSearch && !errorMessage && visibleOptions.length === 0 && (
            <div className="reference-combobox-status">No matching reference found.</div>
          )}
          {showCreate && (
            <button
              type="button"
              id={`${listId}-create`}
              className={`reference-combobox-create${activeOption?.type === "create" ? " is-active" : ""}`}
              role="option"
              aria-selected={activeOption?.type === "create"}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose({ type: "create", value: cleanedValue })}
            >
              Create "{cleanedValue}"
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default ReferenceCombobox;
