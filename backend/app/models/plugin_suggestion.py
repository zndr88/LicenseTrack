from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PluginSuggestion(Base):
    __tablename__ = "plugin_suggestions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plugin_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("plugins.id", ondelete="SET NULL"), nullable=True, index=True)
    plugin_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    action_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    license_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("licenses.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending", server_default="pending")
    suggested_fields: Mapped[list] = mapped_column(JSON, nullable=False)
    line_items: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
