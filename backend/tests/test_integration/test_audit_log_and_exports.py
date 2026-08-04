from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone

import pytest

from app import auth
from app.models.audit_log import AuditLog
from app.models.license import License, LicenseMetric, LicenseType
from app.models.pending_order import PendingOrder, PendingOrderStatus
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.models.user import User, UserRole


async def _create_role_headers(db_session, role: UserRole) -> dict[str, str]:
    user = User(
        username=f"{role.value}_exports",
        email=f"{role.value}_exports@test.local",
        hashed_password=auth.hash_password("testpassword123"),
        role=role,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = auth.create_access_token(user.id, user.role.value)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def role_headers(db_session) -> dict[UserRole, dict[str, str]]:
    return {
        UserRole.admin: await _create_role_headers(db_session, UserRole.admin),
        UserRole.editor: await _create_role_headers(db_session, UserRole.editor),
        UserRole.viewer: await _create_role_headers(db_session, UserRole.viewer),
    }


def _csv_dicts(response) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(response.text)))


def _csv_lines(response) -> list[list[str]]:
    return list(csv.reader(io.StringIO(response.text)))


def _assert_csv_download(response, filename: str) -> None:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    disposition = response.headers["content-disposition"]
    assert "attachment" in disposition
    assert filename in disposition


@pytest.fixture
async def audit_rows(db_session):
    rows = [
        AuditLog(
            timestamp=datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc),
            actor_email="alice.admin@test.local",
            ip_address="10.0.0.1",
            action="license.created",
            target_type="license",
            target_id="101",
            target_label="Atlas Suite",
            detail="created Atlas Suite",
        ),
        AuditLog(
            timestamp=datetime(2026, 1, 2, 9, 0, tzinfo=timezone.utc),
            actor_email="bob.editor@test.local",
            actor_token_id=42,
            actor_token_name="ci-pipeline",
            ip_address="10.0.0.2",
            action="license.updated",
            target_type="license",
            target_id="102",
            target_label="Beacon Tool",
            detail="supplier changed\nvia API token: ci-pipeline (42)",
        ),
        AuditLog(
            timestamp=datetime(2026, 1, 3, 9, 0, tzinfo=timezone.utc),
            actor_email="alice.admin@test.local",
            ip_address="10.0.0.3",
            action="user.deleted",
            target_type="user",
            target_id="7",
            target_label="former.user@test.local",
            detail="removed inactive account",
        ),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    return rows


async def test_audit_log_lists_descending_and_paginates(
    test_app,
    role_headers,
    audit_rows,
):
    first_page = await test_app.get(
        "/api/audit-log?page=1&page_size=2",
        headers=role_headers[UserRole.admin],
    )
    second_page = await test_app.get(
        "/api/audit-log?page=2&page_size=2",
        headers=role_headers[UserRole.admin],
    )

    assert first_page.status_code == 200
    first_data = first_page.json()
    assert first_data["total"] == 3
    assert first_data["page"] == 1
    assert first_data["page_size"] == 2
    assert [row["action"] for row in first_data["results"]] == [
        "user.deleted",
        "license.updated",
    ]

    assert second_page.status_code == 200
    second_data = second_page.json()
    assert second_data["total"] == 3
    assert [row["action"] for row in second_data["results"]] == ["license.created"]


async def test_audit_log_filters_by_actor_action_dates_and_search(
    test_app,
    role_headers,
    audit_rows,
):
    headers = role_headers[UserRole.admin]

    by_actor = await test_app.get(
        "/api/audit-log?actor_email=alice",
        headers=headers,
    )
    by_action = await test_app.get(
        "/api/audit-log?action=updated",
        headers=headers,
    )
    by_date = await test_app.get(
        "/api/audit-log?date_from=2026-01-02&date_to=2026-01-02",
        headers=headers,
    )
    by_search = await test_app.get(
        "/api/audit-log?search=Beacon",
        headers=headers,
    )

    assert by_actor.status_code == 200
    assert [row["action"] for row in by_actor.json()["results"]] == [
        "user.deleted",
        "license.created",
    ]

    assert by_action.status_code == 200
    assert by_action.json()["total"] == 1
    assert by_action.json()["results"][0]["targetLabel"] == "Beacon Tool"

    assert by_date.status_code == 200
    assert by_date.json()["total"] == 1
    assert by_date.json()["results"][0]["action"] == "license.updated"

    assert by_search.status_code == 200
    assert by_search.json()["total"] == 1
    assert by_search.json()["results"][0]["actorEmail"] == "bob.editor@test.local"


