"""Upload policy: one owner for the allowed extensions and document MIME types."""

import re
from pathlib import Path

from app.config import Settings
from app.services.upload_policy import DOCUMENT_MIME_TYPES, allowed_upload_extensions
from tests.single_owner import find_definitions

APP = Path(__file__).resolve().parents[2] / "app"
REPO = Path(__file__).resolve().parents[3]


def test_default_extensions_include_license_files_and_outlook_messages():
    default = Settings.model_fields["ALLOWED_UPLOAD_EXTENSIONS"].default
    assert ".lic" in default.split(",")
    assert ".msg" in default.split(",")


def test_allowed_extensions_are_normalised_and_sorted(monkeypatch):
    from app.services import upload_policy

    monkeypatch.setattr(upload_policy.settings, "ALLOWED_UPLOAD_EXTENSIONS", " .PDF, .msg,,.lic ")
    assert allowed_upload_extensions() == [".lic", ".msg", ".pdf"]


def test_outlook_messages_are_an_allowed_document_type():
    assert "application/vnd.ms-outlook" in DOCUMENT_MIME_TYPES


def test_document_mime_types_have_one_owner():
    assert find_definitions(
        APP,
        r"application/vnd\.openxmlformats-officedocument\.wordprocessingml\.document",
        owners={"services/upload_policy.py"},
    ) == []


def test_deployment_defaults_match_the_application_default():
    default = Settings.model_fields["ALLOWED_UPLOAD_EXTENSIONS"].default
    env_example = (REPO / ".env.example").read_text(encoding="utf-8")
    compose = (REPO / "docker-compose.yml").read_text(encoding="utf-8")
    installer = (REPO / "packaging" / "native" / "libexec" / "installer.py").read_text(encoding="utf-8")
    assert f"ALLOWED_UPLOAD_EXTENSIONS={default}" in env_example
    assert f"ALLOWED_UPLOAD_EXTENSIONS:-{default}}}" in compose
    assert re.search(rf'DEFAULT_ALLOWED_UPLOAD_EXTENSIONS = "{re.escape(default)}"', installer)


def test_demo_mirrors_the_default_extensions():
    default = Settings.model_fields["ALLOWED_UPLOAD_EXTENSIONS"].default
    handlers = (REPO / "frontend" / "src" / "demo" / "handlers.js").read_text(encoding="utf-8")
    match = re.search(r"DEMO_UPLOAD_EXTENSIONS = \[([^\]]*)\]", handlers)
    assert match, "DEMO_UPLOAD_EXTENSIONS not found in demo/handlers.js"
    demo = re.findall(r'"([^"]+)"', match.group(1))
    assert demo == sorted(default.split(","))
