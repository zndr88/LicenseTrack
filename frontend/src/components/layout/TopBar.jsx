import React, { useState, useEffect, useRef } from "react";
import { ROLE_LABELS } from "../../constants/permissions.js";
import Icon from "../ui/Icon.jsx";

export default function TopBar({ page, onNavigate, currentUser, notifications, notificationsAvailable = false, notificationsLoading = false, onLogout, perms, onAddLicense }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const role = currentUser.role;
  const userDisplayName = currentUser.name || currentUser.username || "User";
  const userAvatar = currentUser.avatar || userDisplayName.slice(0, 2).toUpperCase();
  const showNotificationCount = notificationsAvailable && !notificationsLoading;

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleMouseDown(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [dropdownOpen]);

  const navItems = [
    {
      label: "Overview",
      target: "licenses",
      active: ["licenses", "sourcing", "pending-orders", "renewal-workbench", "contracts"].includes(page),
      hidden: false,
    },
    {
      label: "Import",
      target: "import",
      active: page === "import",
      hidden: role === "viewer",
    },
    {
      label: "Reports",
      target: "reports",
      active: page === "reports",
      hidden: false,
    },
    {
      label: "Admin",
      target: "admin",
      active: page === "admin",
      hidden: !perms.canAdminSettings,
    },
  ].filter((item) => !item.hidden);

  return (
    <header className="topbar">
      {/* Left zone: nav items */}
      {navItems.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`topbar-nav-item${item.active ? " active" : ""}`}
          onClick={() => onNavigate(item.target)}
        >
          {item.label}
        </button>
      ))}

      {/* Center spacer */}
      <div className="topbar-spacer" />

      {/* Add License button */}
      {perms.canUpload && onAddLicense && (
        <button className="topbar-add-btn" type="button" onClick={onAddLicense}>
          <Icon name="plus" size={14} />
          Add License
        </button>
      )}

      {/* Right zone */}
      <div className="topbar-right">
        {/* Notifications bell */}
        <button
          type="button"
          className={`topbar-icon-btn${page === "help" ? " active" : ""}`}
          aria-label="Open help center"
          title="Help"
          onClick={() => onNavigate("help")}
        >
          <Icon name="circle-help" size={17} />
        </button>

        <button
          type="button"
          className="topbar-icon-btn"
          aria-label={`Notifications${showNotificationCount && notifications.length > 0 ? ` (${notifications.length})` : ""}`}
          onClick={() => onNavigate("notifications")}
        >
          <Icon name="bell" size={17} />
          {showNotificationCount && notifications.length > 0 && (
            <span className="topbar-badge">{notifications.length}</span>
          )}
        </button>

        {/* Avatar + dropdown */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="topbar-avatar-btn"
            aria-label={`${userDisplayName} - open user menu`}
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
            onClick={() => setDropdownOpen((o) => !o)}
          >
            {userAvatar}
          </button>

          {dropdownOpen && (
            <div className="topbar-dropdown" role="menu">
              <div className="topbar-dropdown-header">
                <div className="dd-name">{userDisplayName}</div>
                <div className="dd-role">{ROLE_LABELS[currentUser.role]}</div>
              </div>
              <hr />
              <button
                type="button"
                className="topbar-dropdown-item"
                role="menuitem"
                onClick={() => { onNavigate("user-settings"); setDropdownOpen(false); }}
              >
                My Settings
              </button>
              <button
                type="button"
                className="topbar-dropdown-item"
                role="menuitem"
                onClick={() => { onLogout(); setDropdownOpen(false); }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
