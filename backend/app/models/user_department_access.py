from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserDepartmentAccess(Base):
    __tablename__ = "user_department_access"
    __table_args__ = (UniqueConstraint("user_id", "department"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    department: Mapped[str] = mapped_column(String, nullable=False)
