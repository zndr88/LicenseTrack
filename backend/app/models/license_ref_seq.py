from sqlalchemy import Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LicenseRefSequence(Base):
    __tablename__ = "license_ref_sequence"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
