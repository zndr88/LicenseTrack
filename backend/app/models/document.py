import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DocumentCategory(str, enum.Enum):
    invoice = "invoice"
    eula = "eula"
    entitlement = "entitlement"
    quote = "quote"
    purchase_order = "purchase_order"
    other = "other"


class ProcurementDocumentCategory(str, enum.Enum):
    quote = "quote"
    purchase_order = "purchase_order"
    invoice = "invoice"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    license_id: Mapped[int] = mapped_column(Integer, ForeignKey("licenses.id"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[DocumentCategory] = mapped_column(Enum(DocumentCategory), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    license: Mapped["License"] = relationship("License", back_populates="documents")  # noqa: F821
    uploader: Mapped["User | None"] = relationship(  # noqa: F821
        "User", back_populates="documents_uploaded", foreign_keys=[uploaded_by]
    )


class ProcurementDocument(Base):
    __tablename__ = "procurement_documents"
    __table_args__ = (
        UniqueConstraint(
            "pending_order_id",
            "source_sourcing_quote_document_id",
            name="uq_procurement_document_pending_quote_source",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    po_number: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    pending_order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pending_orders.id"), nullable=True, index=True
    )
    license_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("licenses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    procurement_bundle_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    source_sourcing_quote_document_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[ProcurementDocumentCategory] = mapped_column(Enum(ProcurementDocumentCategory), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    uploader: Mapped["User | None"] = relationship("User", foreign_keys=[uploaded_by])  # noqa: F821
