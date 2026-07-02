import { useState, useEffect } from "react";
import { updateSettings, listCustomFields } from "../../../api/settings.js";
import {
  LICENSE_COLUMN_GROUPS,
  SETTINGS_COLUMN_DEFS,
} from "../../pages/licenses/licenseColumns.js";
import Toggle from "../../ui/Toggle.jsx";
import { SectionHeader } from "../SectionShared.jsx";

const unavailable = <span style={{ fontSize: 10, color: "var(--text-3)" }}>-</span>;

export default function VisibleCategoriesSection({ isOpen, isDirty, onToggle, markDirty, clearDirty, userSettings, setUserSettings, onError, onToast, onAfterSave }) {
  const [saving, setSaving] = useState(false);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customFieldDefsLoading, setCustomFieldDefsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCustomFieldDefsLoading(true);
    listCustomFields().then(({ data, error }) => {
      setCustomFieldDefsLoading(false);
      if (!error && data) setCustomFieldDefs(data);
    });
  }, [isOpen]);

  const toggleList = (key, value) => {
    setUserSettings((settings) => ({ ...settings, visibleInList: { ...settings.visibleInList, [key]: value } }));
    markDirty("visibleCategories");
  };

  const toggleDetail = (key, value) => {
    setUserSettings((settings) => ({ ...settings, visibleInDetail: { ...settings.visibleInDetail, [key]: value } }));
    markDirty("visibleCategories");
  };

  const toggleListGroup = (columns, value) => {
    setUserSettings((settings) => ({
      ...settings,
      visibleInList: columns.reduce((visibleInList, column) => ({
        ...visibleInList,
        [column.settingsKey ?? column.key]: value,
      }), settings.visibleInList),
    }));
    markDirty("visibleCategories");
  };

  const toggleDetailGroup = (columns, value) => {
    setUserSettings((settings) => ({
      ...settings,
      visibleInDetail: columns.reduce((visibleInDetail, column) => ({
        ...visibleInDetail,
        [column.detailKey]: value,
      }), settings.visibleInDetail),
    }));
    markDirty("visibleCategories");
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await updateSettings({
      visible_in_list: userSettings.visibleInList,
      visible_in_detail: userSettings.visibleInDetail,
      theme: userSettings.theme,
      display_currency: userSettings.displayCurrency,
      number_format_locale: userSettings.numberFormatLocale,
      column_order: userSettings.columnOrder,
      saved_views: userSettings.savedViews,
      sidebar_collapsed: userSettings.sidebarCollapsed,
    });
    setSaving(false);
    if (error) { onError(error); return; }
    onAfterSave?.({ visibleInList: userSettings.visibleInList, visibleInDetail: userSettings.visibleInDetail });
    clearDirty("visibleCategories");
    onToast("Settings saved.", "info");
  };

  return (
    <div className="setsec">
      <SectionHeader sectionKey="visibleCategories" icon="columns" title="Visible Categories" description="Control which optional fields appear in the list overview vs. the license detail panel (per-user)" isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <div style={{ marginTop: 12 }}>
            <div className="set-vis-grid" style={{ marginBottom: 4 }}>
              <div className="set-vis-hd" style={{ color: "var(--text-3)" }}>Category</div>
              <div className="set-vis-hd" style={{ color: "var(--accent)", textAlign: "center" }}>List View</div>
              <div className="set-vis-hd" style={{ color: "var(--green)", textAlign: "center" }}>Details</div>
            </div>
            {LICENSE_COLUMN_GROUPS.map((group) => (
              <div key={group.key}>
                {(() => {
                  const groupColumns = SETTINGS_COLUMN_DEFS.filter((column) => column.group === group.key);
                  const detailColumns = groupColumns.filter((column) => column.detailKey);
                  const allListVisible = groupColumns.every((column) => userSettings.visibleInList[column.settingsKey ?? column.key] ?? column.defaultVisible ?? false);
                  const allDetailsVisible = detailColumns.length > 0 && detailColumns.every((column) => userSettings.visibleInDetail[column.detailKey] ?? true);
                  return (
                    <>
                <div className="set-vis-row" style={{ marginTop: 8, background: "var(--bg-2)" }}>
                  <strong className="set-vis-label" style={{ color: "var(--text-2)" }}>{group.label} <span style={{ color: "var(--text-3)", fontSize: 11, fontWeight: 400 }}>(toggle all)</span></strong>
                  <div className="col-center"><Toggle ariaLabel={`Toggle all ${group.label} list fields`} value={allListVisible} onChange={(value) => toggleListGroup(groupColumns, value)} /></div>
                  <div className="col-center">{detailColumns.length > 0 ? <Toggle ariaLabel={`Toggle all ${group.label} detail fields`} value={allDetailsVisible} onChange={(value) => toggleDetailGroup(detailColumns, value)} /> : unavailable}</div>
                </div>
                {groupColumns.map((column) => {
                  const listKey = column.settingsKey ?? column.key;
                  return (
                    <div key={listKey} className="set-vis-row">
                      <span className="set-vis-label">{column.settingsLabel ?? column.label}</span>
                      <div className="col-center">
                        <Toggle ariaLabel={`Show ${column.settingsLabel ?? column.label} in list view`} value={userSettings.visibleInList[listKey] ?? column.defaultVisible ?? false} onChange={(value) => toggleList(listKey, value)} />
                      </div>
                      <div className="col-center">
                        {column.detailKey
                          ? <Toggle ariaLabel={`Show ${column.settingsLabel ?? column.label} in details`} value={userSettings.visibleInDetail[column.detailKey] ?? true} onChange={(value) => toggleDetail(column.detailKey, value)} />
                          : unavailable}
                      </div>
                    </div>
                  );
                })}
                    </>
                  );
                })()}
              </div>
            ))}
            <div className="set-vis-row" style={{ marginTop: 8, background: "var(--bg-2)" }}>
              <strong className="set-vis-label" style={{ color: "var(--text-2)" }}>Custom Fields <span style={{ color: "var(--text-3)", fontSize: 11, fontWeight: 400 }}>(toggle all)</span></strong>
              <div className="col-center">{customFieldDefs.length > 0 ? <Toggle ariaLabel="Toggle all Custom Fields list fields" value={customFieldDefs.every((fieldDef) => userSettings.visibleInList[`cf_${fieldDef.fieldKey}`] ?? false)} onChange={(value) => toggleListGroup(customFieldDefs.map((fieldDef) => ({ key: `cf_${fieldDef.fieldKey}` })), value)} /> : unavailable}</div>
              <div className="col-center">{customFieldDefs.length > 0 ? <Toggle ariaLabel="Toggle all Custom Fields detail fields" value={customFieldDefs.every((fieldDef) => userSettings.visibleInDetail[`cf_${fieldDef.fieldKey}`] ?? true)} onChange={(value) => toggleDetailGroup(customFieldDefs.map((fieldDef) => ({ detailKey: `cf_${fieldDef.fieldKey}` })), value)} /> : unavailable}</div>
            </div>
            {customFieldDefsLoading && <div style={{ fontSize: 11, color: "var(--text-3)", padding: "6px 0" }}>Loading custom fields...</div>}
            {!customFieldDefsLoading && customFieldDefs.length === 0 && (
              <div className="set-vis-row" style={{ opacity: 0.45 }}>
                <span className="set-vis-label" style={{ fontStyle: "italic", color: "var(--text-3)" }}>No custom fields defined</span>
                <div className="col-center">{unavailable}</div>
                <div className="col-center">{unavailable}</div>
              </div>
            )}
            {!customFieldDefsLoading && customFieldDefs.map((fieldDef) => {
              const cfKey = `cf_${fieldDef.fieldKey}`;
              return (
                <div key={fieldDef.id} className="set-vis-row">
                  <span className="set-vis-label">{fieldDef.name}</span>
                  <div className="col-center"><Toggle ariaLabel={`Show ${fieldDef.name} in list view`} value={userSettings.visibleInList[cfKey] ?? false} onChange={(value) => toggleList(cfKey, value)} /></div>
                  <div className="col-center"><Toggle ariaLabel={`Show ${fieldDef.name} in details`} value={userSettings.visibleInDetail[cfKey] ?? true} onChange={(value) => toggleDetail(cfKey, value)} /></div>
                </div>
              );
            })}
            <div className="set-save-row">
              <button className="btn btn-p" onClick={handleSave} disabled={!isDirty || saving} style={{ fontSize: 13 }}>
                {saving && isDirty ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
