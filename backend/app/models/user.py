import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class AuthProvider(str, enum.Enum):
    local = "local"
    oidc = "oidc"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_provider: Mapped[AuthProvider] = mapped_column(
        Enum(AuthProvider), nullable=False, default=AuthProvider.local, server_default=AuthProvider.local.value
    )
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False, default=UserRole.viewer)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_downloads: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    is_break_glass_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    security_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    oidc_issuer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    oidc_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    licenses_created: Mapped[list["License"]] = relationship(  # noqa: F821
        "License", back_populates="creator", foreign_keys="License.created_by"
    )
