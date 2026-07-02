"""
Audit logging helpers.

log_event  — async helper that adds an AuditLog row to the session without committing.
             Callers commit as part of their own transaction.

diff_fields — synchronous helper that compares two field-value dicts and returns a
              human-readable diff string, or None if nothing meaningful changed.
"""

from contextvars import ContextVar
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.services.webhook_service import enqueue_webhook_deliveries

# Fields that are always excluded from diffs regardless of caller overrides.
_DEFAULT_EXCLUDE: set[str] = {
    "id",
    "created_at",
    "updated_at",
    "renewed_to_id",
    "renewed_from_id",
    "lifecycle_status",
    "coterm_predecessor_ids",
    "coterm_from_ids",
    "created_by",
}

_api_token_audit_context: ContextVar[dict | None] = ContextVar(
    "api_token_audit_context",
    default=None,
)


def set_api_token_audit_context(context: dict | None) -> None:
    """Store API-token context for audit entries emitted during the current request."""
    _api_token_audit_context.set(context)


def _with_api_token_detail(detail: str | None) -> str | None:
    context = _api_token_audit_context.get()
    if not context:
        return detail

    token_note = f"via API token: {context['name']} ({context['id']})"
    return f"{detail}\n{token_note}" if detail else token_note


async def log_event(
    db: AsyncSession,
    action: str,
    actor=None,  # app.models.user.User | None
    ip_address: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    target_label: str | None = None,
    detail: str | None = None,
) -> None:
    """
    Add an AuditLog entry to the session.

    Does NOT commit — the caller is responsible for committing as part of
    their own transaction so the audit row and the business change are atomic.
    """
    timestamp = datetime.now(timezone.utc)
    token_ctx = _api_token_audit_context.get()
    detail_with_context = _with_api_token_detail(detail)
    entry = AuditLog(
        timestamp=timestamp,
        actor_id=actor.id if actor is not None else None,
        actor_email=actor.email if actor is not None else "system",
        actor_token_id=token_ctx["id"] if token_ctx else None,
        actor_token_name=token_ctx["name"] if token_ctx else None,
        ip_address=ip_address,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_label=target_label,
        detail=detail_with_context,
    )
    db.add(entry)
    await enqueue_webhook_deliveries(
        db,
        event_type=action,
        payload={
            "event": action,
            "timestamp": timestamp.isoformat(),
            "actorEmail": entry.actor_email,
            "targetType": target_type,
            "targetId": target_id,
            "targetLabel": target_label,
            "detail": detail_with_context,
        },
    )


def format_audit_detail(
    mutation_type: str,
    context: dict[str, str | None],
    field_diffs: list[str] | None = None,
) -> str:
    """
    Build a structured, line-oriented audit detail string.

    Always emits mutationType first, followed by non-None key=value context
    lines in insertion order, then optional pre-formatted field diff lines.

    Callers must format field diffs as "field: old_value → new_value" to be
    consistent with diff_fields().
    """
    lines = [f"mutationType={mutation_type}"]
    for key, value in context.items():
        if value is not None:
            lines.append(f"{key}={value}")
    if field_diffs:
        lines.extend(field_diffs)
    return "\n".join(lines)


def diff_fields(
    before: dict,
    after: dict,
    exclude: set[str] | None = None,
) -> str | None:
    """
    Compare two field-value dicts and return a human-readable change summary.

    Returns None when there are no meaningful differences.
    The built-in _DEFAULT_EXCLUDE set is always applied; the caller may pass
    additional field names via *exclude*.
    """
    effective_exclude = _DEFAULT_EXCLUDE | (exclude or set())
    changes: list[str] = []
    for key in sorted(set(before) | set(after)):
        if key in effective_exclude:
            continue
        before_val = before.get(key)
        after_val = after.get(key)
        if before_val != after_val:
            changes.append(f"{key}: {before_val} → {after_val}")
    return "\n".join(changes) if changes else None
