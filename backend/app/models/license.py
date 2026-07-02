import enum
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, Enum, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class LicenseType(str, enum.Enum):
    subscription = "subscription"
    perpetual = "perpetual"
    maintenance = "maintenance"
    saas = "saas"
    oem = "oem"
    freeware = "freeware"


class MaintenanceCoverage(str, enum.Enum):
    unknown = "unknown"
    not_applicable = "not_applicable"
    included = "included"
    separately_tracked = "separately_tracked"


class LicenseMetric(str, enum.Enum):
    per_user = "per_user"
    per_device = "per_device"
    per_cpu = "per_cpu"
    per_core = "per_core"
    site = "site"
    concurrent = "concurrent"
    enterprise = "enterprise"


class LifecycleStatus(str, enum.Enum):
    pending_renewal = "pending_renewal"
    renewed = "renewed"
    legacy = "legacy"


class License(Base):
    __tablename__ = "licenses"
    __table_args__ = (
        CheckConstraint(
            "NOT (license_type = 'perpetual' AND end_date IS NOT NULL)",
            name="ck_license_perpetual_no_end_date",
        ),
        CheckConstraint(
            "(license_type = 'maintenance' AND parent_license_id IS NOT NULL) "
            "OR (license_type != 'maintenance' AND parent_license_id IS NULL) "
            "OR (license_type = 'maintenance' AND parent_license_id IS NULL AND is_retired = 1)",
            name="ck_license_maintenance_has_parent",
        ),
        CheckConstraint(
            "(has_maintenance = 1 AND active_maintenance_id IS NOT NULL) "
            "OR (has_maintenance = 0 AND active_maintenance_id IS NULL)",
            name="ck_license_maintenance_link_consistency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Core identification
    publisher_name: Mapped[str] = mapped_column(String(255), nullable=False)
    software_description: Mapped[str] = mapped_column(String(500), nullable=False)

    # License classification
    license_type: Mapped[LicenseType] = mapped_column(Enum(LicenseType), nullable=False)
    license_metric: Mapped[LicenseMetric] = mapped_column(Enum(LicenseMetric), nullable=False)
    portal_url: Mapped[str | None] = mapped_column(String, nullable=True, default=None)

    # Quantity & pricing — stored as strings per spec (can be blank/free-form)
    quantity: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    sku_code: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    unit_price: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    total_po_price: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="EUR")

    # Dates — end_date nullable (perpetual licenses have none)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Contract & procurement references
    contract_number: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    contract_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("contracts.id", use_alter=True, name="fk_license_contract"), nullable=True, index=True
    )
    po_number: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    invoice_number: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    pending_order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pending_orders.id"), nullable=True, index=True
    )
    request_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    purchase_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Contacts & ownership
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    supplier: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    cost_centre: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    budget_owner_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    # Free-text notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Mirror fields -- denormalized copies of the linked active
    # maintenance License's fields. Kept in sync by service logic.
    # Present on perpetual/oem/freeware parent licenses; null on others.
    has_maintenance: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    maintenance_coverage: Mapped[MaintenanceCoverage] = mapped_column(
        Enum(MaintenanceCoverage),
        nullable=False,
        default=MaintenanceCoverage.unknown,
        server_default=MaintenanceCoverage.unknown.value,
    )
    maintenance_start_date: Mapped[date | None] = mapped_column(
        Date, nullable=True
    )
    maintenance_end_date: Mapped[date | None] = mapped_column(
        Date, nullable=True
    )
    maintenance_cost: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )

    # Lifecycle-stable reference — assigned once at creation,
    # carried forward through renewals unchanged
    license_ref: Mapped[str | None] = mapped_column(
        String(20), nullable=True, index=True
    )

    # External system integration fields
    external_ref: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sync_status: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )

    # Soft delete / lifecycle
    is_retired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    lifecycle_status: Mapped[LifecycleStatus | None] = mapped_column(Enum(LifecycleStatus), nullable=True)
    is_completeness_exempt: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Renewal chain: a license can reference the one it was renewed from/to
    renewed_from_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("licenses.id", use_alter=True, name="fk_license_renewed_from"), nullable=True
    )
    renewed_to_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("licenses.id", use_alter=True, name="fk_license_renewed_to"), nullable=True
    )

    # Structural predecessor link — points at the license this record supersedes.
    # Populated during renewal conversion and CSV import of renewal rows.
    # Display logic is unchanged; the LT ref still shows as before.
    predecessor_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("licenses.id", use_alter=True, name="fk_license_predecessor"),
        nullable=True,
        index=True,
    )

    # Maintenance linkage -- populated on maintenance-type Licenses,
    # points at the parent perpetual/oem/freeware License.
    parent_license_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "licenses.id",
            use_alter=True,
            name="fk_license_parent",
            ondelete="SET NULL",
        ),
        nullable=True,
        index=True,
    )

    # Points at the currently active maintenance-type License child.
    # Present on perpetual/oem/freeware parents; null when no maintenance
    # is tracked.
    active_maintenance_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "licenses.id",
            use_alter=True,
            name="fk_license_active_maintenance",
        ),
        nullable=True,
    )

    # Coterm renewal: populated when this license was created from a merged coterm sourcing item.
    # Stores all predecessor license IDs (including the primary), ordered oldest-first.
    coterm_from_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)

    # Audit
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    creator: Mapped["User | None"] = relationship(  # noqa: F821
        "User", back_populates="licenses_created", foreign_keys=[created_by]
    )
    documents: Mapped[list["Document"]] = relationship(  # noqa: F821
        "Document", back_populates="license", cascade="all, delete-orphan"
    )
    renewed_from: Mapped["License | None"] = relationship(
        "License", foreign_keys=[renewed_from_id], remote_side="License.id", post_update=True
    )
    renewed_to: Mapped["License | None"] = relationship(
        "License", foreign_keys=[renewed_to_id], remote_side="License.id", post_update=True
    )
    parent_license: Mapped["License | None"] = relationship(
        "License",
        foreign_keys=[parent_license_id],
        remote_side="License.id",
        post_update=True,
    )
    active_maintenance: Mapped["License | None"] = relationship(
        "License",
        foreign_keys=[active_maintenance_id],
        remote_side="License.id",
        post_update=True,
    )
    @property
    def created_by_email(self) -> str | None:
        creator = self.__dict__.get("creator")
        return creator.email if creator is not None else None

    @property
    def created_by_name(self) -> str | None:
        creator = self.__dict__.get("creator")
        return creator.username if creator is not None else None
