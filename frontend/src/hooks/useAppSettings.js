import { useCallback, useEffect, useRef, useState } from "react";
import { getGlobalSettings, getGlobalSettingsPublic, getSettings, updateSettings } from "../api/settings.js";
import { DEFAULT_DISPLAY_CURRENCY } from "../constants/currencies.js";
import { isAdmin } from "../utils/helpers.js";
import { normalizeGlobalSettings, normalizePublicGlobalSettings } from "../utils/settingsNormalizer.js";
import { VISIBLE_IN_LIST_DEFAULTS } from "../components/pages/licenses/licenseColumns.js";

function detectBrowserSettings() {
  const numberFormatLocale = Intl.NumberFormat().resolvedOptions().locale || "en-US";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const dateParts = new Intl.DateTimeFormat(numberFormatLocale).formatToParts(new Date(2000, 11, 31));
  const dateOrder = dateParts.filter((part) => ["day", "month", "year"].includes(part.type)).map((part) => part.type).join("-");
  const dateFormat = dateOrder === "month-day-year"
    ? "MM/DD/YYYY"
    : dateOrder === "year-month-day"
      ? "YYYY-MM-DD"
      : "DD/MM/YYYY";
  return { numberFormatLocale, dateFormat, timeZone };
}

const BROWSER_SETTINGS = detectBrowserSettings();

const DEFAULT_USER_SETTINGS = {
  visibleInList: VISIBLE_IN_LIST_DEFAULTS,
  visibleInDetail: { supplier: true, costCentre: true, licenseType: true, licenseMetric: true, quantity: true, skuCode: true, unitPrice: true, totalPoPrice: true, notes: true, licenseRef: true },
  theme: "light",
  uiSize: "normal",
  displayCurrency: DEFAULT_DISPLAY_CURRENCY,
  numberFormatLocale: BROWSER_SETTINGS.numberFormatLocale,
  dateFormat: BROWSER_SETTINGS.dateFormat,
  timeFormat: "24h",
  timeZone: BROWSER_SETTINGS.timeZone,
  columnOrder: [],
  savedViews: [],
  renewalWorkbenchColumns: {},
  sidebarCollapsed: false,
};

const DEFAULT_GLOBAL_SETTINGS = {
  mandatoryFields: { invoice: false, eula: false, entitlement: false, purchaseOrder: false, quote: false, startDate: false, endDate: false, contractNumber: false, poNumber: false, invoiceNumber: false, contactEmail: false, costCentre: false, budgetOwnerEmail: false },
  authMethod: "mfa",
  sessionTimeout: 30,
  passwordMinLength: 12,
  storagePath: "",
  notificationDays: 30,
  managerEmail: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUsername: "",
  smtpPassword: "",
  smtpSender: "",
  smtpUseTls: true,
  notificationSendHour: 7,
  allowedEmailDomains: [],
  backupLocation: "./backups",
  backupEnabled: false,
  backupHour: 2,
  backupKeep: 10,
  auditLogRetentionDays: 90,
  emailEnabled: false,
  oidcEnabled: false,
  oidcAvailable: false,
  oidcDiscoveryUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  emailTemplateBudgetOwnerIntro: "",
  emailTemplateBudgetOwnerSignoff: "",
  emailTemplateManagerIntro: "",
};

