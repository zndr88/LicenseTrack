import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.license import LicenseType, MaintenanceCoverage, MaintenancePricingBasis


class SourcingStatus(str, enum.Enum):
    sourcing = "sourcing"
    converted = "converted"
    cancelled = "cancelled"


class SourcingRequest(Base):
    __tablename__ = "sourcing_requests"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    supplier_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True, index=True
    )
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[SourcingStatus] = mapped_column(
        Enum(SourcingStatus), nullable=False, default=SourcingStatus.sourcing
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    items: Mapped[list["SourcingItem"]] = relationship(
        "SourcingItem",
        back_populates="sourcing_request",
        foreign_keys="[SourcingItem.sourcing_request_id]",
        cascade="all, delete-orphan",
    )
    quote_documents: Mapped[list["SourcingQuoteDocument"]] = relationship(
        "SourcingQuoteDocument",
        back_populates="sourcing_request",
        cascade="all, delete-orphan",
    )


class SourcingQuoteDocument(Base):
    __tablename__ = "sourcing_quote_documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sourcing_request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sourcing_requests.id"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    sourcing_request: Mapped["SourcingRequest"] = relationship("SourcingRequest", back_populates="quote_documents")


class SourcingItem(Base):
    __tablename__ = "sourcing_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sourcing_request_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sourcing_requests.id"), nullable=True, index=True
    )
    publisher_name: Mapped[str] = mapped_column(String(255), nullable=False)
    publisher_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True, index=True
    )
    software_description: Mapped[str] = mapped_column(String(500), nullable=False)
    license_type: Mapped[LicenseType | None] = mapped_column(Enum(LicenseType), nullable=True)
    maintenance_coverage: Mapped[MaintenanceCoverage | None] = mapped_column(
        Enum(MaintenanceCoverage), nullable=True
    )
    maintenance_start_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    maintenance_end_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    maintenance_pricing_basis: Mapped[MaintenancePricingBasis | None] = mapped_column(
        Enum(MaintenancePricingBasis), nullable=True
    )
    maintenance_quantity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    maintenance_unit_price: Mapped[str | None] = mapped_column(String(50), nullable=True)
    maintenance_cost: Mapped[str | None] = mapped_column(String(50), nullable=True)
    parent_sourcing_item_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("sourcing_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    quantity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    estimated_unit_price: Mapped[str | None] = mapped_column(String(50), nullable=True)
    estimated_total_price: Mapped[str | None] = mapped_column(String(50), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="EUR")
    start_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    supplier_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True, index=True
    )
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[SourcingStatus] = mapped_column(
        Enum(SourcingStatus), nullable=False, default=SourcingStatus.sourcing
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    pending_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pending_orders.id"), nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    sourcing_request: Mapped["SourcingRequest | None"] = relationship(  # noqa: F821
        "SourcingRequest", back_populates="items", foreign_keys=[sourcing_request_id]
    )

    @property
    def quote_documents(self) -> list["SourcingQuoteDocument"]:
        if "sourcing_request" not in self.__dict__ or self.sourcing_request is None:
            return []
        if "quote_documents" not in self.sourcing_request.__dict__:
            return []
        return list(self.sourcing_request.quote_documents)

    pending_order: Mapped["PendingOrder | None"] = relationship(  # noqa: F821
        "PendingOrder", back_populates="items", foreign_keys=[pending_order_id]
    )
    parent_sourcing_item: Mapped["SourcingItem | None"] = relationship(
        "SourcingItem",
        remote_side="SourcingItem.id",
        foreign_keys=[parent_sourcing_item_id],
    )
    converted_licenses: Mapped[list["License"]] = relationship(  # noqa: F821
        "License",
        back_populates="source_sourcing_item",
        foreign_keys="[License.source_sourcing_item_id]",
        viewonly=True,
    )

    @property
    def converted_license_ids(self) -> list[int]:
        licenses = self.__dict__.get("converted_licenses", [])
        return [license_obj.id for license_obj in licenses]

    @property
    def converted_license_id(self) -> int | None:
        licenses = list(self.__dict__.get("converted_licenses", []))
        return licenses[0].id if len(licenses) == 1 else None

    @property
    def converted_license_ref(self) -> str | None:
        licenses = list(self.__dict__.get("converted_licenses", []))
        return licenses[0].license_ref if len(licenses) == 1 else None

    @property
    def converted_license_retired(self) -> bool:
        licenses = list(self.__dict__.get("converted_licenses", []))
        return bool(licenses[0].is_retired) if len(licenses) == 1 else False

    @property
    def pending_order_status(self) -> str | None:
        pending_order = self.__dict__.get("pending_order")
        if pending_order is None:
            return None
        status = pending_order.status
        return getattr(status, "value", status)

    @property
    def pending_order_po_number(self) -> str | None:
        pending_order = self.__dict__.get("pending_order")
        return pending_order.po_number if pending_order is not None else None

    renewal_for_license_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("licenses.id"), nullable=True)
    renewal_for_license: Mapped["License | None"] = relationship(  # noqa: F821
        "License", foreign_keys=[renewal_for_license_id]
    )
    # Populated only on coterm-merged sourcing items; stores all predecessor
    # license IDs (including the primary), ordered oldest-first by start_date.
    coterm_predecessor_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
