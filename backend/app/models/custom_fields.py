from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CustomFieldDefinition(Base):
    __tablename__ = "custom_field_definitions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    field_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    field_type: Mapped[str] = mapped_column(String(20), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    section: Mapped[str | None] = mapped_column(String(50), nullable=True, default=None)
    carry_forward_on_renewal: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    values: Mapped[list["CustomFieldValue"]] = relationship(
        "CustomFieldValue", back_populates="definition", cascade="all, delete-orphan"
    )


class CustomFieldValue(Base):
    __tablename__ = "license_custom_values"

    __table_args__ = (UniqueConstraint("license_id", "custom_field_def_id", name="uq_license_custom_field"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    license_id: Mapped[int] = mapped_column(Integer, ForeignKey("licenses.id", ondelete="CASCADE"), nullable=False)
    custom_field_def_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("custom_field_definitions.id", ondelete="CASCADE"), nullable=False
    )
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_currency: Mapped[str | None] = mapped_column(String(50), nullable=True)

    definition: Mapped["CustomFieldDefinition"] = relationship("CustomFieldDefinition", back_populates="values")
    license: Mapped["License"] = relationship("License")  # noqa: F821


class SourcingItemCustomFieldValue(Base):
    """A reviewable custom-field snapshot carried through procurement."""

    __tablename__ = "sourcing_item_custom_values"
    __table_args__ = (
        UniqueConstraint("sourcing_item_id", "custom_field_def_id", name="uq_sourcing_item_custom_field"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sourcing_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sourcing_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    custom_field_def_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("custom_field_definitions.id", ondelete="CASCADE"), nullable=False
    )
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_currency: Mapped[str | None] = mapped_column(String(50), nullable=True)

    definition: Mapped["CustomFieldDefinition"] = relationship("CustomFieldDefinition")
    sourcing_item: Mapped["SourcingItem"] = relationship(  # noqa: F821
        "SourcingItem", back_populates="custom_field_values"
    )
