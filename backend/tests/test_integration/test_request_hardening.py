from sqlalchemy import select

from app.models.user import User


async def test_api_token_blocked_while_owner_must_change_password(test_app, db_session, auth_headers):
    created = await test_app.post(
        "/api/api-tokens",
        headers=auth_headers,
        json={"name": "sync", "scopes": ["licenses:read"]},
    )
    assert created.status_code == 201, created.text
    token = created.json()["token"]

    owner = await db_session.scalar(select(User).where(User.username == "testadmin"))
    owner.must_change_password = True
    await db_session.commit()

    response = await test_app.get("/api/licenses", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    assert "Password change required" in response.json()["detail"]
