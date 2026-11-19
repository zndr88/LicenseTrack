from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SchedulerJobLock(Base):
    """Which app copy currently runs a scheduled job (see app.services.job_lock)."""

    __tablename__ = "scheduler_job_locks"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
