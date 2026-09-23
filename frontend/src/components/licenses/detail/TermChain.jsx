import { formatDate } from "../../../utils/formatting.js";
import { useState } from "react";
import Icon from "../../ui/Icon.jsx";

function connectedTerms(currentId, allLicenses) {
  const byId = new Map(allLicenses.map((license) => [license.id, license]));
  const neighbors = new Map(allLicenses.map((license) => [license.id, new Set()]));
  for (const license of allLicenses) {
    const predecessors = license.cotermFromIds?.length ? license.cotermFromIds : [license.renewedFromId].filter(Boolean);
    for (const predecessorId of predecessors) {
      if (!byId.has(predecessorId)) continue;
      neighbors.get(license.id)?.add(predecessorId);
      neighbors.get(predecessorId)?.add(license.id);
    }
  }
  const visited = new Set();
  const pending = [currentId];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id) || !byId.has(id)) continue;
    visited.add(id);
    for (const neighbor of neighbors.get(id) ?? []) pending.push(neighbor);
  }
  return [...visited].map((id) => byId.get(id)).sort((left, right) =>
    (left.startDate ?? "").localeCompare(right.startDate ?? "") || left.id - right.id,
  );
}

/**
 * Collapsed sub-section of History, shown only when the chain has two or more
 * terms. It includes already-bought future terms, not just past ones.
 */
export default function TermChain({ license, allLicenses, userSettings, onNavigate }) {
  const [isOpen, setIsOpen] = useState(false);
  const terms = connectedTerms(license.id, allLicenses);
  if (terms.length < 2) return null;
  return (
    <div className="dp-subsection">
      <button
        type="button"
        className="dp-subsection-toggle"
        aria-expanded={isOpen}
        aria-controls="dp-term-chain"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} />
        Term chain ({terms.length} terms)
      </button>
      {isOpen && (
        <section className="term-chain" id="dp-term-chain" aria-label="License term chain">
          <div className="term-chain-list">
            {terms.map((term) => (
              <button
                key={term.id}
                type="button"
                className={`term-chain-item${term.id === license.id ? " current" : ""}`}
                onClick={() => term.id !== license.id && onNavigate(term.id)}
                aria-current={term.id === license.id ? "true" : undefined}
              >
                <span className="term-chain-main">
                  <strong>{term.softwareDescription}</strong>
                  <span>{term.startDate ? formatDate(term.startDate, userSettings) : "No start date"} – {term.endDate ? formatDate(term.endDate, userSettings) : "No end date"}</span>
                </span>
                <span className="term-chain-meta">
                  <span>{term.expirationStatus || "Term"}</span>
                  <span>Qty {term.quantity || "—"}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
