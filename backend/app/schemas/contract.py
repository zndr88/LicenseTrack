from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel
from datetime import datetime

_CONFIG = ConfigDict(
    from_attributes=True,
    alias_generator=to_camel,
    populate_by_name=True,
)


class ContractFolderResponse(BaseModel):
    model_config = _CONFIG
    id: int
    name: str
    created_at: datetime
    document_count: int = 0


class ContractResponse(BaseModel):
    model_config = _CONFIG
    id: int
    contract_number: str
    publisher_name: str
    notes: str | None
    created_at: datetime
    created_by: int | None
    license_count: int = 0
    document_count: int = 0
    folders: list[ContractFolderResponse] = []


class ContractCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    contract_number: str = Field(max_length=255)
    publisher_name: str = Field(max_length=255)
    notes: str | None = Field(default=None, max_length=10000)

    @field_validator("contract_number", "publisher_name")
    @classmethod
    def require_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ContractUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    contract_number: str | None = Field(default=None, max_length=255)
    publisher_name: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=10000)

    @field_validator("contract_number", "publisher_name")
    @classmethod
    def require_text_when_supplied(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ContractFolderCreate(BaseModel):
    name: str = Field(max_length=255)

    @field_validator("name")
    @classmethod
    def require_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ContractFolderUpdate(ContractFolderCreate):
    pass


class ContractDocumentResponse(BaseModel):
    model_config = _CONFIG
    id: int
    contract_id: int
    folder_id: int | None
    filename: str
    original_filename: str
    file_size: int | None
    created_at: datetime
    file_availability: Literal["available", "missing", "unavailable"] = "available"


class LinkedLicenseResponse(BaseModel):
    model_config = _CONFIG
    id: int
    publisher_name: str
    software_description: str
    contract_number: str
    start_date: str | None
    end_date: str | None
    lifecycle_status: str | None
    expiration_status: str
