from fastapi import APIRouter, Depends, HTTPException, Response

from app.dependencies import require_admin
from app.models.user import User
from app.routes.settings_helpers import DbSession, get_or_create_global_settings

router = APIRouter(prefix="/api/settings/global", tags=["settings"])


@router.post("/trigger-notifications", status_code=200)
async def trigger_notifications(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> dict:
    from app.services.notification_sender import (
        run_daily_notifications,
    )

    gs = await get_or_create_global_settings(db)
    if not gs.smtp_host:
        raise HTTPException(
            status_code=422,
            detail="SMTP is not configured",
        )
    # A manual trigger is an explicit admin action and always runs (it is the
    # documented retry path when a scheduled run failed). The sender owns the
    # atomic claim and persists the attempt/outcome markers.
    summary = await run_daily_notifications(db)
    if summary.get("status") == "conflict":
        raise HTTPException(
            status_code=409,
            detail="A notification run is already in progress. Wait for it to finish before retrying.",
        )
    return summary


@router.post("/test-email", status_code=204, response_class=Response)
async def test_email_connection(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> Response:
    from app.services.email_service import send_test_email

    gs = await get_or_create_global_settings(db)
    if not gs.smtp_host:
        raise HTTPException(status_code=422, detail="SMTP host is not configured")
    if not gs.manager_email:
        raise HTTPException(
            status_code=422,
            detail="Manager email is not configured - set it in the Notifications section above",
        )
    from app.services.email_validation import email_domain, is_email_domain_allowed

    allowed = [d.strip() for d in (gs.allowed_email_domains or "").split(",") if d.strip()]
    if not is_email_domain_allowed(gs.manager_email, allowed):
        domain = email_domain(gs.manager_email) or "unknown"
        if allowed:
            raise HTTPException(
                status_code=422,
                detail=f"Manager email domain '{domain}' is not in the allowed domains whitelist",
            )
    try:
        await send_test_email(gs, gs.manager_email)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to send test email: {exc}",
        )
    return Response(status_code=204)
