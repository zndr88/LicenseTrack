import React from "react";
import Icon from "../ui/Icon.jsx";

function notificationKey(notification) {
  return [
    notification.license_id,
    notification.type,
    notification.relevant_date ?? "none",
  ].join(":");
}

export default function NotificationsPage({
  notifications,
  notificationData,
  notificationsLoading,
  notificationsError,
  notificationsFetching,
  onRetryNotifications,
  globalSettings,
  setSelectedId,
  setPage,
}) {
  const result = notificationData === undefined ? notifications : notificationData;
  const hasValidResult = Array.isArray(result);
  const notificationList = hasValidResult ? result : [];
  const showInitialLoading = notificationsLoading && !hasValidResult;
  const showError = Boolean(notificationsError) && !hasValidResult;

  return (
    <>
      <div className="page-header">
        <h2>Notifications</h2>
        <p>
          {hasValidResult ? `${notificationList.length} items need attention` : "Notification status unavailable"}
          {notificationsFetching && hasValidResult ? " - refreshing..." : ""}
        </p>
      </div>
      <div className="page-content">
        {showInitialLoading && (
          <div className="empty" role="status" aria-live="polite">
            <div className="spinner" />
            <h3>Loading notifications...</h3>
            <p>Checking the current license alerts.</p>
          </div>
        )}

        {showError && (
          <div className="lp-error" role="alert">
            <Icon name="alert" size={18} />
            <span>Notifications could not be loaded. {notificationsError}</span>
            <button type="button" className="lp-error-retry" onClick={onRetryNotifications}>
              Retry
            </button>
          </div>
        )}

        {notificationsError && hasValidResult && (
          <div className="lp-partial-warning" role="status">
            <Icon name="alert" size={14} />
            <span>Showing the last valid notification result. Refresh failed: {notificationsError}</span>
            <button type="button" className="lp-partial-retry" onClick={onRetryNotifications} disabled={notificationsFetching}>
              {notificationsFetching ? "Retrying..." : "Retry"}
            </button>
          </div>
        )}

        {!showInitialLoading && !showError && hasValidResult && notificationList.length === 0 && (
          <div className="empty">
            <Icon name="check" size={32} color="var(--green)" />
            <h3>All clear!</h3>
            <p>No issues found.</p>
          </div>
        )}

        {!showInitialLoading && !showError && hasValidResult && notificationList.length > 0 && (
          <div className="notifs">
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>
              In production, expiration alerts are emailed directly to budget owners. Notice deadline reminders and daily summaries go to: <strong style={{ color: "var(--text-2)" }}>{globalSettings.managerEmail}</strong>
            </div>
            {notificationList.map((notification) => {
              const colors = {
                expired: { bg: "var(--red-m)", fg: "var(--red)", label: "var(--red-text)", title: "Expired" },
                expiring: { bg: "var(--orange-m)", fg: "var(--orange)", label: "var(--orange-text)", title: "Expiring Soon" },
                notice_due: { bg: "var(--purple-dim)", fg: "var(--purple)", label: "var(--purple-text)", title: "Notice Deadline" },
                incomplete: { bg: "var(--orange-m)", fg: "var(--orange)", label: "var(--orange-text)", title: "Incomplete" },
              };
              const c = colors[notification.type] || colors.incomplete;
              const icon = notification.type === "incomplete" ? "alert" : "clock";
              return (
                <button
                  type="button"
                  key={notificationKey(notification)}
                  className="notif-card"
                  aria-label={`View license: ${notification.publisher} — ${notification.software_name}`}
                  onClick={() => { setSelectedId(notification.license_id); setPage("licenses"); }}
                >
                  <div className="notif-icon" style={{ background: c.bg }}>
                    <Icon name={icon} size={16} color={c.fg} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ color: c.label }}>{c.title}</h4>
                    <p>{notification.publisher} — {notification.software_name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{notification.detail}</p>
                    {notification.budget_owner_email && (notification.type === "expiring" || notification.type === "expired") && (
                      <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>Budget owner: {notification.budget_owner_email}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
