async def test_health_check_returns_version(test_app):
    response = await test_app.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)
    assert body["version"]
