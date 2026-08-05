export function pendingOrderLabel(order) {
  if (!order) return "Pending Order";
  const poNumber = String(order.poNumber ?? "").trim();
  return poNumber || `Pending Order #${order.id}`;
}

export function pendingOrderOptionLabel(order) {
  const label = pendingOrderLabel(order);
  return order?.supplier ? `${label} - ${order.supplier}` : label;
}

export function hasPurchaseOrderNumber(order) {
  return String(order?.poNumber ?? "").trim() !== "";
}
