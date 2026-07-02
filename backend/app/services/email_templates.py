"""
Email HTML templates for automated license lifecycle notifications.

Functions:
  budget_owner_alert(licenses, manager_name) -> str
  manager_digest(notifications, settings) -> str
"""

from __future__ import annotations

from itertools import groupby
from typing import Any


# ---------------------------------------------------------------------------
# Shared chrome
# ---------------------------------------------------------------------------

_HEADER = """
<div style="background: #1e293b; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
  <h2 style="margin: 0; font-size: 20px; font-family: Arial, sans-serif;">Software License Lifecycle Management</h2>
  <p style="margin: 4px 0 0; opacity: 0.7; font-size: 13px; font-family: Arial, sans-serif;">{subtitle}</p>
</div>
"""

_FOOTER = """
<div style="padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0;
     border-radius: 0 0 8px 8px; font-size: 11px; color: #94a3b8; font-family: Arial, sans-serif;">
  This is an automated message from the license lifecycle management system. Your reply will reach the license management team.
</div>
"""

_WRAPPER_START = '<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px;">'
_WRAPPER_END = "</div>"

_BODY_START = '<div style="padding: 24px;">'
_BODY_END = "</div>"


def _severity_color(days_until_expiry: int | None) -> str:
    if days_until_expiry is None or days_until_expiry < 0:
        return "#ef4444"  # red — expired
    if days_until_expiry <= 30:
        return "#ef4444"  # red — critical
    if days_until_expiry <= 60:
        return "#f59e0b"  # amber — warning
    return "#3b82f6"  # blue — info


def _label_row(label: str, value: str) -> str:
    if not value:
        return ""
    return (
        f'<tr>'
        f'<td style="padding: 3px 12px 3px 0; color: #64748b; font-size: 12px; white-space: nowrap;">{label}</td>'
        f'<td style="padding: 3px 0; font-size: 12px; color: #1e293b;">{value}</td>'
        f'</tr>'
    )


# ---------------------------------------------------------------------------
# budget_owner_alert
# ---------------------------------------------------------------------------

_DEFAULT_BUDGET_INTRO = (
    "You are receiving this mail because the following software licenses "
    "under your ownership are about to expire or have already expired. "
    "Please verify if the following information is correct for renewal "
    "and let us know with a reply to this e-mail. Thank you."
)

_DEFAULT_BUDGET_SIGNOFF = "Kind regards,\nThe License Management Team"

_DEFAULT_MANAGER_INTRO = "Your daily license summary \u2014 {total} item(s) require attention."


def budget_owner_alert(
    licenses: list[dict[str, Any]],
    manager_name: str = "",
    intro_text: str | None = None,
    signoff_text: str | None = None,
) -> str:
    """
    HTML email sent to a budget owner about their expiring/expired licenses.

    Each dict in *licenses* should contain:
      software_description, publisher_name, start_date, end_date,
      days_until_expiry, quantity, cost_centre, contract_number,
      po_number, contact_email.

    Licenses are grouped by po_number in the output.
    """
    # Group licenses by PO number (empty PO becomes a catch-all group)
    sorted_lics = sorted(licenses, key=lambda l: l.get("po_number") or "")
    groups: dict[str, list] = {}
    for po, items in groupby(sorted_lics, key=lambda l: l.get("po_number") or ""):
        groups.setdefault(po, []).extend(items)

    th = (
        '<th style="background: #1e293b; color: white; font-size: 12px; '
        'padding: 8px 12px; text-align: left; white-space: nowrap;">'
    )

    table_header = (
        f"<tr>"
        f"{th}Publisher</th>"
        f"{th}Description</th>"
        f"{th}Quantity</th>"
        f"{th}Start date</th>"
        f"{th}End date</th>"
        f"{th}Department</th>"
        f"{th}Days remaining</th>"
        f"</tr>"
    )

    po_sections = ""
    for idx_po, (po_number, items) in enumerate(groups.items()):
        po_label = f"PO: {po_number}" if po_number else "No PO Number"
        po_sections += (
            f'<div style="margin-bottom: 24px;">'
            f'<div style="font-size: 12px; font-weight: bold; color: #64748b; '
            f'text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">{po_label}</div>'
            f'<table style="width: 100%; border-collapse: collapse;">'
            f"{table_header}"
        )
        for row_idx, lic in enumerate(items):
            days = lic.get("days_until_expiry")
            row_bg = "#ffffff" if row_idx % 2 == 0 else "#f8fafc"
            is_maintenance = lic.get("license_type") == "maintenance"
            description_display = lic.get("software_description", "")
            if is_maintenance and lic.get("parent_software_description"):
                description_display = (
                    f"{lic.get('software_description', '')} "
                    f"<span style='color: #7c3aed; font-weight: 600;'>"
                    f"[Maintenance: {lic.get('parent_software_description')}]"
                    f"</span>"
                )

            if days is None or days == "":
                days_text = "—"
                days_color = "#374151"
            elif days < 0:
                days_text = f"Expired {abs(days)} days ago"
                days_color = "#ef4444"
            elif days <= 30:
                days_text = f"{days} days"
                days_color = "#ef4444"
            elif days <= 60:
                days_text = f"{days} days"
                days_color = "#f59e0b"
            else:
                days_text = f"{days} days"
                days_color = "#374151"

            td = f'style="padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #e2e8f0; background: {row_bg};"'
            po_sections += (
                f"<tr>"
                f'<td {td}>{lic.get("publisher_name", "")}</td>'
                f'<td {td}>{description_display}</td>'
                f'<td {td}>{lic.get("quantity", "")}</td>'
                f'<td {td}>{lic.get("start_date", "")}</td>'
                f'<td {td}>{lic.get("end_date", "")}</td>'
                f'<td {td}>{lic.get("cost_centre", "")}</td>'
                f'<td style="padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #e2e8f0; '
                f'background: {row_bg}; color: {days_color}; font-weight: 600;">{days_text}</td>'
                f"</tr>"
            )
        po_sections += "</table></div>"

    intro = intro_text if intro_text is not None else _DEFAULT_BUDGET_INTRO
    signoff = signoff_text if signoff_text is not None else _DEFAULT_BUDGET_SIGNOFF
    signoff_html = signoff.replace("\n", "<br>")

    body = f"""
<p style="color: #374151; font-size: 14px; margin-bottom: 20px;">{intro}</p>
{po_sections}
<p style="color: #374151; font-size: 14px; margin-top: 24px;">{signoff_html}</p>
"""

    return (
        _WRAPPER_START
        + _HEADER.format(subtitle="License Expiration Alert")
        + _BODY_START
        + body
        + _BODY_END
        + _FOOTER
        + _WRAPPER_END
    )


