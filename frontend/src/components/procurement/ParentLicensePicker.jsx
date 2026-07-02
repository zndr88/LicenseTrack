import React, { useMemo, useState } from "react";

function isEligibleExistingParent(license) {
  return (
    (license.licenseType === "perpetual" || license.licenseType === "oem" || license.licenseType === "freeware") &&
    !license.isRetired &&
    !license.retired
  );
}

function matchesSearch(option, query) {
  if (!query) return true;
  return option.searchText.includes(query.toLowerCase());
}

function existingLabel(license) {
  const ref = license.licenseRef || `LT-${license.id}`;
  const dates = [license.startDate, license.endDate || "perpetual"].filter(Boolean).join(" -> ");
  return `${ref} - ${license.publisherName} / ${license.softwareDescription}${dates ? ` (${dates})` : ""}`;
}

function poLabel(item, idx) {
  return `PO row ${idx + 1} - ${item.publisherName || "Untitled"} / ${item.softwareDescription || "No description"}`;
}

export default function ParentLicensePicker({
  id,
  licenses = [],
  poItems = [],
  currentIndex = -1,
  watchedItems = [],
  parentLicenseId,
  parentSourcingItemId,
  onSelectExisting,
  onSelectPoItem,
  error,
}) {
  const [query, setQuery] = useState("");
  const selectedValue = parentSourcingItemId
    ? `po:${parentSourcingItemId}`
    : parentLicenseId
    ? `existing:${parentLicenseId}`
    : "";

  const poOptions = useMemo(() => poItems
    .map((item, idx) => ({ item, idx, watched: watchedItems[idx] ?? {} }))
    .filter(({ item, idx, watched }) => (
      idx !== currentIndex &&
      (watched.licenseType === "perpetual" || watched.licenseType === "oem" || watched.licenseType === "freeware") &&
      item.id
    ))
    .map(({ item, idx }) => ({
      value: `po:${item.id}`,
      label: poLabel(item, idx),
      searchText: `${item.publisherName ?? ""} ${item.softwareDescription ?? ""} ${item.id}`.toLowerCase(),
    })), [poItems, watchedItems, currentIndex]);

  const existingOptions = useMemo(() => licenses
    .filter(isEligibleExistingParent)
    .map((license) => ({
      value: `existing:${license.id}`,
      label: existingLabel(license),
      searchText: `${license.id} ${license.licenseRef ?? ""} ${license.publisherName ?? ""} ${license.softwareDescription ?? ""} ${license.contractNumber ?? ""} ${license.poNumber ?? ""}`.toLowerCase(),
    })), [licenses]);

  const filteredPoOptions = poOptions.filter((option) => matchesSearch(option, query));
  const filteredExistingOptions = existingOptions.filter((option) => matchesSearch(option, query));
  const resultCount = filteredPoOptions.length + filteredExistingOptions.length;

  const selectOption = (value) => {
    if (value.startsWith("po:")) {
      onSelectPoItem(value.slice(3));
    } else {
      onSelectExisting(value.slice(9));
    }
  };

  const renderOption = (option) => (
    <button
      key={option.value}
      type="button"
      role="option"
      aria-selected={selectedValue === option.value}
      className="fi"
      style={{
        width: "100%",
        height: "auto",
        minHeight: 34,
        padding: "7px 10px",
        textAlign: "left",
        borderColor: selectedValue === option.value ? "var(--accent)" : "transparent",
        background: selectedValue === option.value ? "var(--accent-m)" : "transparent",
        color: "var(--text)",
        borderRadius: 4,
        whiteSpace: "normal",
        lineHeight: 1.35,
      }}
      onClick={() => selectOption(option.value)}
    >
      {option.label}
    </button>
  );

  return (
    <div className="fg">
      <label htmlFor={id}>Parent License <span style={{ color: "var(--red)" }}>*</span></label>
      <input
        id={id}
        className="fi"
        placeholder="Search by LT-id, publisher, product, contract, or PO"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div
        role="listbox"
        aria-label="Parent license results"
        style={{
          marginTop: 6,
          maxHeight: 220,
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: "var(--r)",
          background: "var(--bg)",
          padding: 4,
        }}
      >
        {resultCount === 0 && (
          <div style={{ padding: "10px 8px", color: "var(--text-3)", fontSize: 12 }}>
            No eligible parent licenses found.
          </div>
        )}
        {filteredPoOptions.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ padding: "5px 8px", color: "var(--text-3)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0 }}>
              This PO
            </div>
            {filteredPoOptions.map(renderOption)}
          </div>
        )}
        {filteredExistingOptions.length > 0 && (
          <div>
            <div style={{ padding: "5px 8px", color: "var(--text-3)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0 }}>
              Existing licenses
            </div>
            {filteredExistingOptions.map(renderOption)}
          </div>
        )}
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-3)" }}>
        {resultCount} eligible parent {resultCount === 1 ? "license" : "licenses"}
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