async def test_audit_log_filters_by_token_id_and_returns_token_fields(
    test_app,
    role_headers,
    audit_rows,
):
    headers = role_headers[UserRole.admin]

    by_token_id = await test_app.get(
        "/api/audit-log?actor_token_id=42",
        headers=headers,
    )
    assert by_token_id.status_code == 200
    data = by_token_id.json()
    assert data["total"] == 1
    result = data["results"][0]
    assert result["actorTokenId"] == 42
    assert result["actorTokenName"] == "ci-pipeline"

    # token name is also searchable via the general search param
    by_token_name = await test_app.get(
        "/api/audit-log?search=ci-pipeline",
        headers=headers,
    )
    assert by_token_name.status_code == 200
    assert by_token_name.json()["total"] == 1

    # unmatched token id returns no results
    no_match = await test_app.get(
        "/api/audit-log?actor_token_id=999",
        headers=headers,
    )
    assert no_match.status_code == 200
    assert no_match.json()["total"] == 0

    # human rows have null token fields
    human_row = await test_app.get(
        "/api/audit-log?action=license.created",
        headers=headers,
    )
    assert human_row.status_code == 200
    entry = human_row.json()["results"][0]
    assert entry["actorTokenId"] is None
    assert entry["actorTokenName"] is None


async def test_audit_log_role_access_for_list_and_export(
    test_app,
    role_headers,
    audit_rows,
):
    for path in ("/api/audit-log", "/api/audit-log/export"):
        unauthenticated = await test_app.get(path)
        viewer = await test_app.get(path, headers=role_headers[UserRole.viewer])
        editor = await test_app.get(path, headers=role_headers[UserRole.editor])
        admin = await test_app.get(path, headers=role_headers[UserRole.admin])

        assert unauthenticated.status_code == 401
        assert viewer.status_code == 403
        assert editor.status_code == 403
        assert admin.status_code == 200, admin.text


async def test_audit_log_export_uses_filters_and_csv_content(
    test_app,
    role_headers,
    audit_rows,
):
    response = await test_app.get(
        "/api/audit-log/export?action=license&search=Atlas",
        headers=role_headers[UserRole.admin],
    )

    _assert_csv_download(response, "audit_log.csv")
    lines = _csv_lines(response)
    assert lines[0] == [
        "timestamp",
        "actor_email",
        "actor_token_id",
        "actor_token_name",
        "ip_address",
        "action",
        "target_type",
        "target_id",
        "target_label",
        "detail",
    ]
    assert len(lines) == 2
    assert lines[1][1:] == [
        "alice.admin@test.local",
        "",  # actor_token_id
        "",  # actor_token_name
        "10.0.0.1",
        "license.created",
        "license",
        "101",
        "Atlas Suite",
        "created Atlas Suite",
    ]


async def test_licenses_export_headers_and_representative_csv_content(
    test_app,
    auth_headers,
    db_session,
):
    active = License(
        license_ref="LT-2026-00001",
        external_ref="ERP-1",
        publisher_name="Contoso",
        software_description="Contoso Analytics",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity="25",
        unit_price="12.00",
        # Deliberately stale stored aggregate: the export must derive
        # Total PO Value (25 × 12.00 = 300.00), not emit this column.
        total_po_price="999.99",
        currency="EUR",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        contract_number="CTR-1",
        po_number="PO-1",
        invoice_number="INV-1",
        contact_email="licensing@contoso.test",
        supplier="Contoso Direct",
        cost_centre="IT",
        budget_owner_email="owner@test.local",
        notes="primary export row",
    )
    retired = License(
        license_ref="LT-2026-00002",
        publisher_name="Retired Co",
        software_description="Retired Suite",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        is_retired=True,
    )
    db_session.add_all([active, retired])
    await db_session.commit()

    response = await test_app.get("/api/licenses/export", headers=auth_headers)

    _assert_csv_download(response, "licenses_export.csv")
    rows = _csv_dicts(response)
    assert len(rows) == 1
    row = rows[0]
    assert row["License Record ID"] == str(active.id)
    assert row["License Ref"] == "LT-2026-00001"
    assert row["External Ref"] == "ERP-1"
    assert row["Publisher"] == "Contoso"
    assert row["Software Description"] == "Contoso Analytics"
    assert row["Total PO Value"] == "300.00"
    assert row["Notes"] == "primary export row"


