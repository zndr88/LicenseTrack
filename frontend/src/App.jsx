import React, { useCallback, useEffect, useMemo } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContract } from "./api/contracts.js";
import { createLicenseBatch, getStats } from "./api/licenses.js";
import { uploadDocument } from "./api/documents.js";
import { getNotifications } from "./api/notifications.js";
import { getPendingOrders } from "./api/pendingOrders.js";
import AppRouter from "./AppRouter.jsx";
import { queryKeys } from "./queryKeys.js";
import { invalidateNotifications } from "./queryInvalidation.js";
import { createManualEntryData } from "./constants/licenseData.js";

async function fetchNotifications() {
  const { data, error } = await getNotifications();
  if (error) throw new Error(error);
  if (!Array.isArray(data)) throw new Error("Notification data was not returned by the server.");
  return data;
}

async function fetchLicenseStats() {
  const { data, error } = await getStats();
  if (error) throw new Error(error);
  return data ?? null;
}

async function fetchPendingOrdersList() {
  const { data, error } = await getPendingOrders();
  if (error) throw new Error(error);
  return data ?? [];
}

function buildSidebarStats(stats, orders) {
  if (!stats) return null;
  return {
    active: (stats.total_active ?? 0) - (stats.total_expiring ?? 0),
    pending: orders.filter((po) => po.status !== "converted").length,
    expiring: stats.total_expiring ?? 0,
    expired: stats.total_expired ?? 0,
    renewed: stats.total_renewed ?? 0,
  };
}

async function fetchPortfolioStats(queryClient) {
  const [stats, orders] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: queryKeys.licenseStats,
      queryFn: fetchLicenseStats,
    }),
    queryClient.fetchQuery({
      queryKey: queryKeys.pendingOrders,
      queryFn: fetchPendingOrdersList,
    }),
  ]);
  return buildSidebarStats(stats, orders);
}
import ChangePasswordModal from "./components/auth/ChangePasswordModal.jsx";
import LoginScreen from "./components/auth/LoginScreen.jsx";
import Sidebar from "./components/layout/Sidebar.jsx";
import TopBar from "./components/layout/TopBar.jsx";
import Icon from "./components/ui/Icon.jsx";
import { ROLE_PERMISSIONS } from "./constants/permissions.js";
import { useAppNavigation } from "./hooks/useAppNavigation.js";
import { useAppSettings } from "./hooks/useAppSettings.js";
import { useAuth } from "./hooks/useAuth.js";
import { useToast } from "./hooks/useToast.js";

function buildLicensePayload(form) {
  return {
    publisherName: form.publisherName,
    softwareDescription: form.softwareDescription,
    startDate: form.startDate || null,
    endDate: form.isPerpetual ? null : (form.endDate || null),
    noticeDate: form.noticeDate || null,
    contractNumber: form.contractNumber || "",
    poNumber: form.poNumber || "",
    invoiceNumber: form.invoiceNumber || "",
    contactEmail: form.contactEmail || "",
    supplier: form.supplier || "",
    costCentre: form.costCentre || "",
    licenseType: form.licenseType || "subscription",
    licenseMetric: form.licenseMetric || "per_user",
    portalUrl: form.licenseType === "saas" ? (form.portalUrl || null) : null,
    quantity: form.quantity || "",
    skuCode: form.skuCode || "",
    unitPrice: form.unitPrice || "",
    totalPoPrice: form.totalPoPrice || "",
    currency: form.currency || "EUR",
    notes: form.notes || null,
    budgetOwnerEmail: form.budgetOwnerEmail || "",
    maintenanceCoverage: form.maintenanceCoverage || null,
    maintenanceStartDate: form.maintenanceStartDate || null,
    maintenanceEndDate: form.maintenanceEndDate || null,
    maintenancePricingBasis: form.maintenancePricingBasis || null,
    maintenanceQuantity: form.maintenanceQuantity || null,
    maintenanceUnitPrice: form.maintenanceUnitPrice || null,
    maintenanceCost: form.maintenanceCost || "",
    ...(form.parentLicenseId ? { parentLicenseId: form.parentLicenseId } : {}),
    ...(form.maintenanceParentIds?.length ? { maintenanceParentIds: form.maintenanceParentIds } : {}),
    isRetired: false,
  };
}

