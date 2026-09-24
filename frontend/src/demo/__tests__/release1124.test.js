import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRequest } from "../router.js";
import { handOverDueMaintenance, resetStore, store } from "../store.js";
import { addDaysIso, daysFromNow, termEnd } from "../time.js";

async function login() {
  await demoRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "demo", password: "demo" }) });
}

const json = (body) => JSON.stringify(body);
const license = (id) => store.licenses.find((candidate) => candidate.id === id);

describe("demo parity with 1.1.24", () => {
  beforeEach(async () => { resetStore(); await login(); });
  afterEach(() => { vi.useRealTimers(); });

  describe("seed data", () => {
    it("dates one-year terms by the app convention (end = start + 1 year - 1 day)", () => {
      for (const id of [1, 2, 10, 13, 14, 16]) {
        const seeded = license(id);
        expect(seeded.endDate).toBe(termEnd(seeded.startDate));
      }
      const [current, next] = [105, 106].map((id) => store.sourcingItems.find((item) => item.id === id));
      expect(current.endDate).toBe(termEnd(current.startDate));
      expect(next.startDate).toBe(addDaysIso(current.endDate, 1));
    });

    it("retires an ended one-off Other at sign-in and keeps a renewable service", () => {
      expect(license(19)).toMatchObject({ licenseType: "other", typeDescription: "Training vouchers", isRetired: true });
      expect(license(18)).toMatchObject({ licenseType: "service", isRenewable: true, isRetired: false });
    });
  });

  describe("renewability", () => {
    it("requires a type description for Other and keeps the renewable flag only on Service/Other", async () => {
      const missing = await demoRequest("/api/licenses", {
        method: "POST", body: json({ publisherName: "Acme", softwareDescription: "Workshop", licenseType: "other" }),
      });
      expect(missing.error).toBe("Add a type description for an Other license");

      const created = await demoRequest("/api/licenses", {
        method: "POST",
        body: json({ publisherName: "Acme", softwareDescription: "Seats", licenseType: "subscription", isRenewable: false }),
      });
      expect(created.error).toBeNull();
      expect(created.data.isRenewable).toBeNull();
    });

    it("keeps one-off services out of expiry alerts and the workbench, but counts renewable ones", async () => {
      const oneOff = await demoRequest("/api/licenses", {
        method: "POST",
        body: json({
          publisherName: "Acme", softwareDescription: "Migration service", licenseType: "service",
          startDate: daysFromNow(-300), endDate: daysFromNow(10), quantity: "1", unitPrice: "5000.00",
        }),
      });
      expect(oneOff.error).toBeNull();

      const notifications = await demoRequest("/api/notifications", { method: "GET" });
      expect(notifications.data.some((item) => item.license_id === oneOff.data.id && item.type === "expiring")).toBe(false);
      const rows = await demoRequest("/api/renewals/workbench", { method: "GET" });
      expect(rows.data.some((row) => row.licenseId === oneOff.data.id)).toBe(false);
      expect(rows.data.some((row) => row.licenseId === 18)).toBe(true);

      const stats = await demoRequest("/api/licenses/stats", { method: "GET" });
      const before = stats.data.annual_cost_by_currency.EUR;
      await demoRequest(`/api/licenses/${oneOff.data.id}`, { method: "PUT", body: json({ isRenewable: true }) });
      const after = await demoRequest("/api/licenses/stats", { method: "GET" });
      expect(after.data.annual_cost_by_currency.EUR).toBeCloseTo(before + 5000, 2);
    });
  });

  describe("renewal workbench", () => {
    it("lists an unhandled notice deadline first and flags it", async () => {
      const { data } = await demoRequest("/api/renewals/workbench", { method: "GET" });
      const arcticWolf = data.find((row) => row.licenseId === 18);
      expect(arcticWolf).toMatchObject({ daysUntilNotice: 12, noticeDate: daysFromNow(12), daysUntilExpiry: 75 });
      expect(arcticWolf.riskFlags).toContainEqual({ code: "notice_due", label: "Notice deadline in 12 days", severity: "high" });
      const noticeView = await demoRequest("/api/renewals/workbench?view=notice_due", { method: "GET" });
      expect(noticeView.data.map((row) => row.licenseId)).toEqual([18]);
      // Sorted by the earlier deadline: the notice in 12 days beats end dates 20+ days out.
      expect(data.findIndex((row) => row.licenseId === 18)).toBeLessThan(data.findIndex((row) => row.licenseId === 1));
    });

    it("excludes records scheduled to retire", async () => {
      const { data } = await demoRequest("/api/renewals/workbench", { method: "GET" });
      expect(data.some((row) => row.licenseId === 16)).toBe(false);
    });

    it("flags high value only against the row currency's threshold", async () => {
      const flagged = async () => {
        const { data } = await demoRequest("/api/renewals/workbench?view=high_value", { method: "GET" });
        return data.map((row) => row.licenseId);
      };
      expect(await flagged()).toEqual([]);

      await demoRequest("/api/settings/global", { method: "PUT", body: json({ high_value_thresholds: { eur: "15000", USD: "" } }) });
      expect(store.globalSettings.high_value_thresholds).toEqual({ EUR: "15000" });
      expect(await flagged()).toEqual([18]);

      await demoRequest("/api/settings/global", { method: "PUT", body: json({ high_value_thresholds: { USD: "1" } }) });
      expect(await flagged()).toEqual([]);

      const invalid = await demoRequest("/api/settings/global", { method: "PUT", body: json({ high_value_thresholds: { EURO: "1" } }) });
      expect(invalid.error).toMatch(/Unsupported currency code/);
    });

    it("validates the public app URL", async () => {
      const saved = await demoRequest("/api/settings/global", { method: "PUT", body: json({ public_base_url: " https://licenses.example.com/ " }) });
      expect(saved.data.public_base_url).toBe("https://licenses.example.com");
      const invalid = await demoRequest("/api/settings/global", { method: "PUT", body: json({ public_base_url: "ftp://example.com" }) });
      expect(invalid.error).toMatch(/Public URL must be an http\(s\) address/);
    });
  });

  describe("included support lifecycle", () => {
    it("reports expiring included support as a status, a notification and a workbench row", async () => {
      const sparx = await demoRequest("/api/licenses/17", { method: "GET" });
      expect(sparx.data).toMatchObject({ supportStatus: "expiring", supportDaysRemaining: 25 });

      const notifications = await demoRequest("/api/notifications", { method: "GET" });
      expect(notifications.data).toContainEqual(expect.objectContaining({
        license_id: 17, type: "support_expiring", detail: `Support ends in 25 days on ${daysFromNow(25)}`,
      }));

      const { data } = await demoRequest("/api/renewals/workbench", { method: "GET" });
      expect(data.find((row) => row.licenseId === 17)).toMatchObject({
        rowKind: "support_renewal",
        softwareDescription: "Enterprise Architect Corporate, perpetual, 15 seats (included support)",
        endDate: daysFromNow(25),
        daysUntilExpiry: 25,
        renewalStatus: "due_soon",
        estimatedAnnualValue: 960,
      });
    });

    it("starts a support renewal as a maintenance sourcing line that carries the license", async () => {
      const started = await demoRequest("/api/licenses/17/support-renewal", { method: "POST", body: json({}) });
      expect(started.error).toBeNull();
      expect(started.data.license.maintenanceCoverage).toBe("included");
      expect(started.data.sourcingItem).toMatchObject({
        licenseType: "maintenance",
        maintenanceParentLicenseId: 17,
        startDate: daysFromNow(26),
        endDate: termEnd(daysFromNow(26)),
        estimatedTotalPrice: "960.00",
      });
      expect(started.data.sourcingItem.sourcingRequestId).not.toBeNull();

      const again = await demoRequest("/api/licenses/17/support-renewal", { method: "POST", body: json({}) });
      expect(again.error).toBe("A support renewal is already in progress for this license");

      const { data } = await demoRequest("/api/renewals/workbench", { method: "GET" });
      expect(data.find((row) => row.rowKind === "support_renewal" && row.licenseId === 17).renewalStatus).toBe("in_sourcing");
    });

    it("converting the support renewal links the new record to the license it supports", async () => {
      const { data: started } = await demoRequest("/api/licenses/17/support-renewal", { method: "POST", body: json({}) });
      const order = await demoRequest(`/api/sourcing/requests/${started.sourcingItem.sourcingRequestId}/convert`, {
        method: "POST", body: json({ poNumber: "PO-SUPPORT-1" }),
      });
      expect(order.error).toBeNull();
      expect(order.data.items[0].maintenanceParentLicenseId).toBe(17);

      const converted = await demoRequest(`/api/pending-orders/${order.data.id}/convert-all`, {
        method: "POST",
        body: json([{
          sourcingItemId: started.sourcingItem.id,
          licenseType: "maintenance",
          startDate: started.sourcingItem.startDate,
          endDate: started.sourcingItem.endDate,
        }]),
      });
      expect(converted.error).toBeNull();
      const maintenance = converted.data.find((item) => item.licenseType === "maintenance");
      expect(maintenance.parentLicenseId).toBe(17);
      expect(license(17)).toMatchObject({
        maintenanceCoverage: "separately_tracked",
        activeMaintenanceId: maintenance.id,
        supportStatus: null,
      });
    });

    it("edits the included support period, with Free storing a zero cost", async () => {
      const free = await demoRequest("/api/licenses/17/included-support", {
        method: "PUT",
        body: json({
          maintenanceStartDate: daysFromNow(-10), maintenanceEndDate: daysFromNow(400),
          maintenancePricingBasis: "free", maintenanceCost: "",
        }),
      });
      expect(free.error).toBeNull();
      expect(free.data).toMatchObject({ maintenancePricingBasis: "free", maintenanceCost: "0", supportStatus: "active" });

      const perUnit = await demoRequest("/api/licenses/17/included-support", {
        method: "PUT",
        body: json({ maintenancePricingBasis: "per_unit", maintenanceQuantity: "15", maintenanceUnitPrice: "70.00" }),
      });
      expect(perUnit.data.maintenanceCost).toBe("1050.00");

      const wrongType = await demoRequest("/api/licenses/1/included-support", { method: "PUT", body: json({}) });
      expect(wrongType.error).toBe("Included support can only be edited on perpetual, OEM or freeware licenses");
      const linked = await demoRequest("/api/licenses/11/included-support", { method: "PUT", body: json({}) });
      expect(linked.error).toBe("Set coverage to Included before editing the support period");
    });

    it("clears stale included-support dates when coverage leaves Included", async () => {
      const patched = await demoRequest("/api/licenses/17/field", {
        method: "PATCH", body: json({ field: "maintenanceCoverage", value: "unknown" }),
      });
      expect(patched.error).toBeNull();
      expect(patched.data).toMatchObject({ maintenanceStartDate: null, maintenanceEndDate: null, maintenanceCost: null, supportStatus: null });
    });

    it("activates a planned maintenance chain one term at a time", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 8, 24, 12));

      const order = await demoRequest("/api/pending-orders", {
        method: "POST", body: json({ poNumber: "PO-CHAIN-1", supplier: "Direct Software Desk" }),
      });
      const lines = [["2026-09-01", "2027-08-31"], ["2027-09-01", "2028-08-31"], ["2028-09-01", "2029-08-31"]]
        .map(([startDate, endDate], index) => ({
          publisherName: "Sparx Systems",
          softwareDescription: `Enterprise Architect support, year ${index + 1}`,
          licenseType: "maintenance",
          quantity: "15",
          estimatedUnitPrice: "64.00",
          estimatedTotalPrice: "960.00",
          currency: "EUR",
          startDate,
          endDate,
        }));
      const added = await demoRequest(`/api/pending-orders/${order.data.id}/items/bulk`, { method: "POST", body: json(lines) });
      const [year1, year2, year3] = added.data.createdItemIds;
      for (const [predecessor, successor] of [[year1, year2], [year2, year3]]) {
        const linked = await demoRequest("/api/sourcing/requests/successor-links", {
          method: "PUT", body: json({ successorItemId: successor, predecessorItemIds: [predecessor] }),
        });
        expect(linked.error).toBeNull();
      }

      const payload = [year3, year2, year1].map((id) => {
        const item = store.sourcingItems.find((candidate) => candidate.id === id);
        return {
          sourcingItemId: id,
          licenseType: "maintenance",
          quantity: "15",
          unitPrice: "64.00",
          startDate: item.startDate,
          endDate: item.endDate,
          ...(id === year1 ? { parentLicenseId: 17 } : {}),
        };
      });
      const converted = await demoRequest(`/api/pending-orders/${order.data.id}/convert-all`, { method: "POST", body: json(payload) });
      expect(converted.error).toBeNull();

      const bySource = (itemId) => store.licenses.find((candidate) => candidate.sourceSourcingItemId === itemId);
      const [term1, term2, term3] = [year1, year2, year3].map(bySource);
      for (const term of [term1, term2, term3]) expect(term.maintenanceParentIds).toEqual([17]);
      expect(term2.renewedFromId).toBe(term1.id);
      expect(term3.renewedFromId).toBe(term2.id);
      expect(term2.licenseRef).toBe(term1.licenseRef);
      expect(license(17).activeMaintenanceId).toBe(term1.id);

      vi.setSystemTime(new Date(2027, 8, 2, 12));
      expect(handOverDueMaintenance()).toBe(1);
      expect(license(17)).toMatchObject({ activeMaintenanceId: term2.id, maintenanceEndDate: "2028-08-31" });
      expect(handOverDueMaintenance()).toBe(0);
    });

    it("keeps maintenance chains maintenance-only", async () => {
      const order = await demoRequest("/api/pending-orders", {
        method: "POST", body: json({ poNumber: "PO-CHAIN-2", supplier: "Direct Software Desk" }),
      });
      const added = await demoRequest(`/api/pending-orders/${order.data.id}/items/bulk`, {
        method: "POST",
        body: json([
          { publisherName: "Sparx Systems", softwareDescription: "Support", licenseType: "maintenance", currency: "EUR" },
          { publisherName: "Sparx Systems", softwareDescription: "Seats", licenseType: "subscription", currency: "EUR" },
        ]),
      });
      const [support, seats] = added.data.createdItemIds;
      const linked = await demoRequest("/api/sourcing/requests/successor-links", {
        method: "PUT", body: json({ successorItemId: seats, predecessorItemIds: [support] }),
      });
      expect(linked.error).toBe("Maintenance terms can only follow maintenance terms");
    });
  });

  describe("pending-order PO total", () => {
    it("carries the manual total to every converted license without spreading it across lines", async () => {
      const [po] = (await demoRequest("/api/pending-orders", { method: "GET" })).data;
      expect(po.poTotalOverride).toBe("12000.00");
      expect(po.totalPoValue).toBe("€12,520.00");

      const converted = await demoRequest(`/api/pending-orders/${po.id}/convert-all`, {
        method: "POST",
        body: json(po.items.map((item) => ({
          sourcingItemId: item.id, licenseType: "subscription", quantity: item.quantity,
          unitPrice: item.estimatedUnitPrice, startDate: item.startDate, endDate: item.endDate,
        }))),
      });
      expect(converted.error).toBeNull();
      expect(converted.data).toHaveLength(2);
      for (const created of converted.data) expect(created.poTotalOverride).toBe("12000.00");
      expect(converted.data.map((created) => created.unitPrice).sort()).toEqual(["133.00", "18.00"]);
    });

    it("allows the manual total only on a single-currency order", async () => {
      const [po] = (await demoRequest("/api/pending-orders", { method: "GET" })).data;
      const usdLine = await demoRequest(`/api/pending-orders/${po.id}/items/bulk`, {
        method: "POST", body: json([{ publisherName: "Okta", softwareDescription: "Add-on", currency: "USD" }]),
      });
      expect(usdLine.error).toMatch(/A manual PO total needs every line of the pending order in one currency/);

      await demoRequest(`/api/pending-orders/${po.id}`, { method: "PUT", body: json({ poTotalOverride: "" }) });
      expect(store.pendingOrders[0].poTotalOverride).toBeNull();
      const added = await demoRequest(`/api/pending-orders/${po.id}/items/bulk`, {
        method: "POST", body: json([{ publisherName: "Okta", softwareDescription: "Add-on", currency: "USD" }]),
      });
      expect(added.error).toBeNull();
      const mixed = await demoRequest(`/api/pending-orders/${po.id}`, { method: "PUT", body: json({ poTotalOverride: "100.00" }) });
      expect(mixed.error).toMatch(/one currency/);
      const badAmount = await demoRequest(`/api/pending-orders/${po.id}`, { method: "PUT", body: json({ poTotalOverride: "1,000" }) });
      expect(badAmount.error).toMatch(/plain decimal string/);
    });

    it("updates every open line's supplier contact from the order, and an empty contact clears it", async () => {
      const [po] = (await demoRequest("/api/pending-orders", { method: "GET" })).data;
      const updated = await demoRequest(`/api/pending-orders/${po.id}`, { method: "PUT", body: json({ contactEmail: "" }) });
      expect(updated.error).toBeNull();
      expect(updated.data.items.every((item) => item.contactEmail === null)).toBe(true);
    });

    it("notes a manual total the line-based annual cost does not reflect", async () => {
      const stats = async () => (await demoRequest("/api/licenses/stats", { method: "GET" })).data.po_overrides_not_in_annual;
      expect(await stats()).toBe(0);
      await demoRequest("/api/licenses/2/po-total-override", { method: "POST", body: json({ poTotalOverride: "9999.00" }) });
      expect(await stats()).toBe(1);
      const report = await demoRequest("/api/reports/portfolio-stats", { method: "GET" });
      expect(report.data.po_overrides_not_in_annual).toBe(1);
    });
  });

  describe("license edits", () => {
    it("inline-edits Invoice # as the single invoice and keeps every number on full edit", async () => {
      const patched = await demoRequest("/api/licenses/1/field", { method: "PATCH", body: json({ field: "invoiceNumber", value: "INV-NEW" }) });
      expect(patched.data).toMatchObject({ invoiceNumber: "INV-NEW", invoiceNumbers: ["INV-NEW"] });

      const edited = await demoRequest("/api/licenses/1", { method: "PUT", body: json({ invoiceNumbers: ["INV-A", " ", "INV-B"] }) });
      expect(edited.data).toMatchObject({ invoiceNumber: "INV-A", invoiceNumbers: ["INV-A", "INV-B"] });
    });

    it("validates newly inline-editable fields", async () => {
      const email = await demoRequest("/api/licenses/1/field", { method: "PATCH", body: json({ field: "contactEmail", value: "not-an-email" }) });
      expect(email.error).toBe("Invalid email format for 'contactEmail'.");
      const currency = await demoRequest("/api/licenses/1/field", { method: "PATCH", body: json({ field: "currency", value: " " }) });
      expect(currency.error).toBe("Field 'currency' cannot be empty.");
      const coverage = await demoRequest("/api/licenses/1/field", {
        method: "PATCH", body: json({ field: "maintenanceCoverage", value: "separately_tracked" }),
      });
      expect(coverage.error).toMatch(/only valid for perpetual, oem, or freeware/);
      const portal = await demoRequest("/api/licenses/13/field", { method: "PATCH", body: json({ field: "portalUrl", value: "https://hub.example" }) });
      expect(portal.data.portalUrl).toBe("https://hub.example");
    });

    it("never stores an end date on a non-expiring type", async () => {
      const patched = await demoRequest("/api/licenses/11/field", { method: "PATCH", body: json({ field: "endDate", value: "2030-01-01" }) });
      expect(patched.data.endDate).toBeNull();
      const retyped = await demoRequest("/api/licenses/2/field", { method: "PATCH", body: json({ field: "licenseType", value: "oem" }) });
      expect(retyped.data.endDate).toBeNull();
    });
  });
});
