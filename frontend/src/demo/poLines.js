// PO line numbers for the in-browser demo.
//
// Mirrors backend/app/services/po_line_service.py: every record with a PO
// number holds a generated line number, unique per normalized PO number and
// never reused. Both sync functions are idempotent; every demo writer that
// creates a record with a PO number, or changes a PO number, calls one.
import { store } from "./store.js";
import { normalizeProcurementPoNumber as poKeyOf } from "../utils/procurementIdentity.js";

function register() {
  if (!store.poLineRegister) store.poLineRegister = [];
  return store.poLineRegister;
}

function rowFor(record) {
  return record.poLineId == null ? null : register().find((row) => row.id === record.poLineId) ?? null;
}

function assign(record, row) {
  record.poLineId = row ? row.id : null;
  record.poLineNumber = row ? row.lineNumber : null;
}

// A record that arrives with a number but no register row (seed data only)
// asks for that number, like an imported line number that is still free.
function requestedNumber(record) {
  return record.poLineId == null && Number(record.poLineNumber) > 0 ? Number(record.poLineNumber) : null;
}

function isFree(poKey, number) {
  return !register().some((row) => row.poKey === poKey && row.lineNumber === number);
}

function nextFree(poKey) {
  return register().reduce((highest, row) => (row.poKey === poKey ? Math.max(highest, row.lineNumber) : highest), 0) + 1;
}

/** Issues a line on `poNumber`: `requested` if it is free, otherwise the highest ever issued + 1. */
export function allocateLine(poNumber, requested = null) {
  const poKey = poKeyOf(poNumber);
  const number = requested > 0 && isFree(poKey, requested) ? requested : nextFree(poKey);
  const row = { id: register().length + 1, poKey, poNumber: String(poNumber).trim(), lineNumber: number };
  register().push(row);
  return row;
}

/** Makes one license hold a line on its own PO (single-record rules). */
export function syncLicensePoLine(license) {
  const poKey = poKeyOf(license.poNumber);
  if (!poKey) {
    assign(license, null);
    return;
  }
  const current = rowFor(license);
  if (current && current.poKey === poKey) return;
  const source = license.sourceSourcingItemId == null
    ? null
    : store.sourcingItems.find((item) => item.id === license.sourceSourcingItemId);
  const sourceRow = source ? rowFor(source) : null;
  if (sourceRow && sourceRow.poKey === poKey) {
    assign(license, sourceRow);
    return;
  }
  assign(license, allocateLine(license.poNumber, current ? current.lineNumber : requestedNumber(license)));
}

/** Makes every live line of an order hold a number on the order's PO (whole-order rules). */
export function syncOrderPoLines(order) {
  const poKey = poKeyOf(order.poNumber);
  const items = store.sourcingItems
    .filter((item) => item.pendingOrderId === order.id && item.status !== "cancelled")
    .sort((a, b) => {
      const rank = (item) => rowFor(item)?.lineNumber ?? requestedNumber(item) ?? Infinity;
      return rank(a) - rank(b) || a.id - b.id;
    });
  if (!poKey) {
    for (const item of items) assign(item, null);
  } else {
    const moving = items.filter((item) => rowFor(item) && rowFor(item).poKey !== poKey);
    const allFree = moving.every((item) => isFree(poKey, rowFor(item).lineNumber));
    for (const item of moving) assign(item, allocateLine(order.poNumber, allFree ? rowFor(item).lineNumber : null));
    for (const item of items) {
      if (rowFor(item)) continue;
      assign(item, allocateLine(order.poNumber, requestedNumber(item)));
    }
  }
  // Order responses carry their own copies of the lines.
  for (const summary of order.items ?? []) {
    const item = store.sourcingItems.find((candidate) => candidate.id === summary.id);
    if (item) summary.poLineNumber = item.poLineNumber ?? null;
  }
}

/** Numbers everything once, after seeding: order lines first so converted licenses share them. */
export function syncAllPoLines() {
  for (const order of store.pendingOrders) syncOrderPoLines(order);
  for (const license of store.licenses) syncLicensePoLine(license);
}
