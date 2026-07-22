from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from app.services.plugin_utils import int_list as _int_list

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.document import Document
from app.models.license import License
from app.models.pending_order import PendingOrder, PendingOrderStatus
from app.models.plugin import Plugin, PluginAction, PluginPermission
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.models.user import User
from app.schemas.plugin import (
    PluginActionActor,
    PluginActionInvokeResponse,
    PluginActionInvokeRuntimeRequest,
    PluginActionListItem,
    PluginActionsListResponse,
)
from app.services.access_service import can_view_license
from app.services.plugin_runtime_service import (
    PluginRuntimeError,
    build_runtime_access_context,
    invoke_plugin_runtime_action,
    register_runtime_action_scope,
    unregister_runtime_action_scope,
)
from app.services.plugin_suggestion_service import PluginSuggestionError, create_plugin_suggestions_from_runtime_output
from app.services.plugin_host_service import plugin_can_run


class PluginActionError(ValueError):
    """Raised when a plugin action cannot be discovered or invoked."""


ROLE_RANK = {"viewer": 0, "editor": 1, "admin": 2}
DOCUMENT_ROW_SLOT = "document.row.actions"
SLOT_TARGET_TYPES = {
    DOCUMENT_ROW_SLOT: {"license_document"},
    "sourcing.item.edit.actions": {"sourcing_item"},
    "sourcing.quote.add.actions": {"sourcing_quote_draft"},
    "pendingOrder.add.actions": {"pending_order_draft"},
    "pendingOrder.line.edit.actions": {"pending_order_item"},
    "pendingOrder.convert.actions": {"pending_order_conversion"},
    "license.add.review.actions": {"license_draft"},
}
TARGET_REQUIRED_PERMISSIONS = {
    "license_document": {"actions:invoke", "documents:read"},
    "sourcing_item": {"actions:invoke", "procurement:read"},
    "sourcing_quote_draft": {"actions:invoke"},
    "pending_order_draft": {"actions:invoke"},
    "pending_order_item": {"actions:invoke", "procurement:read"},
    "pending_order_conversion": {"actions:invoke", "procurement:read"},
    "license_draft": {"actions:invoke"},
}
SOURCING_ITEM_FIELD_MAP = {
    "publisherName": "publisher_name",
    "softwareDescription": "software_description",
    "quantity": "quantity",
    "estimatedUnitPrice": "estimated_unit_price",
    "estimatedTotalPrice": "estimated_total_price",
    "currency": "currency",
    "supplier": "supplier",
    "contactEmail": "contact_email",
    "notes": "notes",
    "status": "status",
    "isRenewal": "renewal_for_license_id",
}


@dataclass(frozen=True)
class PluginActionInvocationResult:
    response: PluginActionInvokeResponse
    audit_detail: str
    target_label: str


async def list_plugin_actions(
    db: AsyncSession,
    *,
    slot: str,
    target_type: str,
    target_id: str,
    actor: User,
) -> PluginActionsListResponse:
    if target_type not in SLOT_TARGET_TYPES.get(slot, set()):
        return PluginActionsListResponse(slot=slot, target_type=target_type, target_id=target_id, actions=[])

    try:
        context, _target_label = await _build_context(
            db, target_type=target_type, target_id=target_id, actor=actor, client_context={}
        )
    except PluginActionError:
        return PluginActionsListResponse(slot=slot, target_type=target_type, target_id=target_id, actions=[])
    required_permissions = set(TARGET_REQUIRED_PERMISSIONS[target_type])
    if _context_contains_document_access(context):
        required_permissions.add("documents:read")
    result = await db.execute(
        select(PluginAction)
        .join(Plugin)
        .options(
            selectinload(PluginAction.plugin).selectinload(Plugin.permissions),
            selectinload(PluginAction.plugin).selectinload(Plugin.runtime_status),
        )
        .where(
            Plugin.enabled.is_(True),
            Plugin.status == "enabled",
            PluginAction.enabled.is_(True),
            PluginAction.slot == slot,
        )
        .order_by(Plugin.name.asc(), PluginAction.label.asc(), PluginAction.action_key.asc())
    )
    actions = [
        _list_item(action)
        for action in result.scalars().all()
        if _role_allows(actor, action.required_role)
        and plugin_can_run(action.plugin)
        and _plugin_has_permissions(action.plugin, required_permissions)
        and action.plugin.runtime_status is not None
        and action.plugin.runtime_status.health == "healthy"
    ]
    return PluginActionsListResponse(slot=slot, target_type=target_type, target_id=target_id, actions=actions)


