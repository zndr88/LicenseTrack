from app import auth
from app.seed import _hash_password


def test_seed_hash_password_uses_shared_auth_hashing() -> None:
    password = "x" * 100

    hashed = _hash_password(password)

    assert auth.verify_password(password, hashed)
