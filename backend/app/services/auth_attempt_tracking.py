"""Bounded in-memory attempt storage shared by local and OIDC sign-in."""

MAX_TRACKED_KEYS = 10_000


def recent_attempts(
    store: dict[str, list[float]], key: str, now: float, window_seconds: int
) -> list[float]:
    recent = [t for t in store.get(key, []) if now - t < window_seconds]
    if recent:
        store[key] = recent
    else:
        store.pop(key, None)
    return recent


def enforce_key_cap(
    store: dict[str, list[float]], now: float, window_seconds: int, max_keys: int
) -> None:
    """Prune expired entries, then evict oldest active keys if still over capacity."""
    if len(store) <= max_keys:
        return
    for key in list(store):
        recent_attempts(store, key, now, window_seconds)
    while len(store) > max_keys:
        store.pop(next(iter(store)), None)
