async def test_health_check_returns_version(test_app):
    response = await test_app.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)
    assert body["version"]


async def test_security_headers_allow_blob_document_previews_without_allowing_app_framing(test_app):
    response = await test_app.get("/api/health")

    assert response.status_code == 200
    content_security_policy = response.headers["content-security-policy"]
    assert "frame-src 'self' blob:;" in content_security_policy
    assert "frame-ancestors 'none';" in content_security_policy
    assert response.headers["x-frame-options"] == "DENY"
