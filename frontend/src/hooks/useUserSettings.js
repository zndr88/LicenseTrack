import { useCallback } from "react";
import { updateSettings } from "../api/settings.js";
import { DEFAULT_STATUS_FILTERS } from "../constants/licenseData.js";
import { VISIBLE_IN_LIST_DEFAULTS } from "../components/pages/licenses/licenseColumns.js";

export function useUserSettings({
  userSettings,
  setUserSettings,
  statusFilters,
  setStatusFilters,
  columnFilters,
  setColumnFilters,
  sortCol,
  sortDir,
  setSortCol,
  setSortDir,
  showError,
  showSuccess,
}) {
  const commitSettings = useCallback(async (patch) => {
    const { error } = await updateSettings({
      saved_views: userSettings.savedViews,
      display_currency: userSettings.displayCurrency,
      number_format_locale: userSettings.numberFormatLocale,
      date_format: userSettings.dateFormat,
      time_format: userSettings.timeFormat,
      time_zone: userSettings.timeZone,
      column_order: userSettings.columnOrder,
      visible_in_list: userSettings.visibleInList,
      visible_in_detail: userSettings.visibleInDetail,
      theme: userSettings.theme,
      ui_size: userSettings.uiSize,
      sidebar_collapsed: userSettings.sidebarCollapsed,
      ...patch,
    });
    if (error) showError(error);
    return !error;
  }, [userSettings, showError]);

  const handleSaveView = useCallback(async (name) => {
    const newView = {
      name,
      statusFilters,
      columnFilters,
      columnOrder: userSettings.columnOrder,
      visibleInList: userSettings.visibleInList,
      sortCol: sortCol ?? null,
      sortDir,
    };
    const updatedViews = [
      ...userSettings.savedViews.filter((v) => v.name !== name),
      newView,
    ];
    setUserSettings((s) => ({ ...s, savedViews: updatedViews }));
    const ok = await commitSettings({ saved_views: updatedViews });
    if (!ok) {
      setUserSettings(userSettings);
      return;
    }
    if (ok) showSuccess("View saved.");
  }, [userSettings, statusFilters, columnFilters, sortCol, sortDir, setUserSettings, showSuccess, commitSettings]);

  const handleDeleteView = useCallback(async (name) => {
    const updatedViews = userSettings.savedViews.filter((v) => v.name !== name);
    setUserSettings((s) => ({ ...s, savedViews: updatedViews }));
    const ok = await commitSettings({ saved_views: updatedViews });
    if (!ok) setUserSettings(userSettings);
  }, [userSettings, setUserSettings, commitSettings]);

  const handleLoadView = useCallback(async (view) => {
    const newVisibleInList = view.visibleInList ?? userSettings.visibleInList;
    const newColumnOrder = view.columnOrder ?? userSettings.columnOrder;

    if (view.statusFilters) setStatusFilters(view.statusFilters);
    setColumnFilters(view.columnFilters ?? {});
    setUserSettings((s) => ({
      ...s,
      columnOrder: newColumnOrder,
      visibleInList: newVisibleInList,
    }));
    setSortCol(view.sortCol ?? null);
    setSortDir(view.sortDir ?? "asc");

    const ok = await commitSettings({
      visible_in_list: newVisibleInList,
      column_order: newColumnOrder,
    });
    if (!ok) {
      if (view.statusFilters) setStatusFilters(statusFilters);
      setColumnFilters(columnFilters);
      setUserSettings(userSettings);
      setSortCol(sortCol ?? null);
      setSortDir(sortDir);
    }
  }, [userSettings, statusFilters, columnFilters, sortCol, sortDir, setStatusFilters, setColumnFilters, setUserSettings, setSortCol, setSortDir, commitSettings]);

  const handleHideColumn = useCallback(async (colKey) => {
    const updatedVisList = { ...userSettings.visibleInList, [colKey]: false };
    setUserSettings((s) => ({ ...s, visibleInList: updatedVisList }));
    const ok = await commitSettings({ visible_in_list: updatedVisList });
    if (!ok) setUserSettings(userSettings);
  }, [userSettings, setUserSettings, commitSettings]);

  const handleRevertToDefault = useCallback(async () => {
    const defaultVisibleInList = { ...VISIBLE_IN_LIST_DEFAULTS };

    setStatusFilters(DEFAULT_STATUS_FILTERS);
    setColumnFilters({});
    setUserSettings((s) => ({
      ...s,
      columnOrder: [],
      visibleInList: defaultVisibleInList,
    }));
    setSortCol(null);
    setSortDir("asc");

    const ok = await commitSettings({
      visible_in_list: defaultVisibleInList,
      column_order: [],
    });
    if (!ok) {
      setStatusFilters(statusFilters);
      setColumnFilters(columnFilters);
      setUserSettings(userSettings);
      setSortCol(sortCol ?? null);
      setSortDir(sortDir);
    }
  }, [userSettings, statusFilters, columnFilters, sortCol, sortDir, setStatusFilters, setColumnFilters, setUserSettings, setSortCol, setSortDir, commitSettings]);

  return {
    handleSaveView,
    handleDeleteView,
    handleLoadView,
    handleHideColumn,
    handleRevertToDefault,
  };
}