export function useAppSettings({ showError }) {
  const [userSettings, setUserSettings] = useState(DEFAULT_USER_SETTINGS);
  const [globalSettings, setGlobalSettings] = useState(DEFAULT_GLOBAL_SETTINGS);
  const savedGlobalSettingsRef = useRef(null);
  const savedUserSettingsRef = useRef(null);

  const loadSettings = useCallback(async () => {
    const { data } = await getSettings();
    if (data) {
      setUserSettings((s) => {
        const next = {
          ...s,
          visibleInList: data.visible_in_list ? { ...VISIBLE_IN_LIST_DEFAULTS, ...data.visible_in_list } : s.visibleInList,
          visibleInDetail: data.visible_in_detail ?? s.visibleInDetail,
          theme: data.theme ?? s.theme,
          uiSize: data.ui_size ?? s.uiSize,
          displayCurrency: data.display_currency ?? s.displayCurrency,
          numberFormatLocale: data.number_format_locale ?? s.numberFormatLocale,
          dateFormat: data.date_format ?? s.dateFormat,
          timeFormat: data.time_format ?? s.timeFormat,
          timeZone: data.time_zone ?? s.timeZone,
          columnOrder: data.column_order ?? s.columnOrder,
          savedViews: data.saved_views ?? s.savedViews,
          renewalWorkbenchColumns: data.renewal_workbench_columns ?? s.renewalWorkbenchColumns,
          sidebarCollapsed: data.sidebar_collapsed ?? s.sidebarCollapsed,
        };
        savedUserSettingsRef.current = {
          theme: next.theme,
          uiSize: next.uiSize,
          displayCurrency: next.displayCurrency,
          numberFormatLocale: next.numberFormatLocale,
          dateFormat: next.dateFormat,
          timeFormat: next.timeFormat,
          timeZone: next.timeZone,
        };
        return next;
      });
    }
  }, []);

  const loadGlobalSettings = useCallback(async (user) => {
    if (isAdmin(user)) {
      const { data } = await getGlobalSettings();
      if (data) {
        setGlobalSettings((s) => {
          const next = normalizeGlobalSettings(data, s);
          savedGlobalSettingsRef.current = next;
          return next;
        });
      }
    } else {
      const { data } = await getGlobalSettingsPublic();
      if (data) {
        setGlobalSettings((s) => normalizePublicGlobalSettings(data, s));
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      userSettings.theme ?? "light"
    );
  }, [userSettings.theme]);

  useEffect(() => {
    const zoomMap = { normal: "1", large: "1.15", larger: "1.3" };
    document.documentElement.style.zoom = zoomMap[userSettings.uiSize] ?? "1";
  }, [userSettings.uiSize]);

  const handleSectionSaved = useCallback(({ global: globalSnapshot, user: userSnapshot } = {}) => {
    if (globalSnapshot) {
      savedGlobalSettingsRef.current = {
        ...(savedGlobalSettingsRef.current ?? {}),
        ...globalSnapshot,
      };
    }
    if (userSnapshot) {
      savedUserSettingsRef.current = {
        ...(savedUserSettingsRef.current ?? {}),
        ...userSnapshot,
      };
    }
  }, []);

  const handleSettingsDiscard = useCallback(() => {
    if (savedGlobalSettingsRef.current) {
      setGlobalSettings(prev => ({
        ...prev,
        ...savedGlobalSettingsRef.current,
      }));
    }
    if (savedUserSettingsRef.current) {
      setUserSettings(prev => ({
        ...prev,
        theme: savedUserSettingsRef.current.theme ?? prev.theme,
        uiSize: savedUserSettingsRef.current.uiSize ?? prev.uiSize,
        displayCurrency:
          savedUserSettingsRef.current.displayCurrency
          ?? prev.displayCurrency,
        numberFormatLocale:
          savedUserSettingsRef.current.numberFormatLocale
          ?? prev.numberFormatLocale,
        dateFormat:
          savedUserSettingsRef.current.dateFormat ?? prev.dateFormat,
        timeFormat:
          savedUserSettingsRef.current.timeFormat ?? prev.timeFormat,
        timeZone:
          savedUserSettingsRef.current.timeZone ?? prev.timeZone,
      }));
      document.documentElement.setAttribute(
        "data-theme",
        savedUserSettingsRef.current.theme ?? "light"
      );
    }
  }, []);

  const handleToggleSidebar = useCallback(async () => {
    const previousCollapsed = userSettings.sidebarCollapsed;
    const newCollapsed = !previousCollapsed;
    setUserSettings((s) => ({ ...s, sidebarCollapsed: newCollapsed }));
    const { error } = await updateSettings({
      sidebar_collapsed: newCollapsed,
    });
    if (error) {
      setUserSettings((s) => ({ ...s, sidebarCollapsed: previousCollapsed }));
      showError(error);
    }
  }, [showError, userSettings.sidebarCollapsed]);

  return {
    userSettings,
    setUserSettings,
    globalSettings,
    setGlobalSettings,
    loadSettings,
    loadGlobalSettings,
    handleSectionSaved,
    handleSettingsDiscard,
    handleToggleSidebar,
  };
}
