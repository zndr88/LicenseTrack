import re
from pathlib import Path

from app.config import Settings


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def _env_keys(text: str) -> set[str]:
    return set(re.findall(r"^([A-Z][A-Z0-9_]*)=", text, flags=re.MULTILINE))


def _compose_environment_keys(text: str) -> set[str]:
    return set(re.findall(r"^\s+- ([A-Z][A-Z0-9_]*)=", text, flags=re.MULTILINE))


def test_docker_configuration_surfaces_cover_all_application_settings():
    expected = set(Settings.model_fields)
    env_example = (REPOSITORY_ROOT / ".env.example").read_text(encoding="utf-8")
    compose = (REPOSITORY_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    deployment = (REPOSITORY_ROOT / "wiki" / "operations" / "deployment.md").read_text(encoding="utf-8")

    assert expected <= _env_keys(env_example)
    assert expected <= _compose_environment_keys(compose)
    assert all(f"| `{key}` |" in deployment for key in expected)


def test_compose_only_host_port_is_documented():
    env_example = (REPOSITORY_ROOT / ".env.example").read_text(encoding="utf-8")
    deployment = (REPOSITORY_ROOT / "wiki" / "operations" / "deployment.md").read_text(encoding="utf-8")

    assert "APP_PORT" in _env_keys(env_example)
    assert "| `APP_PORT` |" in deployment
