"""Notice reminder state shared by license update and import workflows."""

from datetime import date

from app.models.license import License


def clear_notice_handled_if_date_changed(license_obj: License, notice_date: date | None) -> None:
    """Treat a changed or cleared notice date as a new reminder obligation."""
    if notice_date == license_obj.notice_date:
        return
    license_obj.notice_handled_at = None
    license_obj.notice_handled_by_user_id = None
