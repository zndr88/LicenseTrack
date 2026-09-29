"""Every API request body (and every model nested inside one) inherits RequestModel."""

import inspect
import re
import typing

from pydantic import BaseModel

import app.models  # noqa: F401  (populate the mapper registry before importing the app)
from app.main import app
from app.schemas.request_base import RequestModel

# Request payloads that arrive as JSON inside a multipart form field and are
# validated by hand in the route, so they aren't visible in OpenAPI.
FORM_JSON_MODELS = ("ImportExecuteRequest", "PendingOrderConvertRequest", "BatchConvertItem")


def _all_models() -> dict[str, type[BaseModel]]:
    found: dict[str, type[BaseModel]] = {}
    stack = [BaseModel]
    while stack:
        cls = stack.pop()
        for sub in cls.__subclasses__():
            if sub.__module__.startswith("app."):
                found.setdefault(sub.__name__, sub)
            stack.append(sub)
    return found


def _nested(model: type[BaseModel], seen: set[type[BaseModel]]) -> None:
    if model in seen:
        return
    seen.add(model)
    for field in model.model_fields.values():
        for candidate in [field.annotation, *typing.get_args(field.annotation)]:
            for inner in [candidate, *typing.get_args(candidate)]:
                if inspect.isclass(inner) and issubclass(inner, BaseModel):
                    _nested(inner, seen)


def _request_models() -> set[type[BaseModel]]:
    by_name = _all_models()
    names: set[str] = set(FORM_JSON_MODELS)
    for operations in app.openapi()["paths"].values():
        for operation in operations.values():
            body = operation.get("requestBody")
            if not body:
                continue
            for content_type, content in body["content"].items():
                if content_type != "application/json":
                    continue
                names.update(re.findall(r"#/components/schemas/([A-Za-z0-9_]+)", str(content.get("schema", {}))))
    roots = {by_name[name] for name in names if name in by_name}
    missing = sorted(name for name in names if name not in by_name)
    assert not missing, f"request schemas not found as classes: {missing}"
    seen: set[type[BaseModel]] = set()
    for root in roots:
        _nested(root, seen)
    return seen


def test_every_request_model_inherits_request_model():
    offenders = sorted(
        f"{model.__module__}.{model.__name__}"
        for model in _request_models()
        if not issubclass(model, RequestModel)
    )
    assert offenders == [], "request models must inherit RequestModel:\n" + "\n".join(offenders)


def test_form_json_models_list_matches_the_routes():
    """A JSON payload validated by hand from a form field must be listed above."""
    from pathlib import Path

    routes = Path(__file__).resolve().parents[2] / "app" / "routes"
    found: set[str] = set()
    for path in routes.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        found.update(re.findall(r"(\w+)\.model_validate_json\(", text))
        found.update(re.findall(r"(\w+Request)\.model_validate\(\s*raw", text))
        found.update(re.findall(r"TypeAdapter\(list\[(\w+)\]\)", text))
    assert found, "the search patterns no longer match any hand-validated payload"
    assert found <= set(FORM_JSON_MODELS), f"add to FORM_JSON_MODELS: {sorted(found - set(FORM_JSON_MODELS))}"
