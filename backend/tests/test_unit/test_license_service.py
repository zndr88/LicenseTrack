"""
Unit tests for app.services.license_service.

Pure-function tests — no fixtures required. Fake license/document objects
are built with types.SimpleNamespace so no ORM models or DB session are needed.
"""

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from app.models.license import LicenseType
from app.services.license_service import (
    calc_effective_quantity,
    calc_recurring_annual_cost,
    compute_completeness,
    compute_days_until_expiry,
    compute_expiration_status,
    compute_stats,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_license(**kwargs) -> SimpleNamespace:
    """Return a minimal fake License with sensible defaults."""
    defaults = {
        "id": 1,
        "is_retired": False,
        "lifecycle_status": None,
        "end_date": None,
        "start_date": None,
        "is_completeness_exempt": False,
        "contract_number": "",
        "po_number": "",
        "invoice_number": "",
        "contact_email": "",
        "cost_centre": "",
        "budget_owner_email": "",
        "quantity": "1",
        "unit_price": "0",
        "renewed_to_id": None,
        "license_type": "subscription",
        "currency": "EUR",
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def make_doc(category_value: str) -> SimpleNamespace:
    """Return a minimal fake Document with a .category.value attribute."""
    return SimpleNamespace(category=SimpleNamespace(value=category_value))


# ---------------------------------------------------------------------------
# 2a — compute_expiration_status
# ---------------------------------------------------------------------------

def test_status_retired():
    assert compute_expiration_status(make_license(is_retired=True), date.today()) == "retired"


def test_calc_effective_quantity_uses_purchase_quantity_multiplier():
    assert calc_effective_quantity("7", "5") == 35
    assert calc_effective_quantity("7", "") == 7
    assert calc_effective_quantity("7", "0") == 0


def test_calc_recurring_annual_cost_annualizes_multi_year_terms():
    lic = make_license(
        start_date=date(2025, 1, 1),
        end_date=date(2029, 12, 31),
        license_type="subscription",
        quantity="1",
        unit_price="18000000",
    )

    assert round(calc_recurring_annual_cost(lic), 2) == Decimal("3598028.48")


def test_calc_recurring_annual_cost_keeps_one_year_terms_stable():
    lic = make_license(
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        license_type="subscription",
        quantity="1",
        unit_price="12000",
    )

    assert calc_recurring_annual_cost(lic) == 12000


def test_status_legacy():
    assert compute_expiration_status(make_license(lifecycle_status="legacy"), date.today()) == "legacy"


def test_status_renewed():
    assert compute_expiration_status(make_license(lifecycle_status="renewed"), date.today()) == "renewed"


def test_status_pending_renewal():
    assert (
        compute_expiration_status(make_license(lifecycle_status="pending_renewal"), date.today())
        == "pending_renewal"
    )


def test_status_upcoming():
    today = date.today()
    assert (
        compute_expiration_status(
            make_license(start_date=today + timedelta(days=10), end_date=today + timedelta(days=370)),
            today,
        )
        == "upcoming"
    )


def test_status_upcoming_before_perpetual():
    today = date.today()
    assert (
        compute_expiration_status(
            make_license(start_date=today + timedelta(days=10), end_date=None),
            today,
        )
        == "upcoming"
    )


def test_status_perpetual():
    assert (
        compute_expiration_status(
            make_license(license_type=LicenseType.perpetual, end_date=None),
            date.today(),
        )
        == "perpetual"
    )


def test_recurring_license_without_end_date_is_not_called_perpetual():
    assert compute_expiration_status(make_license(end_date=None), date.today()) == "active"


def test_status_expired():
    yesterday = date.today() - timedelta(days=1)
    assert compute_expiration_status(make_license(end_date=yesterday), date.today()) == "expired"


def test_status_expiring():
    soon = date.today() + timedelta(days=15)
    assert (
        compute_expiration_status(make_license(end_date=soon), date.today(), notification_days=30)
        == "expiring"
    )


def test_status_active():
    far = date.today() + timedelta(days=60)
    assert (
        compute_expiration_status(make_license(end_date=far), date.today(), notification_days=30)
        == "active"
    )


# ---------------------------------------------------------------------------
# 2b — compute_days_until_expiry
# ---------------------------------------------------------------------------

def test_days_until_expiry_none():
    today = date.today()
    assert compute_days_until_expiry(make_license(end_date=None), today) is None


def test_days_until_expiry_positive():
    today = date.today()
    lic = make_license(end_date=today + timedelta(days=10))
    assert compute_days_until_expiry(lic, today) == 10


def test_days_until_expiry_negative():
    today = date.today()
    lic = make_license(end_date=today - timedelta(days=1))
    assert compute_days_until_expiry(lic, today) == -1


# ---------------------------------------------------------------------------
# 2c — compute_completeness
# ---------------------------------------------------------------------------

def test_completeness_exempt_returns_none():
    lic = make_license(is_completeness_exempt=True)
    assert compute_completeness(lic, [], {"invoice": True}) is None


def test_completeness_no_mandatory_fields():
    assert compute_completeness(make_license(), [], {}) == 100


def test_completeness_missing_invoice():
    assert compute_completeness(make_license(), [], {"invoice": True}) == 0


def test_completeness_with_invoice_doc():
    docs = [make_doc("invoice")]
    assert compute_completeness(make_license(), docs, {"invoice": True}) == 100


def test_completeness_partial():
    # invoice present, startDate absent → 1/2 = 50 %
    lic = make_license(start_date=None)
    docs = [make_doc("invoice")]
    assert compute_completeness(lic, docs, {"invoice": True, "startDate": True}) == 50


def test_completeness_disabled_field():
    # invoice disabled → no enabled keys → 100 %
    assert compute_completeness(make_license(), [], {"invoice": False}) == 100


def test_completeness_end_date_allows_non_expiring_license_types_without_date():
    for license_type in ("perpetual", "oem", "freeware", "service", "other"):
        assert compute_completeness(
            make_license(license_type=license_type, end_date=None),
            [],
            {"endDate": True},
        ) == 100


def test_completeness_end_date_requires_date_for_recurring_license_types():
    for license_type in ("subscription", "saas", "maintenance"):
        assert compute_completeness(
            make_license(license_type=license_type, end_date=None),
            [],
            {"endDate": True},
        ) == 0


def test_completeness_with_purchase_order_and_quote_docs():
    docs = [make_doc("purchase_order"), make_doc("quote")]
    assert compute_completeness(
        make_license(),
        docs,
        {"purchaseOrder": True, "quote": True},
    ) == 100


def test_completeness_with_new_record_fields():
    lic = make_license(
        cost_centre="Finance",
        budget_owner_email="owner@example.com",
        invoice_number="INV-100",
    )
    assert compute_completeness(
        lic,
        [],
        {"costCentre": True, "budgetOwnerEmail": True, "invoiceNumber": True},
    ) == 100


def test_completeness_excludes_inapplicable_requirements_for_freeware():
    lic = make_license(
        license_type="freeware",
        cost_centre="Finance",
    )
    assert compute_completeness(
        lic,
        [],
        {
            "invoice": True,
            "invoiceNumber": True,
            "contractNumber": True,
            "poNumber": True,
            "purchaseOrder": True,
            "quote": True,
            "costCentre": True,
            "budgetOwnerEmail": True,
            "eula": True,
            "entitlement": True,
            "contactEmail": True,
        },
    ) == 50


def test_completeness_excludes_entitlement_requirements_for_service_and_other():
    for license_type in ("service", "other"):
        assert compute_completeness(
            make_license(license_type=license_type, contract_number="CTR-100"),
            [],
            {
                "contractNumber": True,
                "eula": True,
                "entitlement": True,
            },
        ) == 100


# ---------------------------------------------------------------------------
# 2d — compute_stats
# ---------------------------------------------------------------------------

def test_compute_stats():
    today = date.today()
    lic_active   = make_license(id=1, end_date=today + timedelta(days=60))   # → "active"
    lic_expiring = make_license(id=2, end_date=today + timedelta(days=10))   # → "expiring"
    lic_expired  = make_license(id=3, end_date=today - timedelta(days=1))    # → "expired"

    lic_upcoming = make_license(
        id=4,
        start_date=today + timedelta(days=30),
        end_date=today + timedelta(days=395),
    )

    stats = compute_stats(
        licenses=[lic_active, lic_expiring, lic_expired, lic_upcoming],
        documents_by_license_id={},
        mandatory_fields={},
        notification_days=30,
    )

    assert stats["total"] == 4
    assert stats["total_active"] == 2    # active + expiring both count
    assert stats["total_expiring"] == 1
    assert stats["total_expired"] == 1
    assert stats["total_upcoming"] == 1


def test_compute_stats_excludes_perpetual_capex_from_annual_cost():
    today = date.today()
    recurring = make_license(
        id=1,
        end_date=today + timedelta(days=60),
        license_type="subscription",
        quantity="2",
        unit_price="50",
    )
    perpetual = make_license(
        id=2,
        end_date=None,
        license_type="perpetual",
        quantity="10",
        unit_price="999",
    )
    maintenance = make_license(
        id=3,
        end_date=today + timedelta(days=30),
        license_type="maintenance",
        quantity="1",
        unit_price="75",
    )

    stats = compute_stats(
        licenses=[recurring, perpetual, maintenance],
        documents_by_license_id={},
        mandatory_fields={},
        notification_days=30,
    )

    assert stats["annual_cost_by_currency"] == {"EUR": 175.0}


def test_compute_stats_annualizes_multi_year_recurring_cost():
    lic = make_license(
        id=1,
        start_date=date(2025, 1, 1),
        end_date=date(2029, 12, 31),
        license_type="subscription",
        quantity="1",
        unit_price="18000000",
    )

    stats = compute_stats(
        licenses=[lic],
        documents_by_license_id={},
        mandatory_fields={},
        notification_days=30,
    )

    assert round(stats["annual_cost_by_currency"]["EUR"], 2) == 3598028.48


def test_compute_stats_excludes_service_and_other_from_annual_cost():
    today = date.today()
    recurring = make_license(
        id=1,
        end_date=today + timedelta(days=60),
        license_type="subscription",
        quantity="2",
        unit_price="50",
    )
    service = make_license(
        id=2,
        end_date=None,
        license_type="service",
        quantity="1",
        unit_price="10000",
    )
    other = make_license(
        id=3,
        end_date=None,
        license_type="other",
        quantity="1",
        unit_price="5000",
    )

    stats = compute_stats(
        licenses=[recurring, service, other],
        documents_by_license_id={},
        mandatory_fields={},
        notification_days=30,
    )

    assert stats["annual_cost_by_currency"] == {"EUR": 100.0}


def test_compute_stats_excludes_upcoming_recurring_license_from_annual_cost():
    today = date.today()
    active = make_license(
        id=1,
        end_date=today + timedelta(days=60),
        license_type="subscription",
        quantity="2",
        unit_price="50",
    )
    upcoming = make_license(
        id=2,
        start_date=today + timedelta(days=60),
        end_date=today + timedelta(days=425),
        license_type="subscription",
        quantity="1",
        unit_price="999",
    )

    stats = compute_stats(
        licenses=[active, upcoming],
        documents_by_license_id={},
        mandatory_fields={},
        notification_days=30,
    )

    assert stats["annual_cost_by_currency"] == {"EUR": 100.0}


def test_compute_stats_excludes_expired_recurring_license_from_annual_cost():
    today = date.today()
    active = make_license(
        id=1,
        end_date=today + timedelta(days=60),
        license_type="subscription",
        quantity="2",
        unit_price="50",
    )
    expired = make_license(
        id=2,
        end_date=today - timedelta(days=1),
        license_type="subscription",
        quantity="1",
        unit_price="999",
    )

    stats = compute_stats(
        licenses=[active, expired],
        documents_by_license_id={},
        mandatory_fields={},
        notification_days=30,
    )

    assert stats["annual_cost_by_currency"] == {"EUR": 100.0}


# ---------------------------------------------------------------------------
# 2e — compute_stats excluded_from_totals
# ---------------------------------------------------------------------------

def test_compute_stats_includes_excluded_from_totals_key():
    stats = compute_stats(
        licenses=[make_license(id=1, quantity="1", unit_price="100")],
        documents_by_license_id={},
        mandatory_fields={},
    )
    assert "excluded_from_totals" in stats


def test_compute_stats_zero_excluded_when_all_canonical():
    lic = make_license(id=1, license_type="subscription", quantity="2", unit_price="50")
    stats = compute_stats(
        licenses=[lic],
        documents_by_license_id={},
        mandatory_fields={},
    )
    assert stats["excluded_from_totals"] == 0
    assert stats["annual_cost_by_currency"] == {"EUR": 100.0}


def test_compute_stats_non_canonical_unit_price_excluded_from_totals():
    """A subscription license with a non-canonical unit_price is counted in
    excluded_from_totals and contributes nothing to annual_cost_by_currency."""
    lic = make_license(
        id=1,
        license_type="subscription",
        quantity="2",
        unit_price="€50",  # non-canonical
    )
    stats = compute_stats(
        licenses=[lic],
        documents_by_license_id={},
        mandatory_fields={},
    )
    assert stats["excluded_from_totals"] == 1
    assert stats["annual_cost_by_currency"] == {}


def test_compute_stats_non_canonical_quantity_excluded_from_totals():
    """A subscription license with a non-canonical quantity is counted in
    excluded_from_totals and contributes nothing to annual_cost_by_currency."""
    lic = make_license(
        id=1,
        license_type="subscription",
        quantity="2,0",  # non-canonical
        unit_price="50",
    )
    stats = compute_stats(
        licenses=[lic],
        documents_by_license_id={},
        mandatory_fields={},
    )
    assert stats["excluded_from_totals"] == 1
    assert stats["annual_cost_by_currency"] == {}


def test_compute_stats_excluded_license_still_counted_in_totals():
    """Exclusion from cost aggregation must not hide the license from status counts."""
    lic = make_license(
        id=1,
        license_type="subscription",
        quantity="1",
        unit_price="1,234.50",  # non-canonical
    )
    stats = compute_stats(
        licenses=[lic],
        documents_by_license_id={},
        mandatory_fields={},
    )
    assert stats["total"] == 1
    assert stats["total_active"] == 1
    assert stats["excluded_from_totals"] == 1


def test_compute_stats_mixed_canonical_and_non_canonical():
    """Only the license with non-canonical values is excluded; the valid one contributes normally."""
    today = date.today()
    good = make_license(
        id=1,
        license_type="subscription",
        quantity="3",
        unit_price="100",
        end_date=today + timedelta(days=60),
    )
    bad = make_license(
        id=2,
        license_type="subscription",
        quantity="1",
        unit_price="1.234,50",  # non-canonical EU format
        end_date=today + timedelta(days=60),
    )
    stats = compute_stats(
        licenses=[good, bad],
        documents_by_license_id={},
        mandatory_fields={},
    )
    assert stats["excluded_from_totals"] == 1
    assert stats["annual_cost_by_currency"] == {"EUR": 300.0}
