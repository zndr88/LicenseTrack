import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String, func
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    settings: Mapped["UserSettings"] = relationship("UserSettings", back_populates="user", uselist=False)  # noqa: F821
    licenses_created: Mapped[list["License"]] = relationship(  # noqa: F821
        "License", back_populates="creator", foreign_keys="License.created_by"
    )
    documents_uploaded: Mapped[list["Document"]] = relationship(  # noqa: F821
        "Document", back_populates="uploader", foreign_keys="Document.uploaded_by"
    )
    api_tokens: Mapped[list["ApiToken"]] = relationship(  # noqa: F821
        "ApiToken", back_populates="creator", cascade="all, delete-orphan"
    )