async def invoke_plugin_action(
    db: AsyncSession,
    *,
    plugin_key: str,
    action_key: str,
    target_type: str,
    target_id: str,
    client_context: dict[str, Any] | None = None,
    actor: User,
) -> PluginActionInvocationResult:
    action = await _get_action(db, plugin_key, action_key)
    if action is None:
        raise PluginActionError("Plugin action not found")
    plugin = action.plugin
    if not plugin_can_run(plugin):
        raise PluginActionError("Official Extension is not verified or developer mode is unavailable")
    if not plugin.enabled or plugin.status != "enabled" or not action.enabled:
        raise PluginActionError("Plugin action is not enabled")
    if target_type not in SLOT_TARGET_TYPES.get(action.slot, set()):
        raise PluginActionError("Plugin action does not support this target")
    if not _role_allows(actor, action.required_role):
        raise PluginActionError("User role cannot invoke this plugin action")
    if plugin.runtime_status is None or plugin.runtime_status.health != "healthy":
        raise PluginActionError("Plugin runtime is not healthy")

    context, target_label = await _build_context(
        db,
        target_type=target_type,
        target_id=target_id,
        actor=actor,
        client_context=client_context or {},
    )
    required_permissions = set(TARGET_REQUIRED_PERMISSIONS[target_type])
    if _context_contains_document_access(context):
        required_permissions.add("documents:read")
    if not _plugin_has_permissions(plugin, required_permissions):
        raise PluginActionError("Official Extension is missing required permission(s)")
    request_id = uuid4()
    context = build_runtime_access_context(plugin.key, str(request_id), context)
    runtime_payload = PluginActionInvokeRuntimeRequest(
        action_key=action.action_key,
        handler=action.handler,
        plugin_key=plugin.key,
        request_id=request_id,
        actor=PluginActionActor(id=actor.id, role=_role_value(actor)),
        context=context,
    )
    register_runtime_action_scope(plugin.key, str(request_id), context)
    try:
        raw_output = await invoke_plugin_runtime_action(
            db,
            plugin.key,
            action.handler,
            runtime_payload.model_dump(mode="json", by_alias=True),
            timeout_seconds=action.timeout_seconds,
        )
    except PluginRuntimeError as exc:
        raise PluginActionError(str(exc)) from exc
    finally:
        unregister_runtime_action_scope(plugin.key, str(request_id))

    try:
        suggestion_result = await create_plugin_suggestions_from_runtime_output(
            db,
            plugin=plugin,
            action_key=action.action_key,
            raw_output=raw_output,
            actor=actor,
        )
    except PluginSuggestionError as exc:
        raise PluginActionError(str(exc)) from exc

    status = str(raw_output.get("status") or "ok") if isinstance(raw_output, dict) else "ok"
    summary = raw_output.get("summary") if isinstance(raw_output, dict) else None
    draft_suggestions = None
    multi_items = None
    if target_type == "license_draft" and suggestion_result.suggestions:
        s0 = suggestion_result.suggestions[0]
        primary_fields = s0.suggested_fields or []
        raw_line_items = s0.line_items or []
        if raw_line_items:
            extra = [
                _suggestion_fields_to_dict(li.get("fields", []) if isinstance(li, dict) else [])
                for li in raw_line_items
            ]
            extra = [item for item in extra if item]
            if extra:
                multi_items = [_suggestion_fields_to_dict(primary_fields), *extra]
            else:
                draft_suggestions = primary_fields
        else:
            draft_suggestions = primary_fields
    if target_type in {"sourcing_quote_draft", "pending_order_draft"} and suggestion_result.suggestions:
        multi_items = [_suggestion_fields_to_dict(s.suggested_fields or []) for s in suggestion_result.suggestions]

    response = PluginActionInvokeResponse(
        plugin_key=plugin.key,
        action_key=action.action_key,
        request_id=request_id,
        status=status,
        summary=summary if isinstance(summary, str) else None,
        suggestions_created=len(suggestion_result.suggestions),
        raw_output=raw_output if isinstance(raw_output, dict) else {"value": raw_output},
        draft_suggestions=draft_suggestions,
        multi_items=multi_items,
    )
    audit_detail = "\n".join(
        [
            f"pluginKey={plugin.key}",
            f"actionKey={action.action_key}",
            f"handler={action.handler}",
            f"slot={action.slot}",
            f"targetType={target_type}",
            f"targetId={target_id}",
            f"requestId={request_id}",
            f"status={response.status}",
            f"suggestionsCreated={len(suggestion_result.suggestions)}",
            f"supersededPendingSuggestions={suggestion_result.superseded_count}",
        ]
    )
    return PluginActionInvocationResult(response=response, audit_detail=audit_detail, target_label=target_label)


