import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PendingOrderStatus(str, enum.Enum):
    pending = "pending"
    invoice_received = "invoice_received"
    converted = "converted"


class EvidenceTransferStatus(str, enum.Enum):
    pending = "pending"
    complete = "complete"
    failed = "failed"
    escalated = "escalated"


class PendingOrder(Base):
    __tablename__ = "pending_orders"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    po_number: Mapped[str] = mapped_column(String(255), nullable=False)
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[PendingOrderStatus] = mapped_column(
        Enum(PendingOrderStatus), nullable=False, default=PendingOrderStatus.pending
    )
    evidence_transfer_status: Mapped[EvidenceTransferStatus | None] = mapped_column(
        Enum(EvidenceTransferStatus), nullable=True
    )
    evidence_transfer_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_transfer_failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    evidence_transfer_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by])  # noqa: F821
    items: Mapped[list["SourcingItem"]] = relationship(  # noqa: F821
        "SourcingItem",
        back_populates="pending_order",
        foreign_keys="[SourcingItem.pending_order_id]",
    )
    documents: Mapped[list["ProcurementDocument"]] = relationship(  # noqa: F821
        "ProcurementDocument",
        primaryjoin="PendingOrder.id == foreign(ProcurementDocument.pending_order_id)",
        viewonly=True,
    )