const DEFAULT_SIDEBAR_STATS = { active: 0, pending: 0, expiring: 0, expired: 0, renewed: 0 };
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

export default function App() {
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, showToast, dismissToast } = useToast();
  const {
    userSettings,
    setUserSettings,
    globalSettings,
    setGlobalSettings,
    loadSettings,
    loadGlobalSettings,
    handleSectionSaved,
    handleSettingsDiscard,
    handleToggleSidebar,
  } = useAppSettings({ showError });
  const {
    currentUser,
    setCurrentUser,
    authBootstrapping,
    handleLogout,
  } = useAuth({
    sessionTimeout: globalSettings.sessionTimeout,
    showToast,
  });

  const notificationQuery = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: fetchNotifications,
    enabled: !!currentUser,
    placeholderData: keepPreviousData,
  });
  const notifications = Array.isArray(notificationQuery.data) ? notificationQuery.data : [];
  const notificationDataAvailable = Array.isArray(notificationQuery.data);

  const { data: sidebarStats = DEFAULT_SIDEBAR_STATS } = useQuery({
    queryKey: queryKeys.portfolioStats,
    queryFn: () => fetchPortfolioStats(queryClient),
    enabled: !!currentUser,
  });

  const navigation = useAppNavigation({
    currentUser,
    setUserSettings,
  });

  const {
    page,
    setPage,
    handleSetPage,
    handleRegisterNavGuard,
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
  } = navigation;

  const handleSidebarStatsChange = useCallback((s) => {
    queryClient.setQueryData(queryKeys.portfolioStats, s);
  }, [queryClient]);

  useEffect(() => {
    if (currentUser) {
      loadSettings();
      loadGlobalSettings(currentUser);
    }
  }, [currentUser, loadSettings, loadGlobalSettings]);

  const handleConfirm = useCallback(async (forms, attachedFile, attachedFileCategory) => {
    const formList = Array.isArray(forms) ? forms : [forms];
    const items = formList.map((form) => {
      const hasBatchParent = Number.isInteger(form.parentLineIndex);
      return {
        license: buildLicensePayload({
          ...form,
          parentLicenseId: hasBatchParent ? null : form.parentLicenseId,
        }),
        ...(hasBatchParent ? { parentLineIndex: form.parentLineIndex } : {}),
      };
    });
    const { data: created = [], error } = await createLicenseBatch(items);
    if (error) {
      showError(error);
      return false;
    }

    const firstCreatedId = created[0]?.id ?? null;
    if (attachedFile && firstCreatedId) {
      const { error: docError } = await uploadDocument(firstCreatedId, attachedFile, attachedFileCategory);
      if (docError) {
        setSelectedId(firstCreatedId);
        showError(
          `License${formList.length > 1 ? "s" : ""} saved, but document upload failed: ${docError}. `
          + "Retry the attachment from the first license's Documents section; do not resubmit the licenses."
        );
      }
    }
    setConfirmData(null);
    setPage("licenses");
    queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
    queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats });
    queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats });
    invalidateNotifications(queryClient);
    return true;
  }, [showError, queryClient, setConfirmData, setPage, setSelectedId]);

  const handleCreateContract = useCallback(async ({ contractNumber, publisherName }) => {
    const { data, error } = await createContract({ contract_number: contractNumber, publisher_name: publisherName });
    if (error) { showError(error); return; }
    setPage("contracts");
    setOpenContractId(data.id);
  }, [showError, setPage, setOpenContractId]);

  const toastConfig = useMemo(() => {
    if (!toast) return null;
    if (toast.type === "success") return { border: "var(--green)", icon: "check", color: "var(--green-text)" };
    if (toast.type === "error") return { border: "var(--red)", icon: "alert", color: "var(--red-text)" };
    return { border: "var(--border-lt)", icon: "check", color: "var(--text-2)" };
  }, [toast]);

  if (authBootstrapping) return null;

  if (!currentUser) return <LoginScreen onLogin={(u) => setCurrentUser(u)} />;

  if (currentUser.mustChangePassword && currentUser.authProvider !== "oidc") return (
    <ChangePasswordModal onSuccess={() => setCurrentUser((u) => ({ ...u, mustChangePassword: false }))} />
  );

  const perms = ROLE_PERMISSIONS[currentUser.role];
  const sidebarW = userSettings.sidebarCollapsed ? 52 : 240;

  return (
    <>
      <div className="app" style={{ paddingLeft: sidebarW }}>
        <Sidebar
          page={page}
          setPage={handleSetPage}
          setSelectedId={handleSetSelectedId}
          currentUser={currentUser}
          notifications={notifications}
          onLogout={handleLogout}
          collapsed={userSettings.sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          userSettings={userSettings}
          stats={sidebarStats}
        />

        <div className="app-right">
          <TopBar
            page={page}
            onNavigate={handleSetPage}
            currentUser={currentUser}
            notifications={notifications}
            notificationsAvailable={notificationDataAvailable}
            notificationsLoading={notificationQuery.isPending}
            onLogout={handleLogout}
            perms={perms}
            onAddLicense={() => setConfirmData(createManualEntryData())}
          />
          {DEMO_MODE && (
            <div className="demo-banner" role="status">
              Demo mode - sample data, stored only in your browser, resets on logout or refresh.
            </div>
          )}

          <main className="main">
            <AppRouter
              page={page}
              setPage={setPage}
              perms={perms}
              currentUser={currentUser}
              userSettings={userSettings}
              setUserSettings={setUserSettings}
              globalSettings={globalSettings}
              setGlobalSettings={setGlobalSettings}
              showError={showError}
              showSuccess={showSuccess}
              showToast={showToast}
              confirmData={confirmData}
              setConfirmData={setConfirmData}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              handleSetSelectedId={handleSetSelectedId}
              statsVisible={statsVisible}
              setStatsVisible={setStatsVisible}
              notifications={notifications}
              notificationData={notificationQuery.data ?? null}
              notificationsLoading={notificationQuery.isPending}
              notificationsError={notificationQuery.isError ? notificationQuery.error?.message : null}
              notificationsFetching={notificationQuery.isFetching}
              onRetryNotifications={notificationQuery.refetch}
              licenseFullView={licenseFullView}
              handleFullView={handleFullView}
              highlightSourcingId={highlightSourcingId}
              setHighlightSourcingId={setHighlightSourcingId}
              highlightPendingOrderId={highlightPendingOrderId}
              setHighlightPendingOrderId={setHighlightPendingOrderId}
              openContractId={openContractId}
              setOpenContractId={setOpenContractId}
              handleConfirm={handleConfirm}
              handleCreateContract={handleCreateContract}
              handleRegisterNavGuard={handleRegisterNavGuard}
              handleSettingsDiscard={handleSettingsDiscard}
              handleSectionSaved={handleSectionSaved}
              handleSidebarStatsChange={handleSidebarStatsChange}
            />
          </main>
        </div>

        {toast && toastConfig && (
          <div className="toast" style={{ borderColor: toastConfig.border }}>
            <Icon name={toastConfig.icon} size={16} color={toastConfig.color} />
            <span style={{ flex: 1 }}>{toast.msg}</span>
            {toast.action && <button onClick={() => { toast.action.onClick(); dismissToast(); }} className="toast-action" style={{ borderColor: toastConfig.border, color: toastConfig.color }}>{toast.action.label}</button>}
            <button onClick={dismissToast} className="toast-dismiss" aria-label="Dismiss notification"><Icon name="x" size={14} /></button>
          </div>
        )}
      </div>
    </>
  );
}