async def _get_action(db: AsyncSession, plugin_key: str, action_key: str) -> PluginAction | None:
    result = await db.execute(
        select(PluginAction)
        .join(Plugin)
        .options(
            selectinload(PluginAction.plugin).selectinload(Plugin.permissions),
            selectinload(PluginAction.plugin).selectinload(Plugin.runtime_status),
        )
        .where(Plugin.key == plugin_key, PluginAction.action_key == action_key)
    )
    return result.scalar_one_or_none()


async def _build_context(
    db: AsyncSession,
    *,
    target_type: str,
    target_id: str,
    actor: User,
    client_context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    if target_type == "license_document":
        return await _build_license_document_context(db, target_id=target_id, actor=actor)
    if target_type == "sourcing_item":
        return await _build_sourcing_item_context(db, target_id=target_id, actor=actor)
    if target_type == "pending_order_item":
        return await _build_pending_order_item_context(db, target_id=target_id, actor=actor)
    if target_type == "pending_order_conversion":
        return await _build_pending_order_conversion_context(
            db, target_id=target_id, actor=actor, client_context=client_context
        )
    if target_type == "license_draft":
        return _build_license_draft_context(target_id=target_id, actor=actor, client_context=client_context)
    if target_type == "sourcing_quote_draft":
        return _build_sourcing_quote_draft_context(target_id=target_id, actor=actor, client_context=client_context)
    if target_type == "pending_order_draft":
        return _build_pending_order_draft_context(target_id=target_id, actor=actor, client_context=client_context)
    raise PluginActionError("Unsupported plugin action target")


async def _build_license_document_context(
    db: AsyncSession,
    *,
    target_id: str,
    actor: User,
) -> tuple[dict[str, Any], str]:
    try:
        document_id = int(target_id)
    except ValueError as exc:
        raise PluginActionError("Document target id must be an integer") from exc
    document = await db.get(Document, document_id)
    if document is None:
        raise PluginActionError("Document not found")
    license_obj = await db.get(License, document.license_id)
    if license_obj is None or not await can_view_license(actor, license_obj, db):
        raise PluginActionError("Document not found")
    return (
        {
            "targetType": "license_document",
            "targetId": str(document.id),
            "documentId": document.id,
            "licenseId": license_obj.id,
            "documentCategory": getattr(document.category, "value", document.category),
            "fileName": document.original_filename,
            "contentType": document.mime_type,
            "userRole": _role_value(actor),
        },
        document.original_filename,
    )


async def _build_sourcing_item_context(
    db: AsyncSession,
    *,
    target_id: str,
    actor: User,
) -> tuple[dict[str, Any], str]:
    _require_procurement_access(actor)
    item_id = _parse_int_target(target_id, "Sourcing item target id must be an integer")
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id == item_id)
        .options(selectinload(SourcingItem.sourcing_request).selectinload(SourcingRequest.quote_documents))
    )
    item = result.scalar_one_or_none()
    if item is None or item.status != SourcingStatus.sourcing:
        raise PluginActionError("Sourcing item not found")
    request = item.sourcing_request
    quote_documents = request.quote_documents if request is not None else []
    return (
        {
            "targetType": "sourcing_item",
            "targetId": str(item.id),
            "sourcingRequestId": item.sourcing_request_id,
            "sourcingItemId": item.id,
            "itemFields": _sourcing_item_fields(item),
            "quoteDocumentIds": [doc.id for doc in quote_documents],
            "userRole": _role_value(actor),
        },
        item.software_description,
    )


