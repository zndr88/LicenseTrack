import React from "react";
import { APP_VERSION } from "../../version.js";
import { ROLE_PERMISSIONS } from "../../constants/permissions.js";
import Icon from "../ui/Icon.jsx";

export default function Sidebar({ page, setPage, setSelectedId, currentUser, notifications: _notifications, collapsed, onToggleCollapse, userSettings: _userSettings, stats = { active: 0, pending: 0, expiring: 0, expired: 0, renewed: 0 } }) {
  const perms = ROLE_PERMISSIONS[currentUser.role];
  const role = currentUser.role;

  const allNavItems = [
    { id: "sourcing",       icon: "search", label: "Sourcing Overview", showIf: role !== "viewer" },
    { id: "pending-orders", icon: "clock",  label: "Pending Orders",    showIf: role !== "viewer" },
    { id: "renewal-workbench", icon: "refresh", label: "Renewals" },
    { id: "licenses",       icon: "list",   label: "License Overview" },
    { id: "contracts",      icon: "file",   label: "Contracts" },
    { id: "user-settings",  icon: "settings", label: "My Settings",    showIf: role === "viewer" },
  ].filter((item) => !(item.need && !perms[item.need]) && item.showIf !== false);

  const pipelineItems = allNavItems.filter((item) =>
    ["sourcing", "pending-orders", "renewal-workbench", "licenses"].includes(item.id)
  );
  const referenceItems = allNavItems.filter((item) =>
    ["contracts"].includes(item.id)
  );
  const bottomItems = allNavItems.filter((item) =>
    ["user-settings"].includes(item.id)
  );

  function renderNavItem(item) {
    const isActive = page === item.id;
    const pendingCount = item.id === "pending-orders" ? stats.pending : 0;

    return (
      <button
        key={item.id}
        type="button"
        className={`nav-item ${isActive ? "active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        aria-label={pendingCount > 0 ? `${item.label}, ${pendingCount} pending` : item.label}
        title={collapsed ? item.label : undefined}
        style={collapsed ? { justifyContent: "flex-end", padding: "10px 18px 10px 0", position: "relative" } : undefined}
        onClick={() => { setPage(item.id); setSelectedId(null); }}
      >
        <Icon name={item.icon} size={17} />
        {!collapsed && item.label}
        {pendingCount > 0 && (
          <span className="nav-badge" aria-hidden="true">{pendingCount}</span>
        )}
      </button>
    );
  }

  return (
    <nav className="sidebar" aria-label="Main navigation" style={{ width: 240, transition: "transform 0.2s ease", overflow: "hidden", transform: collapsed ? "translateX(-188px)" : "translateX(0)" }}>
      {/* Brand */}
      <div className="sb-brand" style={collapsed ? { padding: "16px 0", display: "flex", justifyContent: "flex-end", paddingRight: "13px" } : undefined}>
        <Icon name="file" size={24} color="var(--brand-color)" />
        {!collapsed && (
          <div className="sb-wordmark">
            <span className="sb-name">Software License Lifecycle Management</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="sb-nav" style={{ flex: 1, overflowY: "auto" }}>
        {/* Collapse toggle row — PIPELINE label */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "flex-end" : "space-between", padding: collapsed ? "6px 10px 2px 0" : "0 6px 0 0" }}>
          {!collapsed && <div className="sb-section-label" style={{ margin: 0 }}>PIPELINE</div>}
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", padding: 4, borderRadius: "var(--r)", display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-3)"; }}
            onFocus={(e) => { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--text)"; }}
            onBlur={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-3)"; }}
          >
            <Icon name={collapsed ? "chevrons-right" : "chevrons-left"} size={15} />
          </button>
        </div>

        {/* PIPELINE group: sourcing, pending-orders, licenses */}
        {pipelineItems.map(renderNavItem)}

        {/* REFERENCE label + group */}
        {!collapsed && <div className="sb-section-label" style={{ marginTop: 12 }}>REFERENCE</div>}
        {collapsed && <div style={{ height: 8 }} />}
        {referenceItems.map(renderNavItem)}

        {/* Bottom items (viewer-only My Settings) — no section label */}
        {bottomItems.map(renderNavItem)}
      </div>

      {/* Portfolio Condition widget */}
      {!collapsed && (
        <div className="sb-portfolio">
          <div className="sb-portfolio-label">PORTFOLIO CONDITION</div>
          <div className="sb-portfolio-rows">
            <div className="sb-portfolio-row">
              <span>Active</span>
              <span className="sb-portfolio-count sb-portfolio-active-val">{stats.active}</span>
            </div>
            <div className="sb-portfolio-row">
              <span>Pending</span>
              <span className="sb-portfolio-count">{stats.pending}</span>
            </div>
            <div className="sb-portfolio-row sb-portfolio-warn">
              <span>Expiring</span>
              <span className="sb-portfolio-count sb-portfolio-warn-val">
                {stats.expiring}
              </span>
            </div>
            <div className="sb-portfolio-row sb-portfolio-danger">
              <span>Expired</span>
              <span className="sb-portfolio-count sb-portfolio-danger-val">
                {stats.expired}
              </span>
            </div>
            <div className="sb-portfolio-row">
              <span>Renewed</span>
              <span className="sb-portfolio-count">{stats.renewed}</span>
            </div>
          </div>
        </div>
      )}

      {!collapsed && <div className="sb-version">v{APP_VERSION}</div>}
    </nav>
  );
}
