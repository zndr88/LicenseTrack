from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Text, Integer, ForeignKey, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Contract(Base):
    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contract_number: Mapped[str] = mapped_column(String(255), nullable=False)
    publisher_name: Mapped[str] = mapped_column(String(255), nullable=False)
    publisher_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    folders: Mapped[list["ContractFolder"]] = relationship(
        "ContractFolder", back_populates="contract", cascade="all, delete-orphan"
    )


class ContractFolder(Base):
    __tablename__ = "contract_folders"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contract_id: Mapped[int] = mapped_column(Integer, ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    contract: Mapped["Contract"] = relationship("Contract", back_populates="folders")
    documents: Mapped[list["ContractDocument"]] = relationship(
        "ContractDocument", back_populates="folder", cascade="all, delete-orphan"
    )


class ContractDocument(Base):
    __tablename__ = "contract_documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contract_id: Mapped[int] = mapped_column(Integer, ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    folder_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("contract_folders.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    folder: Mapped["ContractFolder | None"] = relationship("ContractFolder", back_populates="documents")
