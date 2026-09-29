from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.models.user import AuthProvider, UserRole
from app.schemas.request_base import RequestModel


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    auth_provider: AuthProvider
    role: UserRole
    is_active: bool
    allow_downloads: bool = True
    is_break_glass_admin: bool = False
    must_change_password: bool
    created_at: datetime


class UserCreate(RequestModel):
    username: str
    email: EmailStr
    password: str | None = None
    auth_provider: AuthProvider = AuthProvider.local
    role: UserRole = UserRole.viewer
    allow_downloads: bool = True

    @model_validator(mode="after")
    def validate_password_rules(self) -> "UserCreate":
        if self.auth_provider == AuthProvider.local and not self.password:
            raise ValueError("Password is required for local users")
        if self.auth_provider == AuthProvider.oidc:
            self.password = None
        return self


class UserUpdate(RequestModel):
    username: str = Field(min_length=1)
    email: EmailStr
    role: UserRole
    is_active: bool
    allow_downloads: bool = True
    auth_provider: AuthProvider
    password: str | None = None

    @model_validator(mode="after")
    def validate_password_rules(self) -> "UserUpdate":
        if self.auth_provider == AuthProvider.local and self.password == "":
            self.password = None
        if self.auth_provider == AuthProvider.oidc:
            self.password = None
        return self


class RoleUpdate(RequestModel):
    role: UserRole


class ChangePasswordRequest(RequestModel):
    current_password: str
    new_password: str


class ResetPasswordRequest(RequestModel):
    new_password: str


class DepartmentAssignment(RequestModel):
    departments: list[str]
