async def test_plugin_host_is_default_off_and_mutating_routes_are_unavailable(
    test_app,
    auth_headers,
    monkeypatch,
):
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_ENABLED", False)
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", False)

    status = await test_app.get("/api/plugins/status", headers=auth_headers)
    registry = await test_app.get("/api/plugins", headers=auth_headers)
    actions = await test_app.get(
        "/api/plugin-actions",
        headers=auth_headers,
        params={"slot": "document.row.actions", "targetType": "license_document", "targetId": "1"},
    )
    invoke = await test_app.post(
        "/api/plugin-actions/example/example/invoke",
        headers=auth_headers,
        json={"targetType": "license_document", "targetId": "1"},
    )
    suggestions = await test_app.get("/api/plugin-suggestions", headers=auth_headers)
    accept_suggestion = await test_app.post(
        "/api/plugin-suggestions/1/accept",
        headers=auth_headers,
    )
    runtime = await test_app.get(
        "/api/plugin-runtime/test/settings",
        headers={"Authorization": "Bearer invalid"},
    )

    assert status.status_code == 200
    assert status.json() == {"enabled": False, "developerMode": False, "trustedKeyCount": 0}
    assert registry.status_code == 404
    assert actions.status_code == 200
    assert actions.json() == {
        "slot": "document.row.actions",
        "targetType": "license_document",
        "targetId": "1",
        "actions": [],
    }
    assert invoke.status_code == 404
    assert suggestions.status_code == 200
    assert suggestions.json() == []
    assert accept_suggestion.status_code == 404
    assert runtime.status_code == 404


async def test_plugin_host_reports_explicit_developer_opt_in(test_app, auth_headers, monkeypatch):
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_ENABLED", True)
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", True)

    status = await test_app.get("/api/plugins/status", headers=auth_headers)
    registry = await test_app.get("/api/plugins", headers=auth_headers)

    assert status.status_code == 200
    assert status.json()["enabled"] is True
    assert status.json()["developerMode"] is True
    assert registry.status_code == 200
