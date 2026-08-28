import React, { lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys.js";
import {
  invalidateCompletenessRules,
  invalidateCustomFieldDefinitions,
  invalidateImportState,
  invalidateNotifications,
  invalidatePortfolioState,
} from "./queryInvalidation.js";
import LicensesPage from "./components/pages/LicensesPage.jsx";
import InvoiceConfirmModal from "./components/licenses/InvoiceConfirmModal.jsx";
import { createManualEntryData } from "./constants/licenseData.js";

const RenewalWorkbenchPage = lazy(() => import("./components/pages/RenewalWorkbenchPage.jsx"));
const SourcingPage = lazy(() => import("./components/pages/SourcingPage.jsx"));
const PendingOrdersPage = lazy(() => import("./components/pages/PendingOrdersPage.jsx"));
const NotificationsPage = lazy(() => import("./components/pages/NotificationsPage.jsx"));
const ReportsPage = lazy(() => import("./components/pages/ReportsPage.jsx"));
const SettingsPage = lazy(() => import("./components/pages/SettingsPage.jsx"));
const AdminPage = lazy(() => import("./components/pages/AdminPage.jsx"));
const CSVImportPage = lazy(() => import("./components/pages/CSVImportPage.jsx"));
const ContractsPage = lazy(() => import("./components/pages/ContractsPage.jsx"));
const HelpPage = lazy(() => import("./components/pages/HelpPage.jsx"));

export default function AppRouter({
  page,
  setPage,
  perms,
  currentUser,
  userSettings,
  setUserSettings,
  globalSettings,
  setGlobalSettings,
  showError,
  showSuccess,
  showToast,
  confirmData,
  setConfirmData,
  selectedId,
  setSelectedId,
  handleSetSelectedId,
  statsVisible,
  setStatsVisible,
  notifications,
  notificationData,
  notificationsLoading,
  notificationsError,
  notificationsFetching,
  onRetryNotifications,
  licenseFullView,
  handleFullView,
  highlightSourcingId,
  setHighlightSourcingId,
  highlightPendingOrderId,
  setHighlightPendingOrderId,
  openContractId,
  setOpenContractId,
  handleConfirm,
  handleCreateContract,
  handleRegisterNavGuard,
  handleSettingsDiscard,
  handleSectionSaved,
  handleSidebarStatsChange,
}) {
  const queryClient = useQueryClient();

  return (
    <>
      <Suspense fallback={<div className="page-loading">Loading...</div>}>
        {page === "licenses" && (
          <LicensesPage
            selectedId={selectedId}
            setSelectedId={handleSetSelectedId}
            user={currentUser}
            userSettings={userSettings}
            setUserSettings={setUserSettings}
            globalSettings={globalSettings}
            showError={showError}
            showSuccess={showSuccess}
            showToast={showToast}
            onAddLicense={() => setConfirmData(createManualEntryData())}
            fullView={licenseFullView}
            onFullView={handleFullView}
            statsVisible={statsVisible}
            onSetStatsVisible={setStatsVisible}
            onNavigateToSourcing={(id) => { setPage("sourcing"); setHighlightSourcingId(id); }}
            onNavigateToPendingOrder={(id) => { setPage("pending-orders"); setHighlightPendingOrderId(id); }}
            onNavigateToContract={(id) => { setPage("contracts"); setOpenContractId(id); }}
            onCreateContract={handleCreateContract}
            onSourcingCreated={() => queryClient.invalidateQueries({ queryKey: queryKeys.sourcing })}
            onStatsChange={handleSidebarStatsChange}
            onPortfolioStateChange={() => invalidatePortfolioState(queryClient)}
          />
        )}

        {page === "renewal-workbench" && (
          <RenewalWorkbenchPage
            user={currentUser}
            userSettings={userSettings}
            setUserSettings={setUserSettings}
            globalSettings={globalSettings}
            showError={showError}
            showSuccess={showSuccess}
            onNavigateToLicense={(id) => { setPage("licenses"); handleSetSelectedId(id); }}
            onNavigateToSourcing={(id) => { setPage("sourcing"); setHighlightSourcingId(id); }}
            onNavigateToPendingOrder={(id) => { setPage("pending-orders"); setHighlightPendingOrderId(id); }}
          />
        )}

        {page === "sourcing" && currentUser.role !== "viewer" && (
          <SourcingPage
            user={currentUser}
            userSettings={userSettings}
            highlightId={highlightSourcingId}
            onClearHighlight={() => setHighlightSourcingId(null)}
            onPendingOrdersReload={() => queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders })}
            onRenewalsReload={() => queryClient.invalidateQueries({ queryKey: queryKeys.renewals })}
            onPortfolioStateChange={() => invalidatePortfolioState(queryClient)}
            onNavigateToPendingOrder={(id) => { setPage("pending-orders"); setHighlightPendingOrderId(id); }}
            onNavigateToLicense={(id) => { setPage("licenses"); handleSetSelectedId(id); }}
          />
        )}

        {page === "pending-orders" && currentUser.role !== "viewer" && (
          <PendingOrdersPage
            user={currentUser}
            userSettings={userSettings}
            showError={showError}
            showSuccess={showSuccess}
            onLicensesReload={() => queryClient.invalidateQueries({ queryKey: queryKeys.licenses })}
            onRenewalsReload={() => queryClient.invalidateQueries({ queryKey: queryKeys.renewals })}
            onPortfolioStateChange={() => invalidatePortfolioState(queryClient)}
            onNotificationsReload={() => invalidateNotifications(queryClient)}
            onNavigateToLicense={(id) => { handleSetSelectedId(id); setPage("licenses"); }}
            highlightId={highlightPendingOrderId}
            onClearHighlight={() => setHighlightPendingOrderId(null)}
          />
        )}

        {page === "notifications" && (
          <NotificationsPage
            notifications={notifications}
            notificationData={notificationData}
            notificationsLoading={notificationsLoading}
            notificationsError={notificationsError}
            notificationsFetching={notificationsFetching}
            onRetryNotifications={onRetryNotifications}
            globalSettings={globalSettings}
            setSelectedId={setSelectedId}
            setPage={setPage}
          />
        )}

        {page === "admin" && perms.canAdminSettings && (
          <AdminPage
            userSettings={userSettings}
            setUserSettings={setUserSettings}
            globalSettings={globalSettings}
            setGlobalSettings={setGlobalSettings}
            user={currentUser}
            onError={showError}
            onToast={showToast}
            onRefreshLicenses={() => queryClient.invalidateQueries({ queryKey: queryKeys.licenses })}
            onRefreshNotifications={() => invalidateNotifications(queryClient)}
            onCompletenessRulesChanged={() => invalidateCompletenessRules(queryClient)}
            onCustomFieldsChanged={() => invalidateCustomFieldDefinitions(queryClient)}
            onPortfolioReset={() => queryClient.invalidateQueries()}
            navGuard={{
              navigate: setPage,
              registerNavGuard: handleRegisterNavGuard,
              discard: handleSettingsDiscard,
              sectionSaved: handleSectionSaved,
            }}
            currentUserId={currentUser.id}
          />
        )}

        {page === "user-settings" && (
          <SettingsPage userSettings={userSettings} setUserSettings={setUserSettings} globalSettings={globalSettings} setGlobalSettings={setGlobalSettings} user={currentUser} onError={showError} onToast={showToast} onRefreshLicenses={() => queryClient.invalidateQueries({ queryKey: queryKeys.licenses })} onRefreshNotifications={() => invalidateNotifications(queryClient)} onCompletenessRulesChanged={() => invalidateCompletenessRules(queryClient)} onCustomFieldsChanged={() => invalidateCustomFieldDefinitions(queryClient)} navGuard={{ navigate: setPage, registerNavGuard: handleRegisterNavGuard, discard: handleSettingsDiscard, sectionSaved: handleSectionSaved }} _mySettingsOnly={true} />
        )}

        {page === "import" && currentUser.role !== "viewer" && (
          <CSVImportPage
            userSettings={userSettings}
            canManageImportMappings={currentUser.role === "admin"}
            onImportComplete={() => {
              invalidateImportState(queryClient);
            }}
            onGoToLicenses={() => { invalidateNotifications(queryClient); setPage("licenses"); }}
          />
        )}

        {page === "reports" && (
          <ReportsPage userSettings={userSettings} globalSettings={globalSettings} onError={showError} />
        )}

        {page === "contracts" && (
          <ContractsPage
            user={currentUser}
            userSettings={userSettings}
            showError={showError}
            onNavigateToLicense={(licenseId) => { setPage("licenses"); handleSetSelectedId(licenseId); }}
            openContractId={openContractId}
            onClearOpenContractId={() => setOpenContractId(null)}
          />
        )}

        {page === "help" && (
          <HelpPage />
        )}
      </Suspense>

      {confirmData && perms.canUpload && (
        <InvoiceConfirmModal
          data={confirmData}
          userSettings={userSettings}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmData(null)}
        />
      )}
    </>
  );
}
