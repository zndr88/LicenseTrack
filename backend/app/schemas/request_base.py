"""Base class for every API request body.

Unknown fields are logged, and rejected when STRICT_REQUEST_FIELDS is on
(always on in tests). Subclasses keep their own model_config (for example
camelCase aliases); Pydantic merges it with this one.
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, model_validator

from app.config import settings
from app.request_context import current_request

logger = logging.getLogger(__name__)


def _accepted_keys(model: type[BaseModel]) -> set[str]:
    keys: set[str] = set()
    for name, field in model.model_fields.items():
        keys.add(name)
        if field.alias:
            keys.add(field.alias)
        validation_alias = field.validation_alias
        if isinstance(validation_alias, str):
            keys.add(validation_alias)
        elif isinstance(validation_alias, AliasChoices):
            keys.update(choice for choice in validation_alias.choices if isinstance(choice, str))
    return keys


def unknown_request_fields(model: type[BaseModel], data: Any) -> list[str]:
    if not isinstance(data, dict):
        return []
    accepted = _accepted_keys(model)
    return sorted(str(key) for key in data if key not in accepted)


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid" if settings.STRICT_REQUEST_FIELDS else "ignore")

    @model_validator(mode="before")
    @classmethod
    def _report_unknown_fields(cls, data: Any) -> Any:
        unknown = unknown_request_fields(cls, data)
        if unknown:
            logger.warning(
                "Unknown request fields on %s (%s): %s",
                current_request.get(),
                cls.__name__,
                ", ".join(unknown),
            )
        return data
