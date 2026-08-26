from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_admin
from app.models.user import User
from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.schemas.webhook import (
    WebhookDeliveryResponse,
    WebhookEndpointCreate,
    WebhookEndpointCreateResponse,
    WebhookEndpointResponse,
    WebhookEndpointUpdate,
)
from app.services.audit_service import log_event
from app.services.webhook_service import (
    decode_events,
    deliver_webhook_delivery,
    encode_events,
    encrypt_signing_secret,
    generate_signing_secret,
)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _serialize_endpoint(endpoint: WebhookEndpoint) -> WebhookEndpointResponse:
    return WebhookEndpointResponse(
        id=endpoint.id,
        name=endpoint.name,
        url=endpoint.url,
        events=decode_events(endpoint),
        is_active=endpoint.is_active,
        created_by=endpoint.created_by,
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
        last_success_at=endpoint.last_success_at,
        last_failure_at=endpoint.last_failure_at,
    )


@router.get("", response_model=list[WebhookEndpointResponse])
async def list_webhook_endpoints(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[WebhookEndpointResponse]:
    result = await db.execute(
        select(WebhookEndpoint).order_by(WebhookEndpoint.created_at.desc(), WebhookEndpoint.id.desc())
    )
    return [_serialize_endpoint(endpoint) for endpoint in result.scalars().all()]


@router.post("", response_model=WebhookEndpointCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_webhook_endpoint(
    payload: WebhookEndpointCreate,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> WebhookEndpointCreateResponse:
    signing_secret = generate_signing_secret()
    endpoint = WebhookEndpoint(
        name=payload.name.strip(),
        url=payload.url,
        secret=encrypt_signing_secret(signing_secret),
        events=encode_events(payload.events),
        is_active=payload.is_active,
        created_by=admin.id,
    )
    db.add(endpoint)
    await db.flush()

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "webhook_endpoint.created",
        actor=admin,
        ip_address=ip,
        target_type="webhook_endpoint",
        target_id=str(endpoint.id),
        target_label=endpoint.name,
        detail=f"events: {decode_events(endpoint)}",
    )
    await db.commit()
    await db.refresh(endpoint)
    response = _serialize_endpoint(endpoint).model_dump()
    return WebhookEndpointCreateResponse(**response, signing_secret=signing_secret)


@router.put("/{endpoint_id}", response_model=WebhookEndpointResponse)
async def update_webhook_endpoint(
    endpoint_id: int,
    payload: WebhookEndpointUpdate,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> WebhookEndpointResponse:
    endpoint = await db.get(WebhookEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "events" in update_data and update_data["events"] is not None:
        update_data["events"] = encode_events(update_data["events"])
    for field, value in update_data.items():
        setattr(endpoint, field, value)
    endpoint.updated_at = datetime.now(timezone.utc)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "webhook_endpoint.updated",
        actor=admin,
        ip_address=ip,
        target_type="webhook_endpoint",
        target_id=str(endpoint.id),
        target_label=endpoint.name,
    )
    await db.commit()
    await db.refresh(endpoint)
    return _serialize_endpoint(endpoint)


@router.delete("/{endpoint_id}", status_code=204, response_class=Response)
async def delete_webhook_endpoint(
    endpoint_id: int,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> Response:
    endpoint = await db.get(WebhookEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    label = endpoint.name
    await db.delete(endpoint)
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "webhook_endpoint.deleted",
        actor=admin,
        ip_address=ip,
        target_type="webhook_endpoint",
        target_id=str(endpoint_id),
        target_label=label,
    )
    await db.commit()
    return Response(status_code=204)


@router.get("/{endpoint_id}/deliveries", response_model=list[WebhookDeliveryResponse])
async def list_webhook_deliveries(
    endpoint_id: int,
    db: DbSession,
    _admin: User = Depends(require_admin),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[WebhookDeliveryResponse]:
    if await db.get(WebhookEndpoint, endpoint_id) is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.endpoint_id == endpoint_id)
        .order_by(WebhookDelivery.created_at.desc(), WebhookDelivery.id.desc())
        .limit(limit)
    )
    return [WebhookDeliveryResponse.model_validate(delivery) for delivery in result.scalars().all()]


@router.post("/deliveries/{delivery_id}/retry", response_model=WebhookDeliveryResponse)
async def retry_webhook_delivery(
    delivery_id: int,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> WebhookDeliveryResponse:
    delivery = await db.get(WebhookDelivery, delivery_id)
    if delivery is None:
        raise HTTPException(status_code=404, detail="Webhook delivery not found")
    delivery.status = "pending"
    delivery.next_attempt_at = None
    await deliver_webhook_delivery(db, delivery)
    await log_event(db, "webhook.delivery_retried", actor=_admin, ip_address=request.client.host if request.client else None, target_type="webhook_delivery", target_id=str(delivery.id), target_label=str(delivery.endpoint_id), detail=f"status={delivery.status}\noutcome={'success' if delivery.status == 'succeeded' else 'failure'}")
    await db.commit()
    await db.refresh(delivery)
    return WebhookDeliveryResponse.model_validate(delivery)


@router.post("/{endpoint_id}/test", response_model=WebhookDeliveryResponse)
async def test_webhook_endpoint(
    endpoint_id: int,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> WebhookDeliveryResponse:
    endpoint = await db.get(WebhookEndpoint, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")

    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="webhook.test",
        payload={
            "event": "webhook.test",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "targetType": "webhook_endpoint",
            "targetId": str(endpoint.id),
            "targetLabel": endpoint.name,
            "detail": "Manual webhook test",
        },
    )
    db.add(delivery)
    await db.flush()
    await deliver_webhook_delivery(db, delivery)
    await log_event(db, "webhook.test_sent", actor=_admin, ip_address=request.client.host if request.client else None, target_type="webhook_endpoint", target_id=str(endpoint.id), target_label=endpoint.name, detail=f"deliveryStatus={delivery.status}\noutcome={'success' if delivery.status == 'succeeded' else 'failure'}")
    await db.commit()
    await db.refresh(delivery)
    return WebhookDeliveryResponse.model_validate(delivery)
