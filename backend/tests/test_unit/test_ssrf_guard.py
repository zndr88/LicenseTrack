import socket

import pytest

from app.services import ssrf_guard


def _resolve_to(monkeypatch, address: str) -> None:
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    monkeypatch.setattr(
        ssrf_guard.socket,
        "getaddrinfo",
        lambda host, port: [(family, socket.SOCK_STREAM, 6, "", (address, 0))],
    )


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "fd00::1",
        "ff02::1",
        # IPv6 forms that carry an IPv4 address
        "64:ff9b::a00:1",
        "64:ff9b::7f00:1",
        "64:ff9b:1::808:808",
        "::127.0.0.1",
        "::a00:1",
        "::ffff:0:a00:1",
        "::ffff:10.0.0.1",
        "2002:a00:1::",
        "2001:0:4136:e378:8000:63bf:f5ff:fffe",
    ],
)
def test_blocks_non_public_addresses(monkeypatch, address):
    _resolve_to(monkeypatch, address)
    with pytest.raises(ValueError):
        ssrf_guard.check_ssrf("https://hooks.example.com/x")


@pytest.mark.parametrize("address", ["8.8.8.8", "2001:4860:4860::8888", "64:ff9b::808:808", "::ffff:8.8.8.8"])
def test_allows_public_addresses(monkeypatch, address):
    _resolve_to(monkeypatch, address)
    ssrf_guard.check_ssrf("https://hooks.example.com/x")


def test_rejects_url_without_host():
    with pytest.raises(ValueError):
        ssrf_guard.check_ssrf("file:///etc/passwd")
