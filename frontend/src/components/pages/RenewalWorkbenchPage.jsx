import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRenewalWorkbench } from "../../api/renewals.js";
import { listCustomFields, updateSettings } from "../../api/settings.js";
import { isEditorOrAdmin } from "../../utils/helpers.js";
import { queryKeys } from "../../queryKeys.js";
import { useRenewalWorkflowActions } from "../../hooks/useRenewalWorkflowActions.js";
import Icon from "../ui/Icon.jsx";
import {
  HIGH_VALUE_THRESHOLD,
  WINDOW_DAYS,
  EMPTY_COPY,
  VIEW_OPTIONS,
  includesSearch,
  getViewCounts,
  prioritySortRows,
} from "./renewals/workbenchRules.js";
import {
  buildWorkbenchColumns,
  getVisibleWorkbenchColumns,
} from "./renewals/workbenchColumns.js";
import RenewalWorkbenchTable from "./renewals/RenewalWorkbenchTable.jsx";
import RenewalWorkbenchToolbar from "./renewals/RenewalWorkbenchToolbar.jsx";

const EMPTY_ROWS = [];

async function fetchRenewalRows(view) {
  const { data, error } = await getRenewalWorkbench({ window_days: WINDOW_DAYS, view });
  if (error) throw new Error(error);
  return data ?? [];
}

async function fetchCustomFieldDefs() {
  const { data, error } = await listCustomFields();
  if (error) throw new Error(error);
  return data ?? [];
}

