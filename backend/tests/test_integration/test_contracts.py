"""
Integration tests for contract routes.

Covers:
  GET    /api/contracts
  GET    /api/contracts/{id}
  POST   /api/contracts
  PUT    /api/contracts/{id}
  DELETE /api/contracts/{id}
  POST   /api/contracts/{id}/folders
  PUT    /api/contracts/{id}/folders/{fid}
  DELETE /api/contracts/{id}/folders/{fid}
  POST   /api/contracts/{id}/documents
  GET    /api/contracts/{id}/documents
  DELETE /api/contracts/{id}/documents/{doc_id}
  GET    /api/contracts/{id}/licenses

Storage is redirected to a pytest tmp_path by patching settings.STORAGE_PATH.
"""

import pytest
import bcrypt

import app.services.storage as _storage_module
from app.models.contract import ContractDocument
from app.models.license import License, LicenseType, LicenseMetric
from app.models.user import User, UserRole
from app.models.user_department_access import UserDepartmentAccess


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def patch_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(_storage_module.settings, "STORAGE_PATH", str(tmp_path))
    (tmp_path / "contracts").mkdir()
    return tmp_path


@pytest.fixture
async def contract(test_app, auth_headers) -> dict:
    """Create a contract via the API and return the response body."""
    resp = await test_app.post(
        "/api/contracts",
        json={"contract_number": "CN-2024-001", "publisher_name": "Acme Corp"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
async def contract_with_folder(test_app, auth_headers, contract) -> tuple[dict, dict]:
    """Create a contract plus one folder; return (contract, folder)."""
    resp = await test_app.post(
        f"/api/contracts/{contract['id']}/folders",
        json={"name": "Invoices"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return contract, resp.json()


# ---------------------------------------------------------------------------
# CRUD — happy paths
# ---------------------------------------------------------------------------

async def test_create_contract_returns_201_with_fields(test_app, auth_headers):
    resp = await test_app.post(
        "/api/contracts",
        json={
            "contract_number": "CN-001",
            "publisher_name": "Adobe",
            "notes": "Annual agreement",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["contractNumber"] == "CN-001"
    assert body["publisherName"] == "Adobe"
    assert body["notes"] == "Annual agreement"
    assert body["licenseCount"] == 0
    assert body["documentCount"] == 0
    assert body["folders"] == []


async def test_get_contract_returns_contract(test_app, auth_headers, contract):
    resp = await test_app.get(f"/api/contracts/{contract['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == contract["id"]
    assert resp.json()["contractNumber"] == "CN-2024-001"


async def test_list_contracts_returns_created_contract(test_app, auth_headers, contract):
    resp = await test_app.get("/api/contracts", headers=auth_headers)
    assert resp.status_code == 200
    ids = [c["id"] for c in resp.json()]
    assert contract["id"] in ids


async def test_update_contract_changes_fields(test_app, auth_headers, contract):
    resp = await test_app.put(
        f"/api/contracts/{contract['id']}",
        json={"publisher_name": "Adobe Systems", "notes": "Updated"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["publisherName"] == "Adobe Systems"
    assert body["notes"] == "Updated"


async def test_update_contract_number_cascades_to_linked_licenses(
    test_app, auth_headers, db_session, contract
):
    """Renaming a contract's contract_number must propagate to all linked licenses."""
    lic1 = License(
        publisher_name="Acme",
        software_description="Suite A",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        is_retired=False,
    )
    lic2 = License(
        publisher_name="Acme",
        software_description="Suite B",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        is_retired=False,
    )
    unrelated = License(
        publisher_name="Other",
        software_description="Unrelated",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-OTHER",
        is_retired=False,
    )
    db_session.add_all([lic1, lic2, unrelated])
    await db_session.commit()

    resp = await test_app.put(
        f"/api/contracts/{contract['id']}",
        json={"contract_number": "CN-2024-999"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["contractNumber"] == "CN-2024-999"

    await db_session.refresh(lic1)
    await db_session.refresh(lic2)
    await db_session.refresh(unrelated)

    assert lic1.contract_number == "CN-2024-999"
    assert lic2.contract_number == "CN-2024-999"
    assert unrelated.contract_number == "CN-OTHER"  # untouched


async def test_delete_contract_returns_204(test_app, auth_headers, contract):
    resp = await test_app.delete(
        f"/api/contracts/{contract['id']}", headers=auth_headers
    )
    assert resp.status_code == 204

    # Confirm it is gone
    get_resp = await test_app.get(
        f"/api/contracts/{contract['id']}", headers=auth_headers
    )
    assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# CRUD — error cases
# ---------------------------------------------------------------------------

async def test_get_nonexistent_contract_returns_404(test_app, auth_headers):
    resp = await test_app.get("/api/contracts/999999", headers=auth_headers)
    assert resp.status_code == 404


async def test_update_nonexistent_contract_returns_404(test_app, auth_headers):
    resp = await test_app.put(
        "/api/contracts/999999",
        json={"publisher_name": "X"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_delete_nonexistent_contract_returns_404(test_app, auth_headers):
    resp = await test_app.delete("/api/contracts/999999", headers=auth_headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

async def test_create_folder_returns_201(test_app, auth_headers, contract):
    resp = await test_app.post(
        f"/api/contracts/{contract['id']}/folders",
        json={"name": "Invoices"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Invoices"
    assert body["documentCount"] == 0


async def test_create_folder_on_nonexistent_contract_returns_404(test_app, auth_headers):
    resp = await test_app.post(
        "/api/contracts/999999/folders",
        json={"name": "Invoices"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_rename_folder(test_app, auth_headers, contract_with_folder):
    contract, folder = contract_with_folder
    resp = await test_app.put(
        f"/api/contracts/{contract['id']}/folders/{folder['id']}",
        json={"name": "Signed Contracts"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Signed Contracts"


async def test_delete_empty_folder_returns_204(test_app, auth_headers, contract_with_folder):
    contract, folder = contract_with_folder
    resp = await test_app.delete(
        f"/api/contracts/{contract['id']}/folders/{folder['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 204


async def test_delete_folder_with_documents_returns_409(
    test_app, auth_headers, contract_with_folder
):
    contract, folder = contract_with_folder
    files = {"file": ("doc.pdf", b"%PDF-1.4", "application/pdf")}
    upload_resp = await test_app.post(
        f"/api/contracts/{contract['id']}/folders/{folder['id']}/documents",
        files=files,
        headers=auth_headers,
    )
    assert upload_resp.status_code == 201

    resp = await test_app.delete(
        f"/api/contracts/{contract['id']}/folders/{folder['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 409


async def test_contract_response_includes_folder_count(
    test_app, auth_headers, contract_with_folder
):
    contract, _ = contract_with_folder
    resp = await test_app.get(f"/api/contracts/{contract['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["folders"]) == 1


# ---------------------------------------------------------------------------
# Documents — general upload
# ---------------------------------------------------------------------------

async def test_upload_document_to_contract_returns_201(test_app, auth_headers, contract):
    files = {"file": ("agreement.pdf", b"%PDF-1.4", "application/pdf")}
    resp = await test_app.post(
        f"/api/contracts/{contract['id']}/documents",
        files=files,
        headers=auth_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["originalFilename"] == "agreement.pdf"
    assert body["folderId"] is None


async def test_upload_document_to_folder(test_app, auth_headers, contract_with_folder):
    contract, folder = contract_with_folder
    files = {"file": ("invoice.pdf", b"%PDF-1.4", "application/pdf")}
    resp = await test_app.post(
        f"/api/contracts/{contract['id']}/folders/{folder['id']}/documents",
        files=files,
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["folderId"] == folder["id"]


async def test_list_contract_documents(test_app, auth_headers, contract):
    files = {"file": ("scan.pdf", b"%PDF-1.4", "application/pdf")}
    await test_app.post(
        f"/api/contracts/{contract['id']}/documents",
        files=files,
        headers=auth_headers,
    )

    resp = await test_app.get(
        f"/api/contracts/{contract['id']}/documents",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["originalFilename"] == "scan.pdf"


async def test_delete_contract_document_returns_204(test_app, auth_headers, contract):
    files = {"file": ("old.pdf", b"%PDF-1.4", "application/pdf")}
    upload_resp = await test_app.post(
        f"/api/contracts/{contract['id']}/documents",
        files=files,
        headers=auth_headers,
    )
    doc_id = upload_resp.json()["id"]

    del_resp = await test_app.delete(
        f"/api/contracts/{contract['id']}/documents/{doc_id}",
        headers=auth_headers,
    )
    assert del_resp.status_code == 204

    list_resp = await test_app.get(
        f"/api/contracts/{contract['id']}/documents",
        headers=auth_headers,
    )
    assert len(list_resp.json()) == 0


async def test_upload_invalid_extension_rejected(test_app, auth_headers, contract):
    files = {"file": ("virus.exe", b"MZ\x90", "application/octet-stream")}
    resp = await test_app.post(
        f"/api/contracts/{contract['id']}/documents",
        files=files,
        headers=auth_headers,
    )
    assert resp.status_code == 422


async def test_document_count_in_contract_response(test_app, auth_headers, contract):
    files = {"file": ("a.pdf", b"%PDF-1.4", "application/pdf")}
    await test_app.post(
        f"/api/contracts/{contract['id']}/documents",
        files=files,
        headers=auth_headers,
    )

    resp = await test_app.get(f"/api/contracts/{contract['id']}", headers=auth_headers)
    assert resp.json()["documentCount"] == 1


# ---------------------------------------------------------------------------
# Linked licenses
# ---------------------------------------------------------------------------

async def test_linked_licenses_returns_matching_licenses(
    test_app, auth_headers, db_session, contract
):
    lic = License(
        publisher_name="Acme Corp",
        software_description="Acme Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        is_retired=False,
    )
    db_session.add(lic)
    await db_session.commit()

    resp = await test_app.get(
        f"/api/contracts/{contract['id']}/licenses",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["id"] == lic.id


async def test_linked_licenses_excludes_retired(
    test_app, auth_headers, db_session, contract
):
    retired = License(
        publisher_name="Acme Corp",
        software_description="Old Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        is_retired=True,
    )
    db_session.add(retired)
    await db_session.commit()

    resp = await test_app.get(
        f"/api/contracts/{contract['id']}/licenses",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 0


async def test_linked_licenses_case_insensitive_match(
    test_app, auth_headers, db_session, contract
):
    lic = License(
        publisher_name="Pub",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="cn-2024-001",  # lowercase — should still match
        is_retired=False,
    )
    db_session.add(lic)
    await db_session.commit()

    resp = await test_app.get(
        f"/api/contracts/{contract['id']}/licenses",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------

async def test_unauthenticated_access_rejected(test_app):
    resp = await test_app.get("/api/contracts")
    assert resp.status_code == 401


async def test_viewer_with_no_departments_sees_no_contracts(
    test_app, db_session, contract
):
    hashed = bcrypt.hashpw(b"pass123456789", bcrypt.gensalt()).decode()
    viewer = User(
        username="viewer1",
        email="viewer1@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.commit()

    login = await test_app.post(
        "/api/auth/login",
        json={"username": "viewer1", "password": "pass123456789"},
    )
    viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = await test_app.get("/api/contracts", headers=viewer_headers)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_viewer_with_matching_department_sees_contract(
    test_app, db_session, contract
):
    # Link a license to the contract's contract_number, in dept "IT"
    lic = License(
        publisher_name="Acme",
        software_description="App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        cost_centre="IT",
        is_retired=False,
    )
    db_session.add(lic)
    await db_session.flush()

    hashed = bcrypt.hashpw(b"pass123456789", bcrypt.gensalt()).decode()
    viewer = User(
        username="viewer2",
        email="viewer2@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.flush()

    db_session.add(UserDepartmentAccess(user_id=viewer.id, department="IT"))
    await db_session.commit()

    login = await test_app.post(
        "/api/auth/login",
        json={"username": "viewer2", "password": "pass123456789"},
    )
    viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = await test_app.get("/api/contracts", headers=viewer_headers)
    assert resp.status_code == 200
    assert any(c["id"] == contract["id"] for c in resp.json())


async def test_viewer_cannot_access_contract_direct_routes_outside_department(
    test_app, db_session, contract, patch_storage
):
    visible_license = License(
        publisher_name="Acme",
        software_description="Visible App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-VISIBLE",
        cost_centre="IT",
        is_retired=False,
    )
    hidden_license = License(
        publisher_name="Acme",
        software_description="Hidden App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        cost_centre="HR",
        is_retired=False,
    )
    db_session.add_all([visible_license, hidden_license])
    await db_session.flush()

    stored_path = f"contracts/{contract['id']}/hidden.pdf"
    target = patch_storage / stored_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"%PDF-1.4 hidden")
    document = ContractDocument(
        contract_id=contract["id"],
        filename=stored_path,
        original_filename="hidden.pdf",
        file_size=15,
    )
    db_session.add(document)

    hashed = bcrypt.hashpw(b"pass123456789", bcrypt.gensalt()).decode()
    viewer = User(
        username="viewer_contract_direct",
        email="viewer_contract_direct@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.flush()
    db_session.add(UserDepartmentAccess(user_id=viewer.id, department="IT"))
    await db_session.commit()

    login = await test_app.post(
        "/api/auth/login",
        json={"username": "viewer_contract_direct", "password": "pass123456789"},
    )
    viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    get_resp = await test_app.get(f"/api/contracts/{contract['id']}", headers=viewer_headers)
    docs_resp = await test_app.get(f"/api/contracts/{contract['id']}/documents", headers=viewer_headers)
    download_resp = await test_app.get(
        f"/api/contracts/{contract['id']}/documents/{document.id}/download",
        headers=viewer_headers,
    )
    licenses_resp = await test_app.get(f"/api/contracts/{contract['id']}/licenses", headers=viewer_headers)

    assert get_resp.status_code == 404
    assert docs_resp.status_code == 404
    assert download_resp.status_code == 404
    assert licenses_resp.status_code == 404


async def test_viewer_contract_direct_routes_filter_to_assigned_department(
    test_app, db_session, contract
):
    visible_license = License(
        publisher_name="Acme",
        software_description="Visible App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        cost_centre="IT",
        is_retired=False,
    )
    hidden_license = License(
        publisher_name="Acme",
        software_description="Hidden App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        cost_centre="HR",
        is_retired=False,
    )
    db_session.add_all([visible_license, hidden_license])

    hashed = bcrypt.hashpw(b"pass123456789", bcrypt.gensalt()).decode()
    viewer = User(
        username="viewer_contract_allowed",
        email="viewer_contract_allowed@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.flush()
    db_session.add(UserDepartmentAccess(user_id=viewer.id, department="IT"))
    await db_session.commit()

    login = await test_app.post(
        "/api/auth/login",
        json={"username": "viewer_contract_allowed", "password": "pass123456789"},
    )
    viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    contract_resp = await test_app.get(f"/api/contracts/{contract['id']}", headers=viewer_headers)
    licenses_resp = await test_app.get(f"/api/contracts/{contract['id']}/licenses", headers=viewer_headers)

    assert contract_resp.status_code == 200
    assert contract_resp.json()["licenseCount"] == 1
    assert licenses_resp.status_code == 200
    assert [item["id"] for item in licenses_resp.json()] == [visible_license.id]


async def test_viewer_without_downloads_can_list_but_not_download_contract_document(
    test_app, db_session, contract, patch_storage
):
    license_obj = License(
        publisher_name="Acme",
        software_description="Visible App",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        currency="EUR",
        contract_number="CN-2024-001",
        cost_centre="IT",
        is_retired=False,
    )
    db_session.add(license_obj)
    await db_session.flush()

    stored_path = f"contracts/{contract['id']}/read-only.pdf"
    target = patch_storage / stored_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"%PDF-1.4 read only")
    document = ContractDocument(
        contract_id=contract["id"],
        filename=stored_path,
        original_filename="read-only.pdf",
        file_size=18,
    )
    db_session.add(document)

    hashed = bcrypt.hashpw(b"pass123456789", bcrypt.gensalt()).decode()
    viewer = User(
        username="viewer_contract_read_only",
        email="viewer_contract_read_only@test.local",
        hashed_password=hashed,
        role=UserRole.viewer,
        allow_downloads=False,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(viewer)
    await db_session.flush()
    db_session.add(UserDepartmentAccess(user_id=viewer.id, department="IT"))
    await db_session.commit()

    login = await test_app.post(
        "/api/auth/login",
        json={"username": "viewer_contract_read_only", "password": "pass123456789"},
    )
    viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    docs_resp = await test_app.get(f"/api/contracts/{contract['id']}/documents", headers=viewer_headers)
    download_resp = await test_app.get(
        f"/api/contracts/{contract['id']}/documents/{document.id}/download",
        headers=viewer_headers,
    )

    assert docs_resp.status_code == 200
    assert [doc["id"] for doc in docs_resp.json()] == [document.id]
    assert download_resp.status_code == 403
    assert download_resp.json()["detail"] == "Downloads are disabled for this viewer"
