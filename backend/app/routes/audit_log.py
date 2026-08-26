"""
Audit log endpoints (admin only).

GET  /api/audit-log         - paginated list with filters
GET  /api/audit-log/export  - CSV download (same filters, no pagination)
"""

import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_admin
from app.models.audit_log import AuditLog
from app.models.user import User
from app.services.csv_safety import safe_csv_row
from app.services.audit_service import log_event

router = APIRouter(prefix="/api/audit-log", tags=["audit-log"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AuditLogEntry(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: int
    timestamp: datetime
    actor_email: str
    actor_token_id: Optional[int] = None
    actor_token_name: Optional[str] = None
    ip_address: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    target_label: Optional[str] = None
    detail: Optional[str] = None


class AuditLogPage(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[AuditLogEntry]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_query(
    actor_email: str | None,
    action: str | None,
    date_from: date | None,
    date_to: date | None,
    search: str | None,
    actor_token_id: int | None = None,
):
    """Build a filtered SQLAlchemy select for AuditLog rows."""
    q = select(AuditLog).order_by(AuditLog.timestamp.desc())

    if actor_email:
        q = q.where(AuditLog.actor_email.ilike(f"%{actor_email}%"))
    if action:
        action_parts = [part.strip() for part in action.split(",") if part.strip()]
        if len(action_parts) > 1:
            q = q.where(or_(*(AuditLog.action.ilike(f"{part}.%") for part in action_parts)))
        elif action_parts:
            q = q.where(AuditLog.action.ilike(f"%{action_parts[0]}%"))
    if date_from:
        q = q.where(AuditLog.timestamp >= datetime(date_from.year, date_from.month, date_from.day, tzinfo=timezone.utc))
    if date_to:
        # Include the full day_to by going to end of day
        next_day = date_to + timedelta(days=1)
        q = q.where(AuditLog.timestamp < datetime(next_day.year, next_day.month, next_day.day, tzinfo=timezone.utc))
    if search:
        pattern = f"%{search}%"
        q = q.where(
            or_(
                AuditLog.target_label.ilike(pattern),
                AuditLog.detail.ilike(pattern),
                AuditLog.actor_email.ilike(pattern),
                AuditLog.actor_token_name.ilike(pattern),
            )
        )
    if actor_token_id is not None:
        q = q.where(AuditLog.actor_token_id == actor_token_id)
    return q


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=AuditLogPage)
async def list_audit_log(
    db: DbSession,
    _admin: User = Depends(require_admin),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    actor_email: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    search: Optional[str] = Query(default=None),
    actor_token_id: Optional[int] = Query(default=None),
) -> AuditLogPage:
    """Paginated audit log (admin only)."""
    base_q = _build_query(actor_email, action, date_from, date_to, search, actor_token_id)

    # Count total
    count_q = select(func.count()).select_from(base_q.subquery())
    total = await db.scalar(count_q) or 0

    # Fetch page
    offset = (page - 1) * page_size
    rows_q = base_q.offset(offset).limit(page_size)
    result = await db.execute(rows_q)
    entries = [AuditLogEntry.model_validate(row) for row in result.scalars().all()]

    return AuditLogPage(total=total, page=page, page_size=page_size, results=entries)


@router.get("/export")
async def export_audit_log(
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
    actor_email: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    search: Optional[str] = Query(default=None),
    actor_token_id: Optional[int] = Query(default=None),
) -> StreamingResponse:
    """Download all matching audit log entries as CSV (admin only)."""
    q = _build_query(actor_email, action, date_from, date_to, search, actor_token_id)
    result = await db.execute(q)
    rows = list(result.scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "timestamp",
            "actor_email",
            "actor_token_id",
            "actor_token_name",
            "ip_address",
            "action",
            "target_type",
            "target_id",
            "target_label",
            "detail",
        ]
    )
    for row in rows:
        writer.writerow(
            safe_csv_row(
                [
                    row.timestamp.isoformat() if row.timestamp else "",
                    row.actor_email,
                    str(row.actor_token_id) if row.actor_token_id is not None else "",
                    row.actor_token_name or "",
                    row.ip_address or "",
                    row.action,
                    row.target_type or "",
                    row.target_id or "",
                    row.target_label or "",
                    row.detail or "",
                ]
            )
        )

    output.seek(0)
    await log_event(
        db,
        "audit_log.csv_exported",
        actor=_admin,
        ip_address=request.client.host if request.client else None,
        target_type="audit_log_export",
        detail=f"rowCount={len(rows)}\nactionFilter={action or ''}\noutcome=success",
    )
    await db.commit()
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_log.csv"},
    )
