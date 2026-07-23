import { useState } from "react";
import { updateSettings } from "../../../api/settings.js";
import {
  NUMBER_FORMAT_OPTIONS,
  normalizeNumberFormatOptionValue,
} from "../../../constants/numberFormats.js";
import { SectionHeader } from "../SectionShared.jsx";
import { formatDate, formatMoney, formatDateTime } from "../../../utils/formatting.js";

const PREVIEW_DATE = "2025-12-31";
const PREVIEW_AMOUNT = "1234567.89";
const PREVIEW_ISO_DT = "2025-12-31T14:30:00Z";
const TIME_ZONES = ["UTC", ...(Intl.supportedValuesOf?.("timeZone") ?? [])];

export default function AppearanceSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, userSettings, setUserSettings, onError, onToast, onRefreshLicenses, navGuard }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await updateSettings({
      visible_in_list: userSettings.visibleInList,
      visible_in_detail: userSettings.visibleInDetail,
      theme: userSettings.theme,
      ui_size: userSettings.uiSize,
      display_currency: userSettings.displayCurrency,
      number_format_locale: userSettings.numberFormatLocale,
      date_format: userSettings.dateFormat,
      time_format: userSettings.timeFormat,
      time_zone: userSettings.timeZone,
      column_order: userSettings.columnOrder,
      saved_views: userSettings.savedViews,
      sidebar_collapsed: userSettings.sidebarCollapsed,
    });
    setSaving(false);
    if (error) { onError(error); return; }
    document.documentElement.setAttribute("data-theme", userSettings.theme);
    navGuard?.sectionSaved?.({
      user: {
        theme: userSettings.theme,
        uiSize: userSettings.uiSize,
        displayCurrency: userSettings.displayCurrency,
        numberFormatLocale: userSettings.numberFormatLocale,
        dateFormat: userSettings.dateFormat,
        timeFormat: userSettings.timeFormat,
        timeZone: userSettings.timeZone,
      },
    });
    clearDirty("appearance");
    if (onRefreshLicenses) onRefreshLicenses();
    onToast("Settings saved.", "info");
  };

  const set = (key, val) => { setUserSettings(s => ({ ...s, [key]: val })); markDirty("appearance"); };

  const previewDate = formatDate(PREVIEW_DATE, userSettings);
  const previewMoney = formatMoney(PREVIEW_AMOUNT, userSettings.displayCurrency ?? "EUR", userSettings);
  const previewDT = formatDateTime(PREVIEW_ISO_DT, userSettings);

  return (
    <div className="setsec">
      <SectionHeader sectionKey="appearance" icon="eye" title="Appearance" description="Theme preference (per-user)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div className="set-section-stack">
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-theme">Theme</label>
                <select id="settings-theme" className="fi fi-select" value={userSettings.theme} onChange={(e) => set("theme", e.target.value)}>
                  <option value="light">Light</option>
                  <option value="gray">Gray</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div className="fg">
                <label htmlFor="settings-ui-size">UI Size</label>
                <select id="settings-ui-size" className="fi fi-select" value={userSettings.uiSize ?? "normal"} onChange={(e) => set("uiSize", e.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="large">Large (115%)</option>
                  <option value="larger">Larger (130%)</option>
                </select>
              </div>
              <div className="fg">
                <label htmlFor="settings-display-currency">Display Currency</label>
                <select id="settings-display-currency" className="fi fi-select" value={userSettings.displayCurrency} onChange={(e) => set("displayCurrency", e.target.value)}>
                  <option value="EUR">EUR - Euro</option>
                  <option value="USD">USD - US Dollar</option>
                  <option value="GBP">GBP - British Pound</option>
                  <option value="CHF">CHF - Swiss Franc</option>
                  <option value="SEK">SEK - Swedish Krona</option>
                  <option value="NOK">NOK - Norwegian Krone</option>
                  <option value="DKK">DKK - Danish Krone</option>
                  <option value="PLN">PLN - Polish Zloty</option>
                  <option value="CZK">CZK - Czech Koruna</option>
                  <option value="HUF">HUF - Hungarian Forint</option>
                  <option value="AUD">AUD - Australian Dollar</option>
                  <option value="CAD">CAD - Canadian Dollar</option>
                  <option value="JPY">JPY - Japanese Yen</option>
                </select>
              </div>
              <div className="fg">
                <label htmlFor="settings-number-format">Number Format</label>
                <select id="settings-number-format" className="fi fi-select" value={normalizeNumberFormatOptionValue(userSettings.numberFormatLocale)} onChange={(e) => set("numberFormatLocale", e.target.value)}>
                  {NUMBER_FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fr">
              <div className="fg">
                <label htmlFor="settings-date-format">Date Format</label>
                <select id="settings-date-format" className="fi fi-select" value={userSettings.dateFormat ?? "DD/MM/YYYY"} onChange={(e) => set("dateFormat", e.target.value)}>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>
              <div className="fg">
                <label htmlFor="settings-time-format">Time Format</label>
                <select id="settings-time-format" className="fi fi-select" value={userSettings.timeFormat ?? "24h"} onChange={(e) => set("timeFormat", e.target.value)}>
                  <option value="24h">24-hour (14:30)</option>
                  <option value="12h">12-hour (2:30 PM)</option>
                </select>
              </div>
              <div className="fg">
                <label htmlFor="settings-time-zone">Time Zone</label>
                <select id="settings-time-zone" className="fi fi-select" value={userSettings.timeZone ?? "UTC"} onChange={(e) => set("timeZone", e.target.value)}>
                  {TIME_ZONES.map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone}</option>)}
                </select>
              </div>
            </div>
            <div className="set-appearance-preview">
              <strong>Preview:</strong>
              {" "}{previewDate}{" - "}{previewMoney}{" - "}{previewDT}
            </div>
            <div className="set-save-row">
              <button className="btn btn-p set-save-button" disabled={!isDirty || saving} onClick={handleSave}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
