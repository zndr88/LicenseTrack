import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_STATUS_FILTERS } from "../../constants/licenseData.js";
import { DEFAULT_DISPLAY_CURRENCY } from "../../constants/currencies.js";
import { formatCostByCurrency } from "../../utils/helpers.js";
import { formatNumber } from "../../utils/formatting.js";
import { useLicenseData } from "../../hooks/useLicenseData.js";
import { useUserSettings } from "../../hooks/useUserSettings.js";
import Icon from "../ui/Icon.jsx";
import DetailPanel from "../licenses/DetailPanel.jsx";
import { exportFilteredCsv } from "./licenses/exportFilteredCsv.js";
import {
  COLUMN_DEFS,
  makeCustomFieldColumnDefs,
  mergeVisibleColumns,
  orderColumnDefs,
} from "./licenses/licenseColumns.js";
import { useLicenseActions } from "./licenses/useLicenseActions.js";
import { useLicensesPageData } from "./licenses/useLicensesPageData.js";
import { useLicenseTableState } from "./licenses/useLicenseTableState.js";
import LicenseAttentionPanel from "./licenses/LicenseAttentionPanel.jsx";
import PipelineStrip from "./licenses/PipelineStrip.jsx";
import LicenseBulkActions from "./licenses/LicenseBulkActions.jsx";
import LicenseStatusFilter from "./licenses/LicenseStatusFilter.jsx";
import LicenseTable from "./licenses/LicenseTable.jsx";
import LicenseToolbar from "./licenses/LicenseToolbar.jsx";

export { exportFilteredCsv };

