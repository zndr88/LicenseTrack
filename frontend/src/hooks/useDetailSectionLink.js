import { useCallback, useEffect } from "react";
import { detailSectionFromHash, hashForDetailSection, pathMatchesLicense } from "../utils/appRoutes.js";

// The demo build keeps in-memory navigation only (see useUrlSync).
const LINKS_ENABLED = import.meta.env.VITE_DEMO_MODE !== "true";

function scrollToSection(section) {
  window.setTimeout(() => {
    document.querySelector(`[aria-controls="dp-section-${section}"]`)
      ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, 0);
}

/**
 * Link License Details sections to the URL hash, e.g. /licenses/20#documents.
 *
 * A hash opens its section when the license is opened from a link, on
 * Back/Forward, and when the hash is edited in the address bar. Opening a
 * section writes its hash and closing it removes it; both replace the current
 * history entry so section toggles do not add Back steps. The hash is only read
 * or written while the address points at this license.
 */
export function useDetailSectionLink({ license, setOpenSections, enabled = LINKS_ENABLED }) {
  const licenseId = license?.id;
  const licenseRef = license?.licenseRef;
  const licenseRefAliases = license?.licenseRefAliases;

  useEffect(() => {
    if (!enabled || licenseId == null) return undefined;
    const target = { id: licenseId, licenseRef, licenseRefAliases };
    const applyHash = () => {
      if (!pathMatchesLicense(window.location.pathname, target)) return;
      const section = detailSectionFromHash(window.location.hash);
      if (!section) return;
      setOpenSections((prev) => (prev[section] ? prev : { ...prev, [section]: true }));
      scrollToSection(section);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    window.addEventListener("popstate", applyHash);
    return () => {
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener("popstate", applyHash);
    };
  }, [enabled, licenseId, licenseRef, licenseRefAliases, setOpenSections]);

  return useCallback((section, isOpen) => {
    if (!enabled || licenseId == null) return;
    if (!pathMatchesLicense(window.location.pathname, { id: licenseId, licenseRef, licenseRefAliases })) return;
    const hash = hashForDetailSection(section);
    if (!hash) return;
    const base = window.location.pathname + window.location.search;
    if (isOpen && window.location.hash !== hash) {
      window.history.replaceState(window.history.state, "", base + hash);
    } else if (!isOpen && window.location.hash === hash) {
      window.history.replaceState(window.history.state, "", base);
    }
  }, [enabled, licenseId, licenseRef, licenseRefAliases]);
}
