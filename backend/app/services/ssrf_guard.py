import ipaddress
import socket
from urllib.parse import urlparse

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

# Well-known NAT64 prefix (RFC 6052): the low 32 bits are an IPv4 address.
_NAT64_WELL_KNOWN = ipaddress.ip_network("64:ff9b::/96")
# IPv6 ranges whose low 32 bits carry an IPv4 address.
_LOW_32_BIT_IPV4_NETWORKS = (
    _NAT64_WELL_KNOWN,
    ipaddress.ip_network("64:ff9b:1::/48"),  # local-use NAT64 (RFC 8215)
    ipaddress.ip_network("::/96"),  # IPv4-compatible
    ipaddress.ip_network("::ffff:0:0:0/96"),  # IPv4-translated (SIIT)
)


def _embedded_ipv4(ip: ipaddress.IPv6Address) -> list[ipaddress.IPv4Address]:
    embedded = []
    if ip.ipv4_mapped is not None:
        embedded.append(ip.ipv4_mapped)
    if ip.sixtofour is not None:
        embedded.append(ip.sixtofour)
    if ip.teredo is not None:
        embedded.extend(ip.teredo)
    if any(ip in network for network in _LOW_32_BIT_IPV4_NETWORKS):
        embedded.append(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
    return embedded


def _is_blocked(ip: IPAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address):
        embedded = _embedded_ipv4(ip)
        if any(_is_blocked(address) for address in embedded):
            return True
        if embedded and ip in _NAT64_WELL_KNOWN:
            # A NAT64 translation of a public IPv4 address is itself public.
            return False
    return (
        not ip.is_global
        or ip.is_multicast
        or ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
    )


def check_ssrf(url: str) -> None:
    """Raise ValueError if *url* resolves to any address that is not public unicast.

    Call this before any outbound HTTP request using an admin-supplied URL to prevent
    server-side request forgery against internal infrastructure (169.254.169.254,
    loopback, RFC-1918 ranges, etc.). IPv4 addresses carried inside IPv6 addresses
    are checked as well.
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
        if _is_blocked(ip):
            raise ValueError(f"URL {url!r} resolves to a blocked address ({ip})")