async def test_csv_export_endpoints_neutralize_formula_cells(
    test_app,
    auth_headers,
    db_session,
):
    license_obj = License(
        publisher_name="=HYPERLINK(\"http://example.test\")",
        software_description="+SUM(1,2)",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity="1",
        currency="EUR",
        notes="\t=cmd",
    )
    sourcing_item = SourcingItem(
        publisher_name="@sourcing",
        software_description="-10+20",
        quantity="1",
        currency="EUR",
        status=SourcingStatus.sourcing,
    )
    order = PendingOrder(
        po_number="\r=PO",
        supplier="@supplier",
        status=PendingOrderStatus.pending,
    )
    db_session.add_all([license_obj, sourcing_item, order])
    await db_session.flush()
    db_session.add(
        SourcingItem(
            pending_order_id=order.id,
            publisher_name="+pending",
            software_description="=line",
            quantity="1",
            currency="EUR",
            status=SourcingStatus.converted,
        )
    )
    await db_session.commit()

    license_resp = await test_app.get("/api/licenses/export", headers=auth_headers)
    sourcing_resp = await test_app.get("/api/sourcing/export", headers=auth_headers)
    pending_resp = await test_app.get("/api/pending-orders/export", headers=auth_headers)

    license_row = _csv_dicts(license_resp)[0]
    assert license_row["Publisher"].startswith("'=")
    assert license_row["Software Description"].startswith("'+")
    assert license_row["Notes"].startswith("'\t")

    sourcing_row = _csv_dicts(sourcing_resp)[0]
    assert sourcing_row["Publisher"].startswith("'@")
    assert sourcing_row["Software Description"].startswith("'-")

    pending_row = _csv_dicts(pending_resp)[0]
    assert pending_row["PO Number"].startswith("'\r")
    assert pending_row["Supplier"].startswith("'@")
    assert pending_row["Publisher"].startswith("'+")
    assert pending_row["Description"].startswith("'=")


async def test_sourcing_export_headers_and_representative_csv_content(
    test_app,
    auth_headers,
    db_session,
):
    request = SourcingRequest(
        supplier="Northwind Sales",
        status=SourcingStatus.sourcing,
    )
    db_session.add(request)
    await db_session.flush()
    item = SourcingItem(
        sourcing_request_id=request.id,
        publisher_name="Northwind",
        software_description="Northwind CRM",
        license_type=LicenseType.freeware,
        quantity="5",
        estimated_unit_price="20.00",
        estimated_total_price="100.00",
        currency="USD",
        supplier="Northwind Sales",
        contact_email="sales@northwind.test",
        status=SourcingStatus.sourcing,
        created_at=datetime(2026, 2, 1, 8, 0, tzinfo=timezone.utc),
    )
    converted = SourcingItem(
        publisher_name="Converted",
        software_description="Converted Item",
        status=SourcingStatus.converted,
    )
    db_session.add_all([item, converted])
    await db_session.commit()

    response = await test_app.get("/api/sourcing/export", headers=auth_headers)

    _assert_csv_download(response, "sourcing_export.csv")
    rows = _csv_dicts(response)
    assert len(rows) == 1
    row = rows[0]
    assert row["Sourcing Request ID"] == str(request.id)
    assert row["Sourcing Line ID"] == str(item.id)
    assert row["Publisher"] == "Northwind"
    assert row["Software Description"] == "Northwind CRM"
    assert row["License Type"] == "freeware"
    assert row["Purchase Quantity"] == "5"
    assert row["Est. Total Price"] == "100.00"
    assert row["Status"] == "sourcing"
    assert row["Is Renewal"] == "No"