async def _build_pending_order_item_context(
    db: AsyncSession,
    *,
    target_id: str,
    actor: User,
) -> tuple[dict[str, Any], str]:
    _require_procurement_access(actor)
    item_id = _parse_int_target(target_id, "Pending order item target id must be an integer")
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id == item_id)
        .options(
            selectinload(SourcingItem.pending_order).selectinload(PendingOrder.documents),
            selectinload(SourcingItem.sourcing_request).selectinload(SourcingRequest.quote_documents),
        )
    )
    item = result.scalar_one_or_none()
    if (
        item is None
        or item.pending_order is None
        or item.pending_order.status not in {PendingOrderStatus.pending, PendingOrderStatus.invoice_received}
    ):
        raise PluginActionError("Pending order item not found")
    quote_documents = item.sourcing_request.quote_documents if item.sourcing_request is not None else []
    return (
        {
            "targetType": "pending_order_item",
            "targetId": str(item.id),
            "pendingOrderId": item.pending_order_id,
            "lineItemId": item.id,
            "lineFields": _sourcing_item_fields(item),
            "purchaseOrderDocumentIds": [doc.id for doc in item.pending_order.documents],
            "linkedSourcingContext": {
                "sourcingRequestId": item.sourcing_request_id,
                "quoteDocumentIds": [doc.id for doc in quote_documents],
            },
            "userRole": _role_value(actor),
        },
        item.software_description,
    )


