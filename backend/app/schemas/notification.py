"""
Pydantic schemas for the notifications endpoint.
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

NotificationType = Literal["expiring", "expired", "incomplete", "notice_due"]
NotificationSeverity = Literal["critical", "warning", "info"]


class NotificationItem(BaseModel):
    license_id: int
    software_name: str
    publisher: str
    type: NotificationType
    detail: str
    severity: NotificationSeverity
    relevant_date: Optional[date]

    model_config = {"from_attributes": True}
