from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

from app.models.document import DocumentCategory, ProcurementDocumentCategory


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    license_id: int
    filename: str
    original_filename: str
    file_size: int
    mime_type: str
    category: DocumentCategory
    uploaded_at: datetime
    uploaded_by: Optional[int] = None
    scope: str = "license"
    file_availability: Literal["available", "missing", "unavailable"] = "available"


class ProcurementDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    po_number: str
    pending_order_id: Optional[int] = None
    license_id: Optional[int] = None
    procurement_bundle_id: Optional[str] = None
    filename: str
    original_filename: str
    file_size: int
    mime_type: str
    category: ProcurementDocumentCategory
    uploaded_at: datetime
    uploaded_by: Optional[int] = None
    scope: str = "po"
    file_availability: Literal["available", "missing", "unavailable"] = "available"
