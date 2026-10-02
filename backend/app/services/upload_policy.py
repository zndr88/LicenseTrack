"""What can be uploaded as a document.

The one owner of the allowed file extensions (from ``ALLOWED_UPLOAD_EXTENSIONS``)
and of the MIME types accepted for license and contract documents. The
frontend reads the extensions through ``GET /api/documents/upload-types``.
"""

from __future__ import annotations

from app.config import settings

# MIME types accepted for license and contract documents. Browser-reported
# values vary, so generic binary is accepted for files validated by extension.
DOCUMENT_MIME_TYPES: frozenset[str] = frozenset(
    {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
        "text/plain",
        "application/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "application/vnd.ms-outlook",
        "application/octet-stream",
    }
)


def allowed_upload_extensions() -> list[str]:
    """The configured upload extensions, lower-case, unique and sorted."""
    return sorted({ext.strip().lower() for ext in settings.ALLOWED_UPLOAD_EXTENSIONS.split(",") if ext.strip()})