# ---------------------------------------------------------------------------
# manager_digest
# ---------------------------------------------------------------------------

def manager_digest(
    notifications: list[dict[str, Any]],
    settings: dict[str, Any] | None = None,
    intro_text: str | None = None,
) -> str:
    """
    HTML daily summary sent to the manager email.

    Each dict in *notifications* should match the NotificationItem schema:
      license_id, software_name, publisher, type, detail, severity, relevant_date.
    """
    expired = [n for n in notifications if n.get("type") == "expired"]
    expiring = [n for n in notifications if n.get("type") == "expiring"]
    incomplete = [n for n in notifications if n.get("type") == "incomplete"]

    total = len(notifications)

    # ── Summary chips ──────────────────────────────────────────────────────
    def _chip(count: int, label: str, bg: str) -> str:
        return (
            f'<div style="display: inline-block; background: {bg}; color: white; '
            f'padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: bold; margin: 4px;">'
            f'{count} {label}</div>'
        )

    summary_row = (
        _chip(len(expired), "Expired", "#ef4444")
        + _chip(len(expiring), "Expiring Soon", "#f59e0b")
        + _chip(len(incomplete), "Incomplete", "#3b82f6")
    )

    # ── Notification row helper ────────────────────────────────────────────
    def _notif_row(n: dict) -> str:
        severity_colors = {"critical": "#ef4444", "warning": "#f59e0b", "info": "#3b82f6"}
        color = severity_colors.get(n.get("severity", "info"), "#3b82f6")
        days = n.get("days_until_expiry", 0)
        completeness_pct = n.get("completeness_pct", 0)
        notif_type = n.get("type", "")
        if notif_type == "expired":
            detail = f"Expired {abs(days)} days ago"
        elif notif_type == "expiring":
            detail = f"Expires in {days} days"
        elif notif_type == "incomplete":
            detail = f"{completeness_pct}% complete"
        else:
            detail = ""
        is_maintenance = n.get("license_type") == "maintenance"
        title_html = f'<div style="font-weight: 600; font-size: 13px; color: #1e293b;">{n.get("software_description", "")}</div>'
        if is_maintenance and n.get("parent_software_description"):
            title_html += (
                f'<div style="font-size: 11px; color: #7c3aed; margin-top: 2px;">'
                f'Maintenance for: {n.get("parent_software_description", "")}'
                f"</div>"
            )
        title_html += f'<div style="font-size: 11px; color: #64748b; margin-top: 2px;">{n.get("publisher_name", "")}</div>'
        return (
            f'<tr style="border-bottom: 1px solid #f1f5f9;">'
            f'<td style="padding: 10px 12px 10px 0;">'
            f"  {title_html}"
            f'</td>'
            f'<td style="padding: 10px 0; font-size: 12px; color: #374151;">{detail}</td>'
            f'<td style="padding: 10px 0 10px 12px; text-align: right;">'
            f'  <span style="background: {color}; color: white; font-size: 10px; font-weight: bold; '
            f'  padding: 2px 7px; border-radius: 4px;">{n.get("severity", "").upper()}</span>'
            f'</td>'
            f'</tr>'
        )

    def _section(title: str, items: list, color: str) -> str:
        if not items:
            return ""
        rows = "".join(_notif_row(n) for n in items)
        return f"""
<div style="margin-bottom: 24px;">
  <div style="font-size: 13px; font-weight: bold; color: {color};
       text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">{title}</div>
  <table style="width: 100%; border-collapse: collapse;">
    {rows}
  </table>
</div>"""

    if total == 0:
        body_content = (
            '<div style="text-align: center; padding: 32px 0; color: #64748b;">'
            '<div style="font-size: 32px; margin-bottom: 8px;">✓</div>'
            '<div style="font-size: 16px; font-weight: bold; color: #22c55e;">All Clear</div>'
            '<div style="font-size: 13px; margin-top: 4px;">No license issues found.</div>'
            '</div>'
        )
    else:
        intro_template = intro_text if intro_text is not None else _DEFAULT_MANAGER_INTRO
        intro_rendered = intro_template.replace("{total}", str(total))
        body_content = f"""
<p style="color: #374151; font-size: 14px; margin-bottom: 16px;">{intro_rendered}</p>
<div style="margin-bottom: 20px;">{summary_row}</div>
{_section("Expired Licenses", expired, "#ef4444")}
{_section("Expiring Soon", expiring, "#f59e0b")}
{_section("Incomplete Records", incomplete, "#3b82f6")}
"""

    return (
        _WRAPPER_START
        + _HEADER.format(subtitle="Daily License Summary")
        + _BODY_START
        + body_content
        + _BODY_END
        + _FOOTER
        + _WRAPPER_END
    )
