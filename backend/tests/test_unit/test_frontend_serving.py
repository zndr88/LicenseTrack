from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import (
    IMMUTABLE_ASSET_CACHE_CONTROL,
    SPA_INDEX_CACHE_CONTROL,
    ImmutableStaticFiles,
    spa_index_response,
)


async def test_spa_index_revalidates_and_hashed_assets_are_immutable(tmp_path):
    frontend = tmp_path / "frontend"
    assets = frontend / "assets"
    assets.mkdir(parents=True)
    (frontend / "index.html").write_text("<html>LicenseTrack</html>", encoding="utf-8")
    (assets / "index-abc123.js").write_text("console.info('production');", encoding="utf-8")

    test_app = FastAPI()
    test_app.mount("/assets", ImmutableStaticFiles(directory=assets), name="assets")

    @test_app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return spa_index_response(str(frontend))

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        root_response = await client.get("/")
        fallback_response = await client.get("/licensetrack")
        asset_response = await client.get("/assets/index-abc123.js")

    assert root_response.status_code == 200
    assert root_response.headers["cache-control"] == SPA_INDEX_CACHE_CONTROL
    assert fallback_response.status_code == 200
    assert fallback_response.headers["cache-control"] == SPA_INDEX_CACHE_CONTROL
    assert asset_response.status_code == 200
    assert asset_response.headers["cache-control"] == IMMUTABLE_ASSET_CACHE_CONTROL


async def test_immutable_asset_cache_header_is_kept_on_conditional_response(tmp_path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "index-abc123.js").write_text("console.info('production');", encoding="utf-8")

    test_app = FastAPI()
    test_app.mount("/assets", ImmutableStaticFiles(directory=assets), name="assets")

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        initial = await client.get("/assets/index-abc123.js")
        conditional = await client.get(
            "/assets/index-abc123.js",
            headers={"If-None-Match": initial.headers["etag"]},
        )

    assert conditional.status_code == 304
    assert conditional.headers["cache-control"] == IMMUTABLE_ASSET_CACHE_CONTROL