async def test_pending_orders_export_headers_and_representative_csv_content(
    test_app,
    auth_headers,
    db_session,
):
    order = PendingOrder(
        po_number="PO-EXPORT-1",
        supplier="Fabrikam",
        status=PendingOrderStatus.pending,
        created_at=datetime(2026, 3, 1, 8, 0, tzinfo=timezone.utc),
    )
    converted_order = PendingOrder(
        po_number="PO-CONVERTED",
        supplier="Hidden",
        status=PendingOrderStatus.converted,
    )
    db_session.add_all([order, converted_order])
    await db_session.flush()
    first_item = SourcingItem(
        publisher_name="Fabrikam",
        software_description="Fabrikam ERP",
        quantity="1",
        estimated_unit_price="123.45",
        estimated_total_price="123.45",
        currency="EUR",
        status=SourcingStatus.converted,
        pending_order_id=order.id,
    )
    second_item = SourcingItem(
        publisher_name="Fabrikam",
        software_description="Fabrikam Security",
        quantity="2",
        estimated_unit_price="50.00",
        estimated_total_price="100.00",
        currency="EUR",
        status=SourcingStatus.converted,
        pending_order_id=order.id,
    )
    db_session.add_all([first_item, second_item])
    await db_session.commit()

    response = await test_app.get("/api/pending-orders/export", headers=auth_headers)

    _assert_csv_download(response, "pending_orders_export.csv")
    assert _csv_lines(response)[0] == [
        "Pending Order ID",
        "Pending Order Line ID",
        "PO Number",
        "Supplier",
        "Status",
        "Created Date",
        "PO Total Value",
        "Currency",
        "PO Line #",
        "Publisher",
        "Description",
        "Purchase Quantity",
        "License Unit Price",
        "Line Total",
    ]
    rows = _csv_dicts(response)
    assert len(rows) == 2
    assert [row["Pending Order ID"] for row in rows] == [str(order.id), str(order.id)]
    assert [row["Pending Order Line ID"] for row in rows] == [str(first_item.id), str(second_item.id)]
    assert [row["PO Number"] for row in rows] == ["PO-EXPORT-1", "PO-EXPORT-1"]
    assert [row["PO Line #"] for row in rows] == ["1", "2"]
    assert [row["Description"] for row in rows] == [
        "Fabrikam ERP",
        "Fabrikam Security",
    ]
    for row in rows:
        assert row["Supplier"] == "Fabrikam"
        assert row["Status"] == "pending"
        assert row["Created Date"] == "2026-03-01"
        assert row["PO Total Value"] == "223.45"
        assert row["Currency"] == "EUR"


async def test_pending_orders_export_includes_empty_orders_and_currency_totals(
    test_app,
    auth_headers,
    db_session,
):
    empty_order = PendingOrder(
        po_number="PO-EMPTY",
        supplier="No Items Ltd",
        status=PendingOrderStatus.pending,
        created_at=datetime(2026, 4, 2, 8, 0, tzinfo=timezone.utc),
    )
    mixed_currency_order = PendingOrder(
        po_number="PO-MIXED",
        supplier="Global Supplier",
        status=PendingOrderStatus.pending,
        created_at=datetime(2026, 4, 1, 8, 0, tzinfo=timezone.utc),
    )
    db_session.add_all([empty_order, mixed_currency_order])
    await db_session.flush()
    db_session.add_all(
        [
            SourcingItem(
                publisher_name="Euro Publisher",
                software_description="Euro App",
                estimated_total_price="100.10",
                currency="EUR",
                status=SourcingStatus.converted,
                pending_order_id=mixed_currency_order.id,
            ),
            SourcingItem(
                publisher_name="Dollar Publisher",
                software_description="Dollar App",
                estimated_total_price="250.25",
                currency="USD",
                status=SourcingStatus.converted,
                pending_order_id=mixed_currency_order.id,
            ),
            SourcingItem(
                publisher_name="Euro Publisher",
                software_description="Invalid Total App",
                estimated_total_price="not-a-number",
                currency="EUR",
                status=SourcingStatus.converted,
                pending_order_id=mixed_currency_order.id,
            ),
        ]
    )
    await db_session.commit()

    response = await test_app.get("/api/pending-orders/export", headers=auth_headers)

    _assert_csv_download(response, "pending_orders_export.csv")
    rows = _csv_dicts(response)
    assert [row["PO Number"] for row in rows] == [
        "PO-EMPTY",
        "PO-MIXED",
        "PO-MIXED",
        "PO-MIXED",
    ]

    empty_row = rows[0]
    assert empty_row["Pending Order ID"] == str(empty_order.id)
    assert empty_row["Pending Order Line ID"] == ""
    assert empty_row["Supplier"] == "No Items Ltd"
    assert empty_row["Created Date"] == "2026-04-02"
    assert empty_row["PO Line #"] == ""
    assert empty_row["Publisher"] == ""
    assert empty_row["PO Total Value"] == ""

    euro_row = rows[1]
    usd_row = rows[2]
    invalid_total_row = rows[3]
    assert euro_row["Currency"] == "EUR"
    assert euro_row["PO Total Value"] == "100.10"
    assert usd_row["Currency"] == "USD"
    assert usd_row["PO Total Value"] == "250.25"
    assert invalid_total_row["Currency"] == "EUR"
    assert invalid_total_row["PO Total Value"] == "100.10"


async def test_import_template_download_headers_and_body(
    test_app,
    auth_headers,
):
    response = await test_app.get("/api/import/template", headers=auth_headers)

    _assert_csv_download(response, "license_lifecycle_template.csv")
    lines = _csv_lines(response)
    assert lines[0][:4] == [
        "publisher_name",
        "software_description",
        "start_date",
        "end_date",
    ]
    assert lines[1][:2] == ["Microsoft", "Microsoft 365 Business Premium"]