export default function LicensesPage({
  // Shared data from App
  selectedId,
  setSelectedId,
  user,
  userSettings,
  setUserSettings,
  globalSettings,
  showError,
  showSuccess,
  showToast,
  fullView: fullViewProp,
  onFullView,
  statsVisible,
  onSetStatsVisible,
  // For DetailPanel
  onNavigateToSourcing,
  onNavigateToPendingOrder,
  onNavigateToContract,
  onCreateContract,
  // Called after handleCreateRenewal so SourcingPage can refresh if mounted
  onSourcingCreated,
  // Reports stats to App for the sidebar Portfolio Condition widget
  onStatsChange,
  onPortfolioStateChange,
}) {
  const displayCurrency = userSettings.displayCurrency ?? DEFAULT_DISPLAY_CURRENCY;
  const [inlineEditEnabled, setInlineEditEnabled] = useState(false);

  const {
    search, setSearch,
    statusFilters, setStatusFilters,
    currentPage, setCurrentPage,
    pageSize, setPageSize,
    sortCol, setSortCol, sortDir, setSortDir, handleSortCol,
    selectedIds, setSelectedIds,
    showBulkDeleteConfirm, setShowBulkDeleteConfirm,
    filterRowOpen, setFilterRowOpen,
    columnFilters, setColumnFilters, hasColumnFilters,
    hoveredCol, setHoveredCol,
    dismissedAttentionIds, setDismissedAttentionIds,
  } = useLicenseTableState();

  // Local state
  useEffect(() => {
    if (fullViewProp) onSetStatsVisible(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only sync

  useEffect(() => {
    if (selectedId) {
      onSetStatsVisible(false);
    } else if (!fullViewProp) {
      onSetStatsVisible(true);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    licenses,
    licensesLoading,
    licensesError,
    loadLicenses,
    apiStats,
    sourcingItems,
    pendingOrders,
    contracts,
    customFieldDefs,
    customFieldValuesMap,
  } = useLicensesPageData({ showError, includeContracts: Boolean(selectedId) });

  // Derived data
  const { filtered, sorted, stats, enriched, paginatedItems, totalPages, departments } = useLicenseData(licenses, {
    search, statusFilters,
    columnFilters,
    currentPage, pageSize, sortCol, sortDir, globalSettings, userSettings, apiStats,
  });

  const datesFromOptions = useMemo(
    () => [...new Set(licenses.map((l) => l.startDate?.slice(0, 4)).filter(Boolean))].sort().reverse().map((y) => ({ value: y, label: y })),
    [licenses]
  );
  const datesToOptions = useMemo(
    () => [...new Set(licenses.filter((l) => l.endDate).map((l) => l.endDate.slice(0, 4)))].sort().reverse().map((y) => ({ value: y, label: y })),
    [licenses]
  );

  const attentionItems = useMemo(
    () => enriched
      .filter((l) => (l.expiration.status === "expiring" || l.expiration.status === "expired") && !dismissedAttentionIds.has(l.id))
      .sort((a, b) => (a.expiration.days ?? 0) - (b.expiration.days ?? 0)),
    [enriched, dismissedAttentionIds]
  );

  const activeSourcingCount = useMemo(
    () => sourcingItems.filter((s) => s.status !== "converted").length,
    [sourcingItems]
  );

  const activePendingCount = useMemo(
    () => pendingOrders.filter((po) => po.status !== "converted").length,
    [pendingOrders]
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every(l => selectedIds.has(l.id));
  const someFilteredSelected = filtered.some(l => selectedIds.has(l.id));

  const { handleSaveView, handleDeleteView, handleLoadView, handleHideColumn, handleRevertToDefault } = useUserSettings({
    userSettings, setUserSettings,
    statusFilters, setStatusFilters,
    columnFilters, setColumnFilters,
    sortCol, sortDir, setSortCol, setSortDir,
    showError, showSuccess,
  });

  useEffect(() => {
    if (onStatsChange && stats) {
      onStatsChange({
        active: stats.active ?? 0,
        pending: activePendingCount,
        expiring: stats.expiring ?? 0,
        expired: stats.expired ?? 0,
        renewed: stats.renewed ?? 0,
      });
    }
  }, [stats, onStatsChange, activePendingCount]);

  const {
    handleLicenseUpdate,
    handleLicenseFieldPatch,
    handleLicenseDelete,
    handleCreateRenewal,
    handleCancelRenewal,
    handleBulkDelete,
  } = useLicenseActions({
    selectedId,
    selectedIds,
    setSelectedId,
    setSelectedIds,
    setShowBulkDeleteConfirm,
    showError,
    showToast,
    onPortfolioStateChange,
    onSourcingCreated,
    onNavigateToSourcing,
  });

  // UI handlers
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && fullViewProp) {
        onFullView(false);
        onSetStatsVisible(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullViewProp, onFullView, onSetStatsVisible]);

  const handleToggleFullView = () => {
    const next = !fullViewProp;
    if (next) {
      onSetStatsVisible(false);
      onFullView(true);
    } else {
      onSetStatsVisible(true);
      onFullView(false);
    }
  };

  const handleToggleInlineEdit = useCallback(() => {
    setInlineEditEnabled((enabled) => {
      const next = !enabled;
      if (next) setSelectedId(null);
      return next;
    });
  }, [setSelectedId]);

  // Derived column order
  // Custom field columns - dynamic, derived from admin-defined definitions
  const customFieldColDefs = makeCustomFieldColumnDefs(customFieldDefs);

  const allColumnDefs = [...COLUMN_DEFS, ...customFieldColDefs];
  const activeColumns = orderColumnDefs(allColumnDefs, userSettings.columnOrder);
  const visList = mergeVisibleColumns(userSettings.visibleInList);

  // DetailPanel
  const selectedLicense = licenses.find((l) => l.id === selectedId);

  return (
    <>
      <div className="page-header">
        <h2>License Overview</h2>
        <p>{formatNumber(licenses.length - (stats.legacy ?? 0), userSettings)} licenses tracked{visList.totalPoPrice && stats.costByCurrency ? ` · ${formatCostByCurrency(stats.costByCurrency, userSettings.numberFormatLocale ?? "en-US")} active PO value${stats.excludedFromTotals > 0 ? ` (${stats.excludedFromTotals} excluded)` : ""}` : ""}{hasColumnFilters ? " · column filters active" : ""}</p>
      </div>
      <div className={`page-content ${selectedLicense ? "lp-page-open" : ""}`}>
        {licensesLoading && (
          <div className="lp-loading">
            <div className="spinner" style={{ margin: 0, width: 18, height: 18 }} />
            Loading licenses...
          </div>
        )}
        {licensesError && (
          <div className="lp-error">
            <Icon name="alert" size={16} color="var(--red-text)" />
            <span>{licensesError}</span>
            <button className="lp-error-retry" onClick={loadLicenses}>Retry</button>
          </div>
        )}

        {statsVisible && (
          <div className="ps-sticky-wrap">
          <PipelineStrip
            stats={{
              sourcing: activeSourcingCount,
              pending: activePendingCount,
              active: stats.active,
              expiring: stats.expiring,
              expired: stats.expired,
              renewed: stats.renewed,
            }}
            onStageClick={(key) => {
              if (key === 'sourcing') {
                onNavigateToSourcing(null);
              } else if (key === 'pending') {
                onNavigateToPendingOrder(null);
              } else {
                const a = statusFilters.length === 1 && statusFilters[0] === key;
                setStatusFilters(a ? DEFAULT_STATUS_FILTERS : [key]);
                setCurrentPage(1);
              }
            }}
            activeFilters={statusFilters}
          />
          </div>
        )}
        <LicenseAttentionPanel
          attentionItems={attentionItems}
          setSelectedId={setSelectedId}
          setDismissedAttentionIds={setDismissedAttentionIds}
        />

        <div className="lp-split">
          <div className="tbl-wrap">
            <LicenseToolbar
              search={search}
              setSearch={setSearch}
              setCurrentPage={setCurrentPage}
              filterRowOpen={filterRowOpen}
              setFilterRowOpen={setFilterRowOpen}
              hasColumnFilters={hasColumnFilters}
              setColumnFilters={setColumnFilters}
              statsVisible={statsVisible}
              onSetStatsVisible={onSetStatsVisible}
              fullViewProp={fullViewProp}
              handleToggleFullView={handleToggleFullView}
              loadLicenses={loadLicenses}
              selectedIds={selectedIds}
              setShowBulkDeleteConfirm={setShowBulkDeleteConfirm}
              userSettings={userSettings}
              handleSaveView={handleSaveView}
              handleDeleteView={handleDeleteView}
              handleLoadView={handleLoadView}
              handleRevertToDefault={handleRevertToDefault}
              activeColumns={activeColumns}
              visList={visList}
              filtered={sorted}
              displayCurrency={displayCurrency}
              licenses={licenses}
              customFieldValuesMap={customFieldValuesMap}
              showError={showError}
              inlineEditEnabled={inlineEditEnabled}
              onToggleInlineEdit={handleToggleInlineEdit}
              canInlineEdit={user?.role === "admin" || user?.role === "editor"}
            />
            <LicenseStatusFilter
              statusFilters={statusFilters}
              setStatusFilters={setStatusFilters}
              setCurrentPage={setCurrentPage}
            />
          <LicenseTable
            filtered={sorted}
            paginatedItems={paginatedItems}
            licenses={licenses}
            departments={departments}
            datesFromOptions={datesFromOptions}
            datesToOptions={datesToOptions}
            customFieldValuesMap={customFieldValuesMap}
            activeColumns={activeColumns}
            visList={visList}
            displayCurrency={displayCurrency}
            userSettings={userSettings}
            setUserSettings={setUserSettings}
            handleHideColumn={handleHideColumn}
            sortCol={sortCol}
            sortDir={sortDir}
            handleSortCol={handleSortCol}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            allFilteredSelected={allFilteredSelected}
            someFilteredSelected={someFilteredSelected}
            filterRowOpen={filterRowOpen}
            columnFilters={columnFilters}
            setColumnFilters={setColumnFilters}
            hasColumnFilters={hasColumnFilters}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            pageSize={pageSize}
            setPageSize={setPageSize}
            totalPages={totalPages}
            hoveredCol={hoveredCol}
            setHoveredCol={setHoveredCol}
            setSelectedId={setSelectedId}
            inlineEditEnabled={inlineEditEnabled}
            onInlineFieldSave={handleLicenseFieldPatch}
          />
          </div>

          {selectedLicense && (
            <DetailPanel
              license={selectedLicense}
              userSettings={userSettings}
              globalSettings={globalSettings}
              user={user}
              allLicenses={licenses}
              sourcingItems={sourcingItems}
              pendingOrders={pendingOrders}
              contracts={contracts}
              onNavigateToSourcing={onNavigateToSourcing}
              onNavigateToPendingOrder={onNavigateToPendingOrder}
              onNavigateToContract={onNavigateToContract}
              onCreateContract={onCreateContract}
              onClose={() => setSelectedId(null)}
              onUpdate={handleLicenseUpdate}
              onDelete={handleLicenseDelete}
              onCreateRenewal={handleCreateRenewal}
              onCancelRenewal={handleCancelRenewal}
              onNavigate={(id) => setSelectedId(id)}
            />
          )}
        </div>
      </div>
      <LicenseBulkActions
        showBulkDeleteConfirm={showBulkDeleteConfirm}
        setShowBulkDeleteConfirm={setShowBulkDeleteConfirm}
        selectedIds={selectedIds}
        handleBulkDelete={handleBulkDelete}
      />
    </>
  );
}
