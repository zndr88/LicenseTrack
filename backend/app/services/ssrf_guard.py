import ipaddress
import socket
from urllib.parse import urlparse


def check_ssrf(url: str) -> None:
    """Raise ValueError if *url* resolves to any address that is not public unicast.

    Call this before any outbound HTTP request using an admin-supplied URL to prevent
    server-side request forgery against internal infrastructure (169.254.169.254,
    loopback, RFC-1918 ranges, etc.).
    """
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        raise ValueError(f"URL has no resolvable host: {url!r}")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"Cannot resolve host {host!r}: {exc}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise ValueError(f"URL {url!r} resolves to a blocked address ({ip})")
