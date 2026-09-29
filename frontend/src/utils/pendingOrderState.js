// Mirrors backend/app/services/pending_order_state.py; a backend test checks
// that both lists match. Open orders can be edited, cancelled and converted.
export const OPEN_PENDING_ORDER_STATUSES = ["pending", "invoice_received"];

export function isPendingOrderOpen(order) {
  return OPEN_PENDING_ORDER_STATUSES.includes(order?.status);
}
