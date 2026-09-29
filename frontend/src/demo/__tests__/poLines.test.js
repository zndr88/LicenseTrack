import { beforeEach, describe, expect, it } from "vitest";
import { demoRequest } from "../router.js";
import { store, resetStore } from "../store.js";
import { normalizeProcurementPoNumber as poKeyOf } from "../../utils/procurementIdentity.js";

async function login() {
  await demoRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "demo", password: "demo" }) });
}

const post = (path, body) => demoRequest(path, { method: "POST", body: JSON.stringify(body) });
const put = (path, body) => demoRequest(path, { method: "PUT", body: JSON.stringify(body) });

function licenseOn(poNumber, description = "Line") {
  return post("/api/licenses", {
    publisherName: "Acme", softwareDescription: description, licenseType: "subscription",
    licenseMetric: "per_user", quantity: "1", currency: "EUR", poNumber,
  });
}

function line(description = "Line") {
  return {
    publisherName: "Acme", softwareDescription: description, quantity: "1", currency: "EUR",
    licenseType: "subscription", licenseMetric: "per_user", estimatedUnitPrice: "10.00", estimatedTotalPrice: "10.00",
  };
}

async function orderWithLines(poNumber, count) {
  const created = await post("/api/pending-orders", { poNumber, supplier: "Supplier Ltd" });
  await post(`/api/pending-orders/${created.data.id}/items/bulk`, Array.from({ length: count }, (_, i) => line(`Item ${i + 1}`)));
  return created.data.id;
}

const lineNumbers = async (orderId) => {
  const { data } = await demoRequest(`/api/pending-orders/${orderId}`);
  return data.items.map((item) => item.poLineNumber);
};

describe("demo PO line numbers", () => {
  beforeEach(async () => { resetStore(); await login(); });

  it("seeds a PO with a gap and numbers every seeded license that has a PO", async () => {
    const { data } = await demoRequest("/api/pending-orders");
    const seeded = data.find((order) => order.poNumber === "PO-2026-0142");
    expect(seeded.items.map((item) => item.poLineNumber)).toEqual([1, 4]);
    for (const license of store.licenses.filter((l) => l.poNumber)) {
      expect(license.poLineNumber, `${license.licenseRef} has a PO line`).toBeGreaterThan(0);
    }
  });

  it("issues the next free number per PO, ignoring case and spacing, and never reuses one", async () => {
    const first = await licenseOn("PO-NEW-1");
    const second = await licenseOn("  po-new-1 ");
    expect([first.data.poLineNumber, second.data.poLineNumber]).toEqual([1, 2]);

    await put(`/api/licenses/${second.data.id}`, { poNumber: "" });
    const third = await licenseOn("PO-NEW-1");
    expect(third.data.poLineNumber).toBe(3);
    expect(store.licenses.find((l) => l.id === second.data.id).poLineNumber).toBeNull();
  });

  it("keeps a license's number when it is free on the new PO, else takes the next free one", async () => {
    await licenseOn("PO-TARGET");
    const other = await licenseOn("PO-OTHER");
    const moved = await put(`/api/licenses/${other.data.id}`, { poNumber: "PO-TARGET" });
    expect(moved.data.poLineNumber).toBe(2);

    const alone = await licenseOn("PO-ALONE-A");
    const kept = await put(`/api/licenses/${alone.data.id}`, { poNumber: "PO-ALONE-B" });
    expect(kept.data.poLineNumber).toBe(1);
  });

  it("rejects any attempt to set a line number", async () => {
    const created = await licenseOn("PO-RO");
    const rejected = await put(`/api/licenses/${created.data.id}`, { poLineNumber: 9 });
    expect(rejected.error).toMatch(/generated/i);
    const rejectedCreate = await post("/api/licenses", { publisherName: "A", softwareDescription: "B", poLineNumber: 3 });
    expect(rejectedCreate.error).toMatch(/generated/i);
  });

  it("numbers order lines in order and keeps gaps when lines are removed", async () => {
    const orderId = await orderWithLines("PO-ORDER-1", 3);
    expect(await lineNumbers(orderId)).toEqual([1, 2, 3]);
    const { data } = await demoRequest(`/api/pending-orders/${orderId}`);
    await demoRequest(`/api/pending-orders/${orderId}/items/${data.items[1].id}`, { method: "DELETE" });
    expect(await lineNumbers(orderId)).toEqual([1, 3]);
    await post(`/api/pending-orders/${orderId}/items/bulk`, [line("Late")]);
    expect(await lineNumbers(orderId)).toEqual([1, 3, 4]);
  });

  it("moves a whole order to a new PO, keeping numbers only when none collide", async () => {
    const free = await orderWithLines("PO-MOVE-A", 2);
    await put(`/api/pending-orders/${free}`, { poNumber: "PO-MOVE-B" });
    expect(await lineNumbers(free)).toEqual([1, 2]);

    await licenseOn("PO-MOVE-C");
    await licenseOn("PO-MOVE-C");
    const colliding = await orderWithLines("PO-MOVE-D", 3);
    await put(`/api/pending-orders/${colliding}`, { poNumber: "po-move-c" });
    expect(await lineNumbers(colliding)).toEqual([3, 4, 5]);
  });

  it("a converted license shares its line's number, and renewal starts blank", async () => {
    const orderId = await orderWithLines("PO-CONVERT", 2);
    const before = await lineNumbers(orderId);
    const converted = await demoRequest(`/api/pending-orders/${orderId}/convert`, {
      method: "POST",
      body: (() => { const fd = new FormData(); fd.append("data", JSON.stringify({ poNumber: "PO-CONVERT", startDate: "2026-01-01", endDate: "2026-12-31" })); return fd; })(),
    });
    expect(converted.error).toBeNull();
    const numbers = converted.data.filter((l) => l.poNumber === "PO-CONVERT").map((l) => l.poLineNumber).sort();
    expect(numbers).toEqual(before);

    const target = store.licenses.find((l) => l.daysUntilExpiry === 20);
    const init = await post(`/api/licenses/${target.id}/initiate-renewal`, {});
    expect(init.data.sourcingItem.poLineNumber ?? null).toBeNull();
  });

  it("keeps every PO line unique per PO across all records", async () => {
    await orderWithLines("PO-UNIQUE", 2);
    await licenseOn("po-unique");
    const seen = new Set();
    for (const license of store.licenses.filter((l) => l.poNumber && !store.sourcingItems.some((s) => s.id === l.sourceSourcingItemId))) {
      const key = `${poKeyOf(license.poNumber)}#${license.poLineNumber}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    for (const item of store.sourcingItems.filter((s) => s.poLineNumber)) {
      const order = store.pendingOrders.find((o) => o.id === item.pendingOrderId);
      const key = `${poKeyOf(order.poNumber)}#${item.poLineNumber}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });
});
