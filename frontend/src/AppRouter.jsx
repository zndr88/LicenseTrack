import React, { lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys.js";
import { invalidateNotifications } from "./queryInvalidation.js";
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
          onPortfolioStateChange={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats });
            queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats });
          }}
        />
      )}

      {page === "renewal-workbench" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
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
        </Suspense>
      )}


      {page === "sourcing" && currentUser.role !== "viewer" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <SourcingPage
            user={currentUser}
            userSettings={userSettings}
            highlightId={highlightSourcingId}
            onClearHighlight={() => setHighlightSourcingId(null)}
            onPendingOrdersReload={() => queryClient.invalidateQueries({ queryKey: queryKeys.pendingOrders })}
            onRenewalsReload={() => queryClient.invalidateQueries({ queryKey: queryKeys.renewals })}
            onPortfolioStateChange={() => {
              queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats });
              queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats });
            }}
            onNavigateToPendingOrder={(id) => { setPage("pending-orders"); setHighlightPendingOrderId(id); }}
          />
        </Suspense>
      )}

      {page === "pending-orders" && currentUser.role !== "viewer" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <PendingOrdersPage
            user={currentUser}
            userSettings={userSettings}
            showError={showError}
            showSuccess={showSuccess}
            onLicensesReload={() => queryClient.invalidateQueries({ queryKey: queryKeys.licenses })}
            onRenewalsReload={() => queryClient.invalidateQueries({ queryKey: queryKeys.renewals })}
            onPortfolioStateChange={() => {
              queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats });
              queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats });
            }}
            onNotificationsReload={() => invalidateNotifications(queryClient)}
            onNavigateToLicense={(id) => { handleSetSelectedId(id); setPage("licenses"); }}
            highlightId={highlightPendingOrderId}
            onClearHighlight={() => setHighlightPendingOrderId(null)}
          />
        </Suspense>
      )}

      {page === "notifications" && currentUser.role !== "viewer" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <NotificationsPage
            notifications={notifications}
            globalSettings={globalSettings}
            setSelectedId={setSelectedId}
            setPage={setPage}
          />
        </Suspense>
      )}

      {page === "settings" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <SettingsPage userSettings={userSettings} setUserSettings={setUserSettings} globalSettings={globalSettings} setGlobalSettings={setGlobalSettings} user={currentUser} onError={showError} onToast={showToast} onRefreshLicenses={() => queryClient.invalidateQueries({ queryKey: queryKeys.licenses })} onRefreshNotifications={() => invalidateNotifications(queryClient)} navGuard={{ navigate: setPage, registerNavGuard: handleRegisterNavGuard, discard: handleSettingsDiscard, sectionSaved: handleSectionSaved }} _mySettingsOnly={true} />
        </Suspense>
      )}

      {page === "admin" && perms.canAdminSettings && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
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
            navGuard={{
              navigate: setPage,
              registerNavGuard: handleRegisterNavGuard,
              discard: handleSettingsDiscard,
              sectionSaved: handleSectionSaved,
            }}
            currentUserId={currentUser.id}
          />
        </Suspense>
      )}

      {page === "user-settings" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <SettingsPage userSettings={userSettings} setUserSettings={setUserSettings} globalSettings={globalSettings} setGlobalSettings={setGlobalSettings} user={currentUser} onError={showError} onToast={showToast} onRefreshLicenses={() => queryClient.invalidateQueries({ queryKey: queryKeys.licenses })} onRefreshNotifications={() => invalidateNotifications(queryClient)} navGuard={{ navigate: setPage, registerNavGuard: handleRegisterNavGuard, discard: handleSettingsDiscard, sectionSaved: handleSectionSaved }} _mySettingsOnly={true} />
        </Suspense>
      )}

      {page === "import" && currentUser.role !== "viewer" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <CSVImportPage
            userSettings={userSettings}
            onImportComplete={() => {
              queryClient.invalidateQueries({ queryKey: queryKeys.licenses });
              queryClient.invalidateQueries({ queryKey: queryKeys.portfolioStats });
              queryClient.invalidateQueries({ queryKey: queryKeys.reportsPortfolioStats });
              invalidateNotifications(queryClient);
            }}
            onGoToLicenses={() => { invalidateNotifications(queryClient); setPage("licenses"); }}
          />
        </Suspense>
      )}

      {page === "reports" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <ReportsPage userSettings={userSettings} globalSettings={globalSettings} onError={showError} />
        </Suspense>
      )}

      {page === "contracts" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <ContractsPage
            user={currentUser}
            userSettings={userSettings}
            showError={showError}
            onNavigateToLicense={(licenseId) => { setPage("licenses"); handleSetSelectedId(licenseId); }}
            openContractId={openContractId}
            onClearOpenContractId={() => setOpenContractId(null)}
          />
        </Suspense>
      )}

      {page === "help" && (
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <HelpPage />
        </Suspense>
      )}

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
