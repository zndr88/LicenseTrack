from typing import Literal

from pydantic import BaseModel, ConfigDict
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
    contract_number: str
    publisher_name: str
    notes: str | None = None


class ContractUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    contract_number: str | None = None
    publisher_name: str | None = None
    notes: str | None = None


class ContractFolderCreate(BaseModel):
    name: str


class ContractFolderUpdate(BaseModel):
    name: str


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
