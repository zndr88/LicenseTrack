// frontend/src/components/licenses/detail/CompletenessFlagsSection.jsx
import Icon from "../../ui/Icon.jsx";
import Toggle from "../../ui/Toggle.jsx";
import Badge from "../../ui/Badge.jsx";
import DetailSectionHeader from "./DetailSectionHeader.jsx";

export default function CompletenessFlagsSection({
  license,
  perms,
  comp,
  isOpen,
  onToggle,
  onUpdate,
}) {
  return (
    <>
      <DetailSectionHeader sectionKey="completeness" title="Completeness &amp; Flags" isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="dp-section-body" id="dp-section-completeness">
          <div className="fs" style={{ marginBottom: 12 }}>
            <h4 style={{ fontSize: 12 }}><Icon name="check" size={13} color="var(--accent)" /> Completeness</h4>
            {comp.isExempt ? (
              <div className="dp-exempt-notice">
                <Badge type="gray">Exempt</Badge>
                <span style={{ marginLeft: 8 }}>This license is exempt from completeness requirements.</span>
              </div>
            ) : (
              comp.checks.map((c, i) => (
                <div key={i} className="dp-check-row"
                  style={{ borderBottom: i < comp.checks.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span className="dp-check-label" style={{ color: c.met ? "var(--text-2)" : "var(--orange)" }}>{c.field}</span>
                  {c.met ? <Icon name="check" size={13} color="var(--green)" /> : <span className="dp-missing">MISSING</span>}
                </div>
              ))
            )}
          </div>

          <div style={{ height: 1, background: "var(--border)", margin: "0 0 10px" }} />

          {!license.renewedToId && license.lifecycleStatus !== "pending_renewal" && (
            <div className="dp-toggle-row" style={{ background: license.retired ? "var(--orange-m)" : "var(--bg-2)", borderColor: license.retired ? "var(--orange-border)" : "var(--border)" }}>
              <div className="dp-toggle-inner">
                <Icon name="eye" size={14} color={license.retired ? "var(--orange)" : "var(--text-3)"} />
                <div>
                  <div className="dp-toggle-title" style={{ color: license.retired ? "var(--orange-text)" : "var(--text-2)" }}>Retired License</div>
                  <div className="dp-toggle-desc">{license.retired ? "Excluded from expiration alerts" : "Mark as retired to suppress alerts"}</div>
                </div>
              </div>
              {perms.canEdit && <Toggle value={license.retired || false} onChange={(v) => onUpdate(license.id, { retired: v })} />}
            </div>
          )}

          {!license.renewedToId && license.lifecycleStatus !== "pending_renewal" && (
            <div className="dp-toggle-row" style={{ background: license.lifecycleStatus === "legacy" ? "var(--bg-3)" : "var(--bg-2)", borderColor: license.lifecycleStatus === "legacy" ? "var(--border-strong)" : "var(--border)" }}>
              <div className="dp-toggle-inner">
                <Icon name="archive" size={14} color={license.lifecycleStatus === "legacy" ? "var(--text-2)" : "var(--text-3)"} />
                <div>
                  <div className="dp-toggle-title">Legacy License</div>
                  <div className="dp-toggle-desc">Mark as legacy to suppress alerts and exclude from active counts</div>
                </div>
              </div>
              {perms.canEdit && (
                <Toggle
                  value={license.lifecycleStatus === "legacy"}
                  onChange={(v) => onUpdate(license.id, { lifecycleStatus: v ? "legacy" : null })}
                />
              )}
            </div>
          )}
          {license.lifecycleStatus === "legacy" && (
            <div className="dp-legacy-notice">
              This license is marked as legacy and will not generate alerts.
            </div>
          )}

          {!license.renewedToId && license.lifecycleStatus !== "pending_renewal" && (
            <div className="dp-toggle-row" style={{ background: license.renewalNotificationsEnabled === false ? "var(--orange-m)" : "var(--bg-2)", borderColor: license.renewalNotificationsEnabled === false ? "var(--orange-border)" : "var(--border)" }}>
              <div className="dp-toggle-inner">
                <Icon name="bell" size={14} color={license.renewalNotificationsEnabled === false ? "var(--orange)" : "var(--text-3)"} />
                <div>
                  <div className="dp-toggle-title" style={{ color: license.renewalNotificationsEnabled === false ? "var(--orange-text)" : "var(--text-2)" }}>Renewal notifications</div>
                  <div className="dp-toggle-desc">{license.renewalNotificationsEnabled === false ? "Expiry emails are disabled for this license" : "Send expiry emails for this license"}</div>
                </div>
              </div>
              {perms.canEdit && (
                <Toggle
                  value={license.renewalNotificationsEnabled !== false}
                  ariaLabel="Toggle renewal notifications"
                  onChange={(v) => onUpdate(license.id, { renewalNotificationsEnabled: v })}
                />
              )}
            </div>
          )}

          {perms.canEdit && (
            <div className="dp-toggle-row" style={{ background: license.isCompletenessExempt ? "var(--bg-3)" : "var(--bg-2)", borderColor: license.isCompletenessExempt ? "var(--border-strong)" : "var(--border)" }}>
              <div className="dp-toggle-inner">
                <Icon name="shield" size={14} color={license.isCompletenessExempt ? "var(--text-2)" : "var(--text-3)"} />
                <div>
                  <div className="dp-toggle-title">Exempt from completeness</div>
                  <div className="dp-toggle-desc">Use for licenses where full documentation cannot be obtained</div>
                </div>
              </div>
              <Toggle value={license.isCompletenessExempt || false} onChange={(v) => onUpdate(license.id, { isCompletenessExempt: v })} />
            </div>
          )}

        </div>
      )}
      <div className="dp-section-divider" />
    </>
  );
}
