import { beforeEach, describe, expect, it } from "vitest";
import { demoRequest } from "../router.js";
import { store, resetStore } from "../store.js";

async function login() {
  await demoRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "demo", password: "demo" }) });
}

describe("renewal golden path transitions", () => {
  beforeEach(async () => { resetStore(); await login(); });

  it("initiate-renewal flips lifecycle and creates a linked sourcing item", async () => {
    const target = store.licenses.find((l) => l.daysUntilExpiry === 20);
    const { data, error } = await demoRequest(`/api/licenses/${target.id}/initiate-renewal`, { method: "POST", body: JSON.stringify({}) });
    expect(error).toBeNull();
    expect(data.license.lifecycleStatus).toBe("pending_renewal");
    expect(data.sourcingItem.renewalForLicenseId).toBe(target.id);
    expect(data.sourcingItem.isRenewal).toBe(true);
    expect(store.sourcingItems.some((s) => s.id === data.sourcingItem.id)).toBe(true);
  });

  it("cancel-renewal restores lifecycle and removes the un-converted sourcing item", async () => {
    // License 14 (VMware) is seeded pending_renewal, linked to sourcing item 101.
    const license = store.licenses.find((l) => l.id === 14);
    expect(license.lifecycleStatus).toBe("pending_renewal");
    expect(store.sourcingItems.some((s) => s.id === 101)).toBe(true);

    const { data, error } = await demoRequest(`/api/licenses/14/cancel-renewal`, { method: "POST", body: JSON.stringify({}) });
    expect(error).toBeNull();
    expect(data.license.lifecycleStatus).toBeNull();
    expect(data.poWarning).toBe(false);
    expect(store.sourcingItems.some((s) => s.id === 101)).toBe(false);
  });

  it("cancel-renewal sets poWarning when the linked sourcing item was already converted", async () => {
    const target = store.licenses.find((l) => l.daysUntilExpiry === 20);
    const { data: initiateData } = await demoRequest(`/api/licenses/${target.id}/initiate-renewal`, { method: "POST", body: JSON.stringify({}) });
    const item = store.sourcingItems.find((s) => s.id === initiateData.sourcingItem.id);
    item.status = "converted";

    const { data, error } = await demoRequest(`/api/licenses/${target.id}/cancel-renewal`, { method: "POST", body: JSON.stringify({}) });
    expect(error).toBeNull();
    expect(data.license.lifecycleStatus).toBeNull();
    expect(data.poWarning).toBe(true);
    // Converted item is not deleted.
    expect(store.sourcingItems.some((s) => s.id === item.id)).toBe(true);
  });

  it("stats reflect store mutations after a delete", async () => {
    const before = await demoRequest("/api/licenses/stats", { method: "GET" });
    expect(before.error).toBeNull();
    const totalBefore = before.data.total;

    const { error: delError } = await demoRequest("/api/licenses/12", { method: "DELETE" });
    expect(delError).toBeNull();

    const after = await demoRequest("/api/licenses/stats", { method: "GET" });
    expect(after.data.total).toBe(totalBefore - 1);
  });

  it("license update recomputes expirationStatus when endDate changes", async () => {
    const target = store.licenses.find((l) => l.id === 2); // healthy active license
    expect(target.expirationStatus).toBe("active");

    const { data, error } = await demoRequest(`/api/licenses/2`, {
      method: "PUT",
      body: JSON.stringify({ endDate: null }),
    });
    expect(error).toBeNull();
    expect(data.expirationStatus).toBe("perpetual");
    expect(data.daysUntilExpiry).toBeNull();
  });

  it("field patch on endDate recomputes expirationStatus", async () => {
    const target = store.licenses.find((l) => l.id === 2);
    const { data, error } = await demoRequest(`/api/licenses/${target.id}/field`, {
      method: "PATCH",
      body: JSON.stringify({ field: "endDate", value: "" }),
    });
    expect(error).toBeNull();
    expect(data.expirationStatus).toBe("perpetual");
  });

  it("bulk delete removes multiple licenses", async () => {
    const { data, error } = await demoRequest("/api/licenses/bulk", {
      method: "DELETE",
      body: JSON.stringify({ ids: [2, 3] }),
    });
    expect(error).toBeNull();
    expect(data.deleted).toBe(2);
    expect(store.licenses.some((l) => l.id === 2)).toBe(false);
    expect(store.licenses.some((l) => l.id === 3)).toBe(false);
  });

  it("departments returns distinct sorted cost centres", async () => {
    const { data, error } = await demoRequest("/api/licenses/departments", { method: "GET" });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const sorted = [...data].sort();
    expect(data).toEqual(sorted);
    expect(new Set(data).size).toBe(data.length);
  });

  it("converting a sourcing item creates/joins a pending order", async () => {
    const target = store.licenses.find((l) => l.daysUntilExpiry === 20);
    const init = await demoRequest(`/api/licenses/${target.id}/initiate-renewal`, { method: "POST", body: JSON.stringify({}) });
    const itemId = init.data.sourcingItem.id;
    const { data, error } = await demoRequest(`/api/sourcing/${itemId}/convert`, {
      method: "POST", body: JSON.stringify({ poNumber: "PO-2026-0999", supplier: "Northstar Procurement" }),
    });
    expect(error).toBeNull();
    expect(data.poNumber).toBe("PO-2026-0999");
    const po = store.pendingOrders.find((p) => p.poNumber === "PO-2026-0999");
    expect(po).toBeTruthy();
    expect(po.items.some((i) => i.id === itemId)).toBe(true);
    expect(store.sourcingItems.find((s) => s.id === itemId).status).toBe("converted");
  });

  it("converts freeware sourcing directly without purchase metadata", async () => {
    const created = await demoRequest("/api/sourcing/requests", {
      method: "POST",
      body: JSON.stringify({
        supplier: "Direct",
        items: [{
          publisherName: "The Document Foundation",
          softwareDescription: "LibreOffice Calc",
          licenseType: "freeware",
          quantity: "1",
          startDate: "2026-07-23",
          currency: "EUR",
        }],
      }),
    });
    const request = created.data;

    const { data, error } = await demoRequest(
      `/api/sourcing/requests/${request.id}/convert-freeware`,
      { method: "POST" }
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      licenseType: "freeware",
      sourceSourcingItemId: request.items[0].id,
      purchaseDate: null,
      pendingOrderId: null,
      poNumber: "",
      invoiceNumber: "",
      contractNumber: "",
      unitPrice: "",
      totalPoPrice: "",
      conversionType: "direct_freeware",
    });
    expect(store.pendingOrders).toHaveLength(1);
    expect(store.sourcingRequests.find((candidate) => candidate.id === request.id).status).toBe("converted");
  });

  it("converting a sourcing item to an existing pending order attaches it", async () => {
    // Sourcing item 102 (Datadog) is a standalone, unconverted item; PO 201 is seeded pending.
    const { data, error } = await demoRequest("/api/sourcing/102/convert", {
      method: "POST", body: JSON.stringify({ pendingOrderId: 201 }),
    });
    expect(error).toBeNull();
    expect(data.id).toBe(201);
    expect(data.items.some((i) => i.id === 102)).toBe(true);
    expect(store.sourcingItems.find((s) => s.id === 102).pendingOrderId).toBe(201);
    expect(store.sourcingItems.find((s) => s.id === 102).status).toBe("converted");
  });

  it("sourcing item update (PUT) persists changes and bumps updatedAt", async () => {
    const before = store.sourcingItems.find((s) => s.id === 102);
    const prevUpdatedAt = before.updatedAt;
    const { data, error } = await demoRequest("/api/sourcing/102", {
      method: "PUT", body: JSON.stringify({ notes: "Budget approved." }),
    });
    expect(error).toBeNull();
    expect(data.notes).toBe("Budget approved.");
    expect(store.sourcingItems.find((s) => s.id === 102).notes).toBe("Budget approved.");
    expect(data.updatedAt).not.toBe(prevUpdatedAt);
  });

  it("delete removes a sourcing item", async () => {
    expect(store.sourcingItems.some((s) => s.id === 102)).toBe(true);
    const { error } = await demoRequest("/api/sourcing/102", { method: "DELETE" });
    expect(error).toBeNull();
    expect(store.sourcingItems.some((s) => s.id === 102)).toBe(false);
  });

  it("converting an already-converted sourcing item errors", async () => {
    // Sourcing item 103 is seeded already converted (linked to PO 201).
    const { data, error } = await demoRequest("/api/sourcing/103/convert", {
      method: "POST", body: JSON.stringify({ poNumber: "PO-2026-0777" }),
    });
    expect(data).toBeNull();
    expect(error).toMatch(/converted/i);
  });

  it("converting the pending order yields an active license and marks the old one renewed", async () => {
    const target = store.licenses.find((l) => l.daysUntilExpiry === 20);
    const init = await demoRequest(`/api/licenses/${target.id}/initiate-renewal`, { method: "POST", body: JSON.stringify({}) });
    const itemId = init.data.sourcingItem.id;
    await demoRequest(`/api/sourcing/${itemId}/convert`, { method: "POST", body: JSON.stringify({ poNumber: "PO-2026-0999" }) });
    const po = store.pendingOrders.find((p) => p.poNumber === "PO-2026-0999");

    const fd = new FormData();
    fd.append("data", JSON.stringify({
      publisherName: target.publisherName,
      softwareDescription: target.softwareDescription,
      startDate: null, endDate: null, quantity: "250", unitPrice: "40.00",
    }));
    const { data, error } = await demoRequest(`/api/pending-orders/${po.id}/convert`, { method: "POST", body: fd });
    expect(error).toBeNull();
    const newLic = data.find((l) => l.conversionType === "renewed");
    const oldLic = data.find((l) => l.conversionType === "renewed_predecessor");
    expect(newLic.renewedFromId).toBe(target.id);
    expect(oldLic.renewedToId).toBe(newLic.id);
    expect(store.licenses.find((l) => l.id === target.id).lifecycleStatus).toBe("renewed");
  });

  it("renewal successor carries the predecessor's licenseRef", async () => {
    const target = store.licenses.find((l) => l.daysUntilExpiry === 20);
    expect(target.licenseRef).toBe("LT-2026-0001");
    const init = await demoRequest(`/api/licenses/${target.id}/initiate-renewal`, { method: "POST", body: JSON.stringify({}) });
    await demoRequest(`/api/sourcing/${init.data.sourcingItem.id}/convert`, { method: "POST", body: JSON.stringify({ poNumber: "PO-2026-0998" }) });
    const po = store.pendingOrders.find((p) => p.poNumber === "PO-2026-0998");

    const fd = new FormData();
    fd.append("data", JSON.stringify({ publisherName: target.publisherName, softwareDescription: target.softwareDescription }));
    const { data, error } = await demoRequest(`/api/pending-orders/${po.id}/convert`, { method: "POST", body: fd });
    expect(error).toBeNull();
    const newLic = data.find((l) => l.conversionType === "renewed");
    expect(newLic.licenseRef).toBe(target.licenseRef);
    expect(newLic.predecessorId).toBe(target.id);
  });

  it("convert-all with 2 items produces 2 new licenses and flips the PO to converted", async () => {
    // PO 201 is seeded pending with two non-renewal Okta line items (103, 104).
    const payload = [
      { sourcingItemId: 103, publisherName: "Okta", softwareDescription: "Workforce Identity, 400 users", quantity: "400", unitPrice: "18.00" },
      { sourcingItemId: 104, publisherName: "Okta", softwareDescription: "Advanced Server Access, 40 servers", quantity: "40", unitPrice: "133.00" },
    ];
    const { data, error } = await demoRequest("/api/pending-orders/201/convert-all", { method: "POST", body: JSON.stringify(payload) });
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data.every((l) => l.conversionType === "new_purchase")).toBe(true);
    expect(data.every((l) => l.pendingOrderId === 201)).toBe(true);
    expect(store.pendingOrders.find((p) => p.id === 201).status).toBe("converted");
    // Converted orders disappear from the list endpoint (backend filters them out).
    const list = await demoRequest("/api/pending-orders", { method: "GET" });
    expect(list.data.some((o) => o.id === 201)).toBe(false);
  });

  it("new-purchase conversion yields conversionType new_purchase and no renewal chain", async () => {
    // Sourcing item 102 (Datadog) is a standalone, non-renewal item.
    await demoRequest("/api/sourcing/102/convert", { method: "POST", body: JSON.stringify({ poNumber: "PO-2026-0555" }) });
    const po = store.pendingOrders.find((p) => p.poNumber === "PO-2026-0555");

    const fd = new FormData();
    fd.append("data", JSON.stringify({ publisherName: "Datadog", softwareDescription: "Infrastructure Monitoring, 75 hosts" }));
    const { data, error } = await demoRequest(`/api/pending-orders/${po.id}/convert`, { method: "POST", body: fd });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].conversionType).toBe("new_purchase");
    expect(data[0].renewedFromId).toBeNull();
    expect(data[0].predecessorId).toBeNull();
    expect(data[0].licenseRef).toMatch(/^LT-2026-\d{4}$/);
    expect(store.pendingOrders.find((p) => p.id === po.id).status).toBe("converted");
  });

  it("PO item delete recomputes totalPoValue", async () => {
    expect(store.pendingOrders.find((p) => p.id === 201).totalPoValue).toBe("€12,520.00");
    const { data, error } = await demoRequest("/api/pending-orders/201/items/104", { method: "DELETE" });
    expect(error).toBeNull();
    expect(data.items).toHaveLength(1);
    expect(data.totalPoValue).toBe("€7,200.00");
    expect(store.sourcingItems.some((s) => s.id === 104)).toBe(false);
  });

  it("PO item update recomputes totalPoValue", async () => {
    const { data, error } = await demoRequest("/api/pending-orders/201/items/104", {
      method: "PUT", body: JSON.stringify({ estimatedTotalPrice: "6000.00" }),
    });
    expect(error).toBeNull();
    expect(data.totalPoValue).toBe("€13,200.00");
    expect(store.sourcingItems.find((s) => s.id === 104).estimatedTotalPrice).toBe("6000.00");
  });

  it("items/bulk adds converted line items and recomputes totalPoValue", async () => {
    const { data, error } = await demoRequest("/api/pending-orders/201/items/bulk", {
      method: "POST",
      body: JSON.stringify([{
        publisherName: "Okta", softwareDescription: "MFA add-on, 400 users",
        quantity: "400", estimatedUnitPrice: "3.00", estimatedTotalPrice: "1200.00", currency: "EUR",
      }]),
    });
    expect(error).toBeNull();
    expect(data.items).toHaveLength(3);
    expect(data.totalPoValue).toBe("€13,720.00");
    expect(data.items.find((i) => i.softwareDescription === "MFA add-on, 400 users").status).toBe("converted");
  });

  it("PUT updates pending order header fields", async () => {
    const { data, error } = await demoRequest("/api/pending-orders/201", {
      method: "PUT", body: JSON.stringify({ supplier: "Bluepeak Resellers", notes: "Reassigned." }),
    });
    expect(error).toBeNull();
    expect(data.supplier).toBe("Bluepeak Resellers");
    expect(store.pendingOrders.find((p) => p.id === 201).notes).toBe("Reassigned.");
  });

  it("deleting a pending order resets its items to sourcing without clearing pendingOrderId", async () => {
    const { error } = await demoRequest("/api/pending-orders/201", { method: "DELETE" });
    expect(error).toBeNull();
    expect(store.pendingOrders.some((p) => p.id === 201)).toBe(false);
    const item = store.sourcingItems.find((s) => s.id === 103);
    expect(item.status).toBe("sourcing");
    // Backend quirk mirrored deliberately: delete_pending_order_record resets item
    // status but never clears pending_order_id (pending_order_service.py:125-129).
    expect(item.pendingOrderId).toBe(201);
  });

  it("converting an already-converted pending order errors", async () => {
    const payload = [
      { sourcingItemId: 103, publisherName: "Okta", softwareDescription: "Workforce Identity, 400 users" },
      { sourcingItemId: 104, publisherName: "Okta", softwareDescription: "Advanced Server Access, 40 servers" },
    ];
    const first = await demoRequest("/api/pending-orders/201/convert-all", { method: "POST", body: JSON.stringify(payload) });
    expect(first.error).toBeNull();
    const { data, error } = await demoRequest("/api/pending-orders/201/convert-all", { method: "POST", body: JSON.stringify(payload) });
    expect(data).toBeNull();
    expect(error).toMatch(/already been converted/i);
  });
});