export default function RenewalWorkbenchPage({
  user,
  userSettings,
  setUserSettings,
  globalSettings,
  showError,
  showSuccess,
  onNavigateToLicense,
  onNavigateToSourcing,
  onNavigateToPendingOrder,
}) {
  const queryClient = useQueryClient();
  const { startRenewal } = useRenewalWorkflowActions({ showError });
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [startingId, setStartingId] = useState(null);

  const qAll = useQuery({
    queryKey: [...queryKeys.renewals, "all"],
    queryFn: () => fetchRenewalRows("all"),
  });
  const qSelected = useQuery({
    queryKey: [...queryKeys.renewals, view],
    queryFn: () => fetchRenewalRows(view),
    enabled: view !== "all",
  });
  const qCustomFields = useQuery({
    queryKey: queryKeys.customFieldDefs,
    queryFn: fetchCustomFieldDefs,
  });

  const rows = view === "all" ? (qAll.data ?? EMPTY_ROWS) : (qSelected.data ?? EMPTY_ROWS);
  const summaryRows = qAll.data ?? EMPTY_ROWS;
  const customFieldDefs = qCustomFields.data ?? EMPTY_ROWS;
  const loading = qAll.isLoading || (view !== "all" && qSelected.isLoading);
  const queryError = qAll.error || (view !== "all" ? qSelected.error : null) || qCustomFields.error;
  const error = queryError?.message ?? null;

  useEffect(() => {
    if (queryError) showError?.(queryError.message);
  }, [queryError]); // eslint-disable-line react-hooks/exhaustive-deps -- showError is stable

  const canStartRenewal = isEditorOrAdmin(user);
  const canOpenPipeline = user?.role !== "viewer";
  const locale = userSettings?.numberFormatLocale ?? "en-US";
  const savedColumnVisibility = useMemo(
    () => userSettings?.renewalWorkbenchColumns ?? {},
    [userSettings?.renewalWorkbenchColumns],
  );

  const visibleRows = useMemo(
    () => prioritySortRows(rows.filter((row) => includesSearch(row, search))),
    [rows, search],
  );

  const highValueThreshold = globalSettings?.highValueThreshold ?? HIGH_VALUE_THRESHOLD;
  const viewCounts = useMemo(() => getViewCounts(summaryRows, highValueThreshold), [summaryRows, highValueThreshold]);
  const columns = useMemo(() => buildWorkbenchColumns(summaryRows, customFieldDefs), [summaryRows, customFieldDefs]);
  const visibleColumns = useMemo(
    () => getVisibleWorkbenchColumns(columns, savedColumnVisibility),
    [columns, savedColumnVisibility],
  );
  const optionalColumns = useMemo(
    () => columns.filter((column) => !column.required),
    [columns],
  );

  const subtitle = loading
    ? "Loading renewal rows"
    : `${visibleRows.length} shown of ${summaryRows.length} renewal candidates`;

  const handleToggleColumn = async (columnId) => {
    const column = columns.find((item) => item.id === columnId);
    if (!column || column.required) return;

    const currentlyVisible = getVisibleWorkbenchColumns([column], savedColumnVisibility).length > 0;
    const nextVisibility = { ...savedColumnVisibility, [columnId]: !currentlyVisible };

    setUserSettings?.((settings) => ({
      ...settings,
      renewalWorkbenchColumns: nextVisibility,
    }));

    const { error: settingsError } = await updateSettings({
      renewal_workbench_columns: nextVisibility,
    });
    if (settingsError) showError?.(settingsError);
  };

  const handleStartRenewal = async (row) => {
    setStartingId(row.licenseId);
    const result = await startRenewal(row.licenseId);
    setStartingId(null);
    if (result.ok) showSuccess?.("Renewal started.");
  };

  return (
    <>
      <div className="page-header">
        <h2>Renewal Workbench</h2>
        <p>{subtitle}</p>
      </div>

      <div className="page-content rw-page">
        <div className="ps-sticky-wrap">
          <div className="kp">
            {[
              { key: 'overdue',      label: 'Overdue',      color: 'expired'  },
              { key: 'due_30',       label: '30 Days',      color: 'expiring' },
              { key: 'due_60',       label: '60 Days',      color: 'expiring' },
              { key: 'due_90',       label: '90 Days',      color: 'expiring' },
              { key: 'in_progress',  label: 'In Progress',  color: 'pending'  },
            ].map((stage, i, arr) => {
              const count = viewCounts[stage.key] ?? 0
              const isActive = view === stage.key
              const numClass = [
                'kp-num',
                count === 0 ? 'kp-num--zero' : '',
                stage.color ? `kp-num--${stage.color}` : '',
              ].filter(Boolean).join(' ')
              return (
                <div key={stage.key} style={{ display: 'contents' }}>
                  <button
                    className={`kp-stage${isActive ? ' kp-stage--active' : ''}`}
                    onClick={() => setView(stage.key)}
                    aria-pressed={isActive}
                  >
                    <span className={numClass}>{count}</span>
                    <span className="kp-label">{stage.label}</span>
                  </button>
                  {i < arr.length - 1 && <div className="kp-arrow" aria-hidden="true">→</div>}
                </div>
              )
            })}
          </div>
        </div>

          <div className="tbl-wrap">
            <RenewalWorkbenchToolbar
              search={search}
              onSearchChange={setSearch}
              optionalColumns={optionalColumns}
              savedColumnVisibility={savedColumnVisibility}
              onToggleColumn={handleToggleColumn}
            />

            <div className="lp-status-bar">
              {VIEW_OPTIONS.map((opt) => {
                const active = view === opt.key;
                const color = opt.color ?? "var(--text-2)";
                return (
                  <button
                    key={opt.key}
                    onClick={() => setView(opt.key)}
                    style={{
                      padding: "3px 8px", borderRadius: 12, border: "1px solid",
                      borderColor: active ? color : "var(--border)",
                      background: active ? `${color}18` : "none",
                      color: active ? color : "var(--text-3)",
                      fontSize: 10, fontWeight: 600, fontFamily: "var(--font-sans)",
                      cursor: "pointer", transition: "all .15s",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {loading && (
              <div className="rw-state" aria-live="polite">
                <div className="spinner" style={{ margin: 0, width: 18, height: 18 }} />
                Loading renewal workbench...
              </div>
            )}

            {!loading && error && (
              <div className="lp-error" role="alert">
                <Icon name="alert" size={16} color="var(--red-text)" />
                <span>{error}</span>
                <button type="button" className="lp-error-retry" onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.renewals })}>
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && visibleRows.length === 0 && (
              <div className="rw-state">
                <Icon name="check" size={16} />
                {search ? "No renewal rows match this search." : (EMPTY_COPY[view] ?? "No renewal rows match this view.")}
              </div>
            )}

            {!loading && !error && visibleRows.length > 0 && (
              <RenewalWorkbenchTable
                visibleColumns={visibleColumns}
                visibleRows={visibleRows}
                startingId={startingId}
                locale={locale}
                userSettings={userSettings}
                canStartRenewal={canStartRenewal}
                canOpenPipeline={canOpenPipeline}
                onNavigateToLicense={onNavigateToLicense}
                onNavigateToSourcing={onNavigateToSourcing}
                onNavigateToPendingOrder={onNavigateToPendingOrder}
                onStartRenewal={handleStartRenewal}
              />
            )}
          </div>
      </div>
    </>
  );
}
