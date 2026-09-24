import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../queryKeys.js";
import { fetchLicensesData } from "../components/pages/licenses/useLicensesPageData.js";
import { getLicensesFromQueryData } from "../utils/licenseQueryData.js";
import { parseAppPath, pathForState, resolveLicenseKey } from "../utils/appRoutes.js";

const POST_LOGIN_PATH_KEY = "licensetrack.postLoginPath";
// The app is served from the site root (Vite's relative asset base does not
// describe the page URL). Sub-path hosting is not supported for deep links.
const APP_BASE_PATH = "/";

function isRootPath(pathname, basePath) {
  return pathname === "/" || pathname === basePath;
}

function takeStoredPath() {
  try {
    const stored = window.sessionStorage.getItem(POST_LOGIN_PATH_KEY);
    window.sessionStorage.removeItem(POST_LOGIN_PATH_KEY);
    return stored;
  } catch {
    return null;
  }
}

/**
 * Remember the requested path, including a License Details section hash, across
 * an SSO round trip, which returns to the site root.
 */
export function rememberPathForLogin(basePath = APP_BASE_PATH) {
  if (isRootPath(window.location.pathname, basePath)) return;
  try {
    window.sessionStorage.setItem(POST_LOGIN_PATH_KEY, window.location.pathname + window.location.hash);
  } catch {
    // Without storage the user lands on the default page after SSO.
  }
}

/**
 * Keep the browser URL in step with the app's page and selected license, and
 * restore both from the URL on load and on Back/Forward. URL-driven page
 * changes use the same guarded navigate function as the sidebar, so
 * unsaved-change prompts also fire on Back.
 */
export function useUrlSync({
  enabled,
  page,
  navigateToPage,
  selectedId,
  selectLicense,
  basePath = APP_BASE_PATH,
}) {
  const [pendingLicenseKey, setPendingLicenseKey] = useState(null);
  const pageRef = useRef(page);
  const selectedIdRef = useRef(selectedId);
  const initializedRef = useRef(false);
  // App state the URL is waiting for after a URL-driven change:
  // { page, licenseId?, awaitingLicense? }. While set, the URL is not pushed.
  const expectedRef = useRef(null);

  // Layout effects so the Back-guard fallback timer always sees committed state.
  useLayoutEffect(() => { pageRef.current = page; }, [page]);
  useLayoutEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const { data: licensesData } = useQuery({
    queryKey: queryKeys.licenses,
    queryFn: fetchLicensesData,
    enabled: Boolean(enabled && pendingLicenseKey),
  });

  // Initial load (after sign-in): apply the requested path.
  useEffect(() => {
    if (!enabled || initializedRef.current) return;
    initializedRef.current = true;
    const storedPath = takeStoredPath();
    const useStored = isRootPath(window.location.pathname, basePath) && storedPath;
    const [requestedPath, storedHash] = useStored
      ? [storedPath.split("#")[0], storedPath.includes("#") ? `#${storedPath.split("#").slice(1).join("#")}` : ""]
      : [window.location.pathname, window.location.hash];
    const target = parseAppPath(requestedPath, basePath);
    // A section hash (#documents) only means something next to a license.
    const hash = target.licenseKey ? storedHash : "";
    if (!target.known || requestedPath !== window.location.pathname || hash !== window.location.hash) {
      window.history.replaceState(window.history.state, "", pathForState(target, basePath) + hash);
    }
    expectedRef.current = { page: target.page, awaitingLicense: Boolean(target.licenseKey) };
    if (target.page !== pageRef.current) navigateToPage(target.page);
    if (target.licenseKey) setPendingLicenseKey(target.licenseKey);
  }, [enabled, basePath, navigateToPage]);

  // Resolve a /licenses/:key once the license list is available.
  useEffect(() => {
    if (!pendingLicenseKey || !licensesData) return;
    const licenseId = resolveLicenseKey(pendingLicenseKey, getLicensesFromQueryData(licensesData));
    setPendingLicenseKey(null);
    if (licenseId == null) {
      expectedRef.current = null;
      window.history.replaceState(window.history.state, "", pathForState({ page: "licenses" }, basePath));
      return;
    }
    if (licenseId === selectedIdRef.current && pageRef.current === "licenses") {
      expectedRef.current = null;
      return;
    }
    expectedRef.current = { page: "licenses", licenseId };
    selectLicense(licenseId);
  }, [pendingLicenseKey, licensesData, selectLicense, basePath]);

  // State -> URL.
  useEffect(() => {
    if (!enabled || !initializedRef.current) return;
    const desired = pathForState({ page, licenseKey: page === "licenses" ? selectedId : null }, basePath);
    const expected = expectedRef.current;
    if (expected) {
      const caughtUp = page === expected.page
        && !expected.awaitingLicense
        && (expected.licenseId === undefined || expected.licenseId === selectedId);
      if (!caughtUp) return;
      expectedRef.current = null;
      // Keep a requested section hash when an LT Ref resolves to its record id.
      const hash = page === "licenses" && selectedId != null ? window.location.hash : "";
      if (window.location.pathname !== desired) window.history.replaceState(window.history.state, "", desired + hash);
      return;
    }
    if (window.location.pathname !== desired) window.history.pushState(window.history.state, "", desired);
  }, [enabled, page, selectedId, basePath]);

  // URL -> state on Back/Forward.
  useEffect(() => {
    if (!enabled) return undefined;
    const currentPath = () => pathForState(
      { page: pageRef.current, licenseKey: pageRef.current === "licenses" ? selectedIdRef.current : null },
      basePath,
    );
    const handlePopState = () => {
      // An open dialog may hold unsaved input; Back leaves the screen as it is,
      // just as the sidebar cannot be used underneath a modal.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        expectedRef.current = null;
        window.history.pushState(window.history.state, "", currentPath());
        return;
      }
      const target = parseAppPath(window.location.pathname, basePath);
      const targetLicenseId = target.page === "licenses" && !target.licenseKey ? null : undefined;
      const alreadyShown = target.page === pageRef.current
        && !target.licenseKey
        && (targetLicenseId === undefined || targetLicenseId === selectedIdRef.current);
      expectedRef.current = alreadyShown
        ? null
        : { page: target.page, licenseId: targetLicenseId, awaitingLicense: Boolean(target.licenseKey) };
      if (target.page !== pageRef.current) {
        navigateToPage(target.page);
        // A dirty-form guard may keep the current page; put the URL back so it
        // matches the screen. Leaving afterwards pushes the target path again.
        window.setTimeout(() => {
          if (pageRef.current === target.page) return;
          expectedRef.current = null;
          window.history.pushState(window.history.state, "", currentPath());
        }, 0);
      }
      if (target.licenseKey) setPendingLicenseKey(target.licenseKey);
      else if (target.page === "licenses" && selectedIdRef.current != null) selectLicense(null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [enabled, basePath, navigateToPage, selectLicense]);
}
