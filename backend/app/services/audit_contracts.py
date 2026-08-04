from __future__ import annotations

from datetime import datetime, timezone

from app.services.audit_service import format_audit_detail


def format_document_amendment_detail(
    *,
    operation: str,
    document_category: str,
    filename: str,
    actor_email: str,
    post_conversion: bool,
    document_id: int | None = None,
    document_scope: str | None = None,
    related_license_id: int | None = None,
    pending_order_id: int | None = None,
    procurement_bundle_id: str | None = None,
    po_number: str | None = None,
    contract_id: int | None = None,
    folder_id: int | None = None,
    reason: str | None = None,
) -> str:
    """Build structured audit detail for document evidence amendments."""
    return format_audit_detail(
        "document_amendment",
        {
            "operation": operation,
            "postConversion": str(post_conversion).lower(),
            "documentCategory": document_category,
            "documentScope": document_scope,
            "documentId": str(document_id) if document_id is not None else None,
            "filename": filename,
            "relatedLicenseId": str(related_license_id) if related_license_id is not None else None,
            "pendingOrderId": str(pending_order_id) if pending_order_id is not None else None,
            "procurementBundleId": procurement_bundle_id,
            "poNumber": po_number,
            "contractId": str(contract_id) if contract_id is not None else None,
            "folderId": str(folder_id) if folder_id is not None else None,
            "actorEmail": actor_email,
            "amendmentTimestamp": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
        },
    )
