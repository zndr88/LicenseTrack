from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DocumentProcessingResult(Base):
    __tablename__ = "document_processing_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_type: Mapped[str] = mapped_column(String(50), nullable=False)
    document_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    license_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("licenses.id", ondelete="SET NULL"), nullable=True, index=True)
    capability_key: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending", server_default="pending")
    suggested_fields: Mapped[list] = mapped_column(JSON, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
