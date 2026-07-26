import React, { useState, useEffect } from "react";
import Icon from "../ui/Icon.jsx";
import { getLicenses } from "../../api/licenses.js";
import { normalizeLicense } from "../../utils/helpers.js";

export default function NotificationsPage({ notifications, globalSettings, setSelectedId, setPage }) {
  const [licenses, setLicenses] = useState([]);

  useEffect(() => {
    getLicenses({ includeRetired: true }).then(({ data }) => {
      if (data) setLicenses((data ?? []).map(normalizeLicense));
    });
  }, []);
  return (
    <>
      <div className="page-header"><h2>Notifications</h2><p>{notifications.length} items need attention</p></div>
      <div className="page-content">
        {notifications.length === 0 ? (
          <div className="empty"><Icon name="check" size={32} color="var(--green)" /><h3>All clear!</h3><p>No issues found.</p></div>
        ) : (
          <div className="notifs">
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>
              In production, expiration alerts emailed directly to budget owners. Notice deadline reminders and daily summaries go to: <strong style={{ color: "var(--text-2)" }}>{globalSettings.managerEmail}</strong>
            </div>
            {notifications.map((n, i) => {
              const colors = {
                expired: { bg: "var(--red-m)", fg: "var(--red)", label: "var(--red-text)", title: "Expired" },
                expiring: { bg: "var(--orange-m)", fg: "var(--orange)", label: "var(--orange-text)", title: "Expiring Soon" },
                notice_due: { bg: "var(--purple-dim)", fg: "var(--purple)", label: "var(--purple-text)", title: "Notice Deadline" },
                incomplete: { bg: "var(--orange-m)", fg: "var(--orange)", label: "var(--orange-text)", title: "Incomplete" },
              };
              const c = colors[n.type] || colors.incomplete;
              const icon = n.type === "incomplete" ? "alert" : "clock";
              const budgetLicense = licenses.find((l) => l.id === n.license_id);
              return (
                <button type="button" key={i} className="notif-card" aria-label={`View license: ${n.publisher} — ${n.software_name}`} onClick={() => { setSelectedId(n.license_id); setPage("licenses"); }} onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); setSelectedId(n.license_id); setPage("licenses"); } }}>
                  <div className="notif-icon" style={{ background: c.bg }}>
                    <Icon name={icon} size={16} color={c.fg} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ color: c.label }}>{c.title}</h4>
                    <p>{n.publisher} — {n.software_name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{n.detail}</p>
                    {budgetLicense?.budgetOwnerEmail && (n.type === "expiring" || n.type === "expired") && (
                      <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>Budget owner: {budgetLicense.budgetOwnerEmail}</p>
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
