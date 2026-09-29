from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PoLineRegister(Base):
    """One row per issued PO line number. Rows are never deleted, so numbers are never reused."""

    __tablename__ = "po_line_register"
    __table_args__ = (UniqueConstraint("po_key", "line_number", name="uq_po_line_register_key_line"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    po_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    po_number: Mapped[str] = mapped_column(String(255), nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
