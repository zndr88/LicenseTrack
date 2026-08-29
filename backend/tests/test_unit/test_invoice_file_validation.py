import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import HTTPException


def make_upload_file(content: bytes, filename: str, content_type: str = "application/pdf") -> MagicMock:
    f = MagicMock()
    f.read = AsyncMock(return_value=content)
    f.filename = filename
    f.content_type = content_type
    return f


@pytest.mark.asyncio
async def test_validate_invoice_file_accepts_pdf():
    from app.services.procurement_document_transfer_service import validate_invoice_file
    file = make_upload_file(b"PDF content", "invoice.pdf")
    content, filename, mime_type = await validate_invoice_file(file)
    assert content == b"PDF content"
    assert filename == "invoice.pdf"
    assert mime_type == "application/pdf"


@pytest.mark.asyncio
async def test_validate_invoice_file_rejects_unsupported_extension():
    from app.services.procurement_document_transfer_service import validate_invoice_file
    file = make_upload_file(b"data", "malware.exe")
    with pytest.raises(HTTPException) as exc_info:
        await validate_invoice_file(file)
    assert exc_info.value.status_code == 422
    assert "not allowed" in exc_info.value.detail


@pytest.mark.asyncio
async def test_validate_invoice_file_rejects_oversized_file(monkeypatch):
    from app.services import storage as storage_service
    monkeypatch.setattr(storage_service.settings, "MAX_UPLOAD_SIZE_MB", 1)
    from app.services.procurement_document_transfer_service import validate_invoice_file
    file = make_upload_file(b"x" * (2 * 1024 * 1024), "big.pdf")
    with pytest.raises(HTTPException) as exc_info:
        await validate_invoice_file(file)
    assert exc_info.value.status_code == 413
    assert "maximum allowed size" in exc_info.value.detail


@pytest.mark.asyncio
async def test_validate_invoice_file_guesses_mime_when_missing():
    from app.services.procurement_document_transfer_service import validate_invoice_file
    file = make_upload_file(b"data", "receipt.jpg", content_type="")
    content, filename, mime_type = await validate_invoice_file(file)
    assert "image" in mime_type  # mimetypes.guess_type for .jpg → image/jpeg
