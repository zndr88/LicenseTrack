from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class DocumentActionResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    key: str
    label: str
    description: str


class DocumentActionInvoke(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    document_type: str = Field(pattern="^(license_document|procurement_document)$")
    document_id: int


class DocumentActionInvokeResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    action_key: str
    document_type: str
    document_id: int
    status: str = "accepted"
