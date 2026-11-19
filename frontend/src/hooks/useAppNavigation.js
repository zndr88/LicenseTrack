import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queryKeys.js";
import { invalidateContracts, invalidateNotifications } from "../queryInvalidation.js";
import { useIdleRefresh } from "./useIdleRefresh.js";

export function useAppNavigation({ currentUser, setUserSettings }) {
  const [page, setPage] = useState("licenses");
  const [confirmData, setConfirmData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [statsVisible, setStatsVisible] = useState(true);
  const [openContractId, setOpenContractId] = useState(null);
  const [licenseFullView, setLicenseFullView] = useState(false);
  const [highlightSourcingId, setHighlightSourcingId] = useState(null);
  const [highlightPendingOrderId, setHighlightPendingOrderId] = useState(null);
  const settingsNavGuardRef = useRef(null);
  const leaveGuardRef = useRef(null);
  const pageRef = useRef(page);
  const swimlanesWereVisible = useRef(false);
  const statsVisibleRef = useRef(statsVisible);
  const selectedIdRef = useRef(selectedId);

  const queryClient = useQueryClient();

  useEffect(() => {
    statsVisibleRef.current = statsVisible;
  }, [statsVisible]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  // An open License Details edit registers a guard here. When it holds unsaved
  // changes it keeps `proceed`, asks the user, and returns true; `proceed` then
  // runs only after the user chooses to discard.
  const interceptLeave = useCallback((proceed) => leaveGuardRef.current?.(proceed) === true, []);

  const handleRegisterLeaveGuard = useCallback((fn) => {
    leaveGuardRef.current = fn;
  }, []);

  const handleSetSelectedId = useCallback((licenseId) => {
    if (licenseId !== selectedIdRef.current && interceptLeave(() => handleSetSelectedId(licenseId))) return;
    if (licenseId == null) {
      if (swimlanesWereVisible.current) {
        setStatsVisible(true);
      }
      swimlanesWereVisible.current = false;
      setSelectedId(null);
      return;
    }

    if (selectedIdRef.current == null) {
      swimlanesWereVisible.current = statsVisibleRef.current;
      setStatsVisible(false);
    }
    setSelectedId(licenseId);
  }, [interceptLeave]);

  const handleSetPage = useCallback((newPage) => {
    if (newPage !== pageRef.current && interceptLeave(() => handleSetPage(newPage))) return;
    if (settingsNavGuardRef.current) {
      settingsNavGuardRef.current(newPage);
    } else {
      setPage(newPage);
    }
  }, [interceptLeave]);

  const handleRegisterNavGuard = useCallback((fn) => {
    settingsNavGuardRef.current = fn;
  }, []);

  const handleIdleRefresh = useCallback(() => {
    if (page === "licenses" || page === "notifications") {
      queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
      invalidateNotifications(queryClient);
    } else if (page === "renewal-workbench") {
      queryClient.invalidateQueries({ queryKey: queryKeys.renewals });
    } else if (page === "sourcing") {
      queryClient.invalidateQueries({ queryKey: queryKeys.sourcing });
    } else if (page === "pending-orders") {
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders });
    } else if (page === "contracts") {
      invalidateContracts(queryClient);
    }
  }, [page, queryClient]);

  useIdleRefresh(handleIdleRefresh, {
    idleMs: 3 * 60 * 1000,
    enabled: !!currentUser,
  });

  useEffect(() => {
    if (!currentUser) return;
    if (page === "notifications") invalidateNotifications(queryClient);
  }, [page, currentUser, queryClient]);

  useEffect(() => {
    if (!currentUser) return;
    const viewerRestricted = ["sourcing", "pending-orders", "import", "admin"];
    if (currentUser.role === "viewer" && viewerRestricted.includes(page)) {
      setPage("licenses");
    }
  }, [page, currentUser]);

  const handleFullView = useCallback((entering) => {
    setLicenseFullView(entering);
    setUserSettings((s) => ({ ...s, sidebarCollapsed: entering ? true : false }));
  }, [setUserSettings]);

  return {
    page,
    setPage,
    handleSetPage,
    handleRegisterNavGuard,
    interceptLeave,
    handleRegisterLeaveGuard,
    confirmData,
    setConfirmData,
    selectedId,
    setSelectedId,
    handleSetSelectedId,
    statsVisible,
    setStatsVisible,
    openContractId,
    setOpenContractId,
    licenseFullView,
    handleFullView,
    highlightSourcingId,
    setHighlightSourcingId,
    highlightPendingOrderId,
    setHighlightPendingOrderId,
  };
}
