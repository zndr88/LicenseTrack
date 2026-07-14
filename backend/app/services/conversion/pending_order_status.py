from app.models.pending_order import PendingOrder, PendingOrderStatus
from app.models.sourcing import SourcingStatus


def mark_item_converted(item) -> None:
    item.status = SourcingStatus.converted


def refresh_order_status(order: PendingOrder) -> None:
    all_items_converted = all(item.status == SourcingStatus.converted for item in order.items)
    order.status = PendingOrderStatus.converted if all_items_converted else PendingOrderStatus.invoice_received
