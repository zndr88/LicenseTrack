async def test_user_settings_persist_renewal_workbench_columns(test_app, auth_headers):
    payload = {
        "renewal_workbench_columns": {
            "days": False,
            "custom:cf_invoice_date": True,
        }
    }

    put_resp = await test_app.put("/api/settings", json=payload, headers=auth_headers)
    assert put_resp.status_code == 200, put_resp.text
    assert put_resp.json()["renewal_workbench_columns"] == payload["renewal_workbench_columns"]
    assert "notification_days" not in put_resp.json()
    assert "manager_email" not in put_resp.json()

    get_resp = await test_app.get("/api/settings", headers=auth_headers)
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["renewal_workbench_columns"] == payload["renewal_workbench_columns"]
    assert "notification_days" not in get_resp.json()
    assert "manager_email" not in get_resp.json()
