"""add sourcing requests

Revision ID: b6c7d8e9f0a1
Revises: f0a1b2c3d4e5
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b6c7d8e9f0a1"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sourcing_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("supplier", sa.String(length=255), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.Enum("sourcing", "converted", name="sourcingstatus"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "sourcing_quote_documents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("sourcing_request_id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column("original_filename", sa.String(length=500), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["sourcing_request_id"], ["sourcing_requests.id"]),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_sourcing_quote_documents_sourcing_request_id"),
        "sourcing_quote_documents",
        ["sourcing_request_id"],
        unique=False,
    )

    with op.batch_alter_table("sourcing_items") as batch_op:
        batch_op.add_column(sa.Column("sourcing_request_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_sourcing_items_sourcing_request_id"),
            ["sourcing_request_id"],
            unique=False,
        )
        batch_op.create_foreign_key(
            "fk_sourcing_items_sourcing_request_id_sourcing_requests",
            "sourcing_requests",
            ["sourcing_request_id"],
            ["id"],
        )

    connection = op.get_bind()
    items = connection.execute(
        sa.text(
            """
            SELECT id, supplier, contact_email, notes, status, created_at, updated_at, created_by
            FROM sourcing_items
            WHERE sourcing_request_id IS NULL
            """
        )
    ).mappings().all()
    for item in items:
        result = connection.execute(
            sa.text(
                """
                INSERT INTO sourcing_requests
                    (supplier, contact_email, notes, status, created_at, updated_at, created_by)
                VALUES
                    (:supplier, :contact_email, :notes, :status, :created_at, :updated_at, :created_by)
                """
            ),
            {
                "supplier": item["supplier"],
                "contact_email": item["contact_email"],
                "notes": item["notes"],
                "status": item["status"],
                "created_at": item["created_at"],
                "updated_at": item["updated_at"],
                "created_by": item["created_by"],
            },
        )
        request_id = result.lastrowid
        connection.execute(
            sa.text("UPDATE sourcing_items SET sourcing_request_id = :request_id WHERE id = :item_id"),
            {"request_id": request_id, "item_id": item["id"]},
        )


def downgrade() -> None:
    with op.batch_alter_table("sourcing_items") as batch_op:
        batch_op.drop_constraint("fk_sourcing_items_sourcing_request_id_sourcing_requests", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_sourcing_items_sourcing_request_id"))
        batch_op.drop_column("sourcing_request_id")

    op.drop_index(op.f("ix_sourcing_quote_documents_sourcing_request_id"), table_name="sourcing_quote_documents")
    op.drop_table("sourcing_quote_documents")
    op.drop_table("sourcing_requests")
