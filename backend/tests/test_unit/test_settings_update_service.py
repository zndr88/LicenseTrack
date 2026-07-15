from app.services.settings_update_service import normalize_smtp_encryption


def test_normalize_smtp_encryption_derives_legacy_use_tls_flag():
    update_data = {"smtp_encryption": "none"}

    normalize_smtp_encryption(update_data)

    assert update_data["smtp_use_tls"] is False


def test_normalize_smtp_encryption_preserves_legacy_tls_payloads():
    update_data = {"smtp_use_tls": True}

    normalize_smtp_encryption(update_data)

    assert update_data["smtp_encryption"] == "tls"