async def _build_pending_order_conversion_context(
    db: AsyncSession,
    *,
    target_id: str,
    actor: User,
    client_context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    _require_procurement_access(actor)
    order_id = _parse_int_target(target_id, "Pending order conversion target id must be an integer")
    result = await db.execute(
        select(PendingOrder)
        .where(PendingOrder.id == order_id)
        .options(
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
            selectinload(PendingOrder.documents),
        )
    )
    order = result.scalar_one_or_none()
    if order is None or order.status not in {PendingOrderStatus.pending, PendingOrderStatus.invoice_received}:
        raise PluginActionError("Pending order not found")
    item_ids = {item.id for item in order.items if item.pending_order_id == order.id}
    requested_item_ids = _int_list(client_context.get("selectedLineItemIds"))
    selected_item_ids = requested_item_ids or sorted(item_ids)
    invalid_item_ids = [item_id for item_id in selected_item_ids if item_id not in item_ids]
    if invalid_item_ids:
        raise PluginActionError(f"Selected line item(s) are not part of this pending order: {invalid_item_ids}")

    po_document_ids = {doc.id for doc in order.documents}
    requested_document_ids = _int_list(client_context.get("documentIds"))
    invalid_document_ids = [doc_id for doc_id in requested_document_ids if doc_id not in po_document_ids]
    if invalid_document_ids:
        raise PluginActionError(f"Document(s) are not part of this pending order: {invalid_document_ids}")

    return (
        {
            "targetType": "pending_order_conversion",
            "targetId": str(order.id),
            "pendingOrderId": order.id,
            "selectedLineItemIds": selected_item_ids,
            "conversionDraftFields": _dict_or_empty(client_context.get("conversionDraftFields")),
            "documentIds": requested_document_ids or [doc.id for doc in order.documents],
            "lineItems": [
                _pending_order_conversion_item_context(item) for item in order.items if item.id in selected_item_ids
            ],
            "userRole": _role_value(actor),
        },
        order.po_number,
    )


def _build_license_draft_context(
    *,
    target_id: str,
    actor: User,
    client_context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    return (
        {
            "targetType": "license_draft",
            "targetId": str(target_id or "draft"),
            "draftId": str(target_id or "draft"),
            "stagedFileToken": _string_or_none(client_context.get("stagedFileToken")),
            "draftFields": _dict_or_empty(client_context.get("draftFields")),
            "documentIds": _int_list(client_context.get("documentIds")),
            "detectedDocumentCategory": _string_or_none(client_context.get("detectedDocumentCategory")),
            "userRole": _role_value(actor),
            "fileContentBase64": _string_or_none(client_context.get("fileContentBase64")),
            "fileName": _string_or_none(client_context.get("fileName")),
            "contentType": _string_or_none(client_context.get("contentType")),
        },
        "License draft",
    )


def _build_sourcing_quote_draft_context(
    *,
    target_id: str,
    actor: User,
    client_context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    return (
        {
            "targetType": "sourcing_quote_draft",
            "targetId": str(target_id or "draft"),
            "userRole": _role_value(actor),
            "fileContentBase64": _string_or_none(client_context.get("fileContentBase64")),
            "fileName": _string_or_none(client_context.get("fileName")),
            "contentType": _string_or_none(client_context.get("contentType")),
        },
        "Sourcing quote draft",
    )


def _build_pending_order_draft_context(
    *,
    target_id: str,
    actor: User,
    client_context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    return (
        {
            "targetType": "pending_order_draft",
            "targetId": str(target_id or "draft"),
            "userRole": _role_value(actor),
            "fileContentBase64": _string_or_none(client_context.get("fileContentBase64")),
            "fileName": _string_or_none(client_context.get("fileName")),
            "contentType": _string_or_none(client_context.get("contentType")),
        },
        "Pending order draft",
    )


def _parse_int_target(value: str, error_message: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise PluginActionError(error_message) from exc


def _sourcing_item_fields(item: SourcingItem) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for public_key, attr_name in SOURCING_ITEM_FIELD_MAP.items():
        value = getattr(item, attr_name)
        if public_key == "status":
            fields[public_key] = getattr(value, "value", value)
        elif public_key == "isRenewal":
            fields[public_key] = value is not None
        else:
            fields[public_key] = value
    return fields


def _pending_order_conversion_item_context(item: SourcingItem) -> dict[str, Any]:
    quote_documents = item.sourcing_request.quote_documents if item.sourcing_request is not None else []
    return {
        "lineItemId": item.id,
        "lineFields": _sourcing_item_fields(item),
        "linkedSourcingContext": {
            "sourcingRequestId": item.sourcing_request_id,
            "quoteDocumentIds": [doc.id for doc in quote_documents],
        },
    }


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _require_procurement_access(actor: User) -> None:
    if _role_value(actor) == "viewer":
        raise PluginActionError("User role cannot access procurement plugin actions")


def _list_item(action: PluginAction) -> PluginActionListItem:
    return PluginActionListItem(
        plugin_key=action.plugin.key,
        plugin_name=action.plugin.name,
        action_key=action.action_key,
        key=f"{action.plugin.key}:{action.action_key}",
        label=action.label,
        slot=action.slot,
        required_role=action.required_role,
        icon=action.icon,
        description=action.description,
    )


def _role_value(user: User) -> str:
    return str(getattr(user.role, "value", user.role))


def _role_allows(user: User, required_role: str) -> bool:
    return ROLE_RANK.get(_role_value(user), -1) >= ROLE_RANK.get(str(required_role), 99)


def _suggestion_fields_to_dict(fields: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for f in fields:
        field = f.get("field")
        value = f.get("value")
        confidence = f.get("confidence")
        if field and value is not None and value != "" and (confidence is None or confidence >= 0.1):
            result[field] = value
    return result


def _plugin_has_permissions(plugin: Plugin, required: set[str]) -> bool:
    granted = {
        permission.permission
        for permission in plugin.permissions
        if isinstance(permission, PluginPermission) and permission.granted
    }
    return required.issubset(granted)


def _context_contains_document_access(context: dict[str, Any]) -> bool:
    if context.get("fileContentBase64") or context.get("stagedFileToken"):
        return True
    document_keys = ("documentId", "documentIds", "quoteDocumentIds", "purchaseOrderDocumentIds")
    if any(context.get(key) for key in document_keys):
        return True
    linked = context.get("linkedSourcingContext")
    if isinstance(linked, dict) and linked.get("quoteDocumentIds"):
        return True
    line_items = context.get("lineItems")
    if isinstance(line_items, list):
        return any(
            isinstance(item, dict)
            and isinstance(item.get("linkedSourcingContext"), dict)
            and item["linkedSourcingContext"].get("quoteDocumentIds")
            for item in line_items
        )
    return False
