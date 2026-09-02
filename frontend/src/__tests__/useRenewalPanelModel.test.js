import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRenewalPanelModel } from "../components/licenses/detail/useRenewalPanelModel.js";

const makeSettings = (days = 30) => ({ notificationDays: days });

const makeLicense = (overrides = {}) => ({
  id: 1,
  poNumber: "PO-001",
  budgetOwnerEmail: "owner@example.com",
  endDate: null,
  retired: false,
  lifecycleStatus: "active",
  renewedToId: null,
  expirationStatus: "expiring",
  ...overrides,
});

describe("useRenewalPanelModel — poSiblings", () => {
  it("returns empty siblings when license has no poNumber", () => {
    const license = makeLicense({ poNumber: null, endDate: "2020-01-01" });
    const allLicenses = [license, makeLicense({ id: 2, poNumber: null, endDate: "2020-01-01" })];
    const { result } = renderHook(() =>
      useRenewalPanelModel({ license, allLicenses, globalSettings: makeSettings() })
    );
    expect(result.current.poSiblings).toHaveLength(0);
    expect(result.current.bundleCount).toBe(1);
  });

  it("excludes the license itself from siblings", () => {
    const license = makeLicense({ endDate: "2020-01-01" });
    const allLicenses = [license];
    const { result } = renderHook(() =>
      useRenewalPanelModel({ license, allLicenses, globalSettings: makeSettings() })
    );
    expect(result.current.poSiblings).toHaveLength(0);
  });

  it("includes a sibling on the same PO that is expiring", () => {
    const today = new Date();
    const soonDate = new Date(today);
    soonDate.setDate(today.getDate() + 10);
    const expiring = soonDate.toISOString().slice(0, 10);

    const license = makeLicense({ endDate: expiring });
    const sibling = makeLicense({ id: 2, endDate: expiring });
    const { result } = renderHook(() =>
      useRenewalPanelModel({ license, allLicenses: [license, sibling], globalSettings: makeSettings() })
    );
    expect(result.current.poSiblings).toHaveLength(1);
    expect(result.current.bundleCount).toBe(2);
  });

  it("excludes a sibling that is already renewed", () => {
    const today = new Date();
    const soonDate = new Date(today);
    soonDate.setDate(today.getDate() + 10);
    const expiring = soonDate.toISOString().slice(0, 10);

    const license = makeLicense({ endDate: expiring });
    const alreadyRenewed = makeLicense({ id: 2, endDate: expiring, renewedToId: 99 });
    const { result } = renderHook(() =>
      useRenewalPanelModel({ license, allLicenses: [license, alreadyRenewed], globalSettings: makeSettings() })
    );
    expect(result.current.poSiblings).toHaveLength(0);
  });

  it("excludes a sibling that is pending_renewal", () => {
    const today = new Date();
    const soonDate = new Date(today);
    soonDate.setDate(today.getDate() + 10);
    const expiring = soonDate.toISOString().slice(0, 10);

    const license = makeLicense({ endDate: expiring });
    const pending = makeLicense({ id: 2, endDate: expiring, lifecycleStatus: "pending_renewal" });
    const { result } = renderHook(() =>
      useRenewalPanelModel({ license, allLicenses: [license, pending], globalSettings: makeSettings() })
    );
    expect(result.current.poSiblings).toHaveLength(0);
  });

  it("requires a budget owner on the selected license and every bundle sibling", () => {
    const endDate = "2020-01-01";
    const missingPrimaryOwner = makeLicense({ endDate, budgetOwnerEmail: " " });
    const eligibleSibling = makeLicense({ id: 2, endDate });
    const missingSiblingOwner = makeLicense({ id: 3, endDate, budgetOwnerEmail: null });

    const missingPrimaryResult = renderHook(() =>
      useRenewalPanelModel({
        license: missingPrimaryOwner,
        allLicenses: [missingPrimaryOwner, eligibleSibling],
        globalSettings: makeSettings(),
      })
    );
    expect(missingPrimaryResult.result.current.poSiblings).toHaveLength(0);

    const selected = makeLicense({ endDate });
    const missingSiblingResult = renderHook(() =>
      useRenewalPanelModel({
        license: selected,
        allLicenses: [selected, missingSiblingOwner],
        globalSettings: makeSettings(),
      })
    );
    expect(missingSiblingResult.result.current.poSiblings).toHaveLength(0);
  });

  it("excludes a same-term sibling whose coverage has not started", () => {
    const today = new Date();
    const end = new Date(today);
    end.setDate(today.getDate() + 10);
    const start = new Date(today);
    start.setDate(today.getDate() + 5);
    const endDate = end.toISOString().slice(0, 10);

    const license = makeLicense({ endDate });
    const upcoming = makeLicense({
      id: 2,
      startDate: start.toISOString().slice(0, 10),
      endDate,
      expirationStatus: "upcoming",
    });
    const { result } = renderHook(() =>
      useRenewalPanelModel({ license, allLicenses: [license, upcoming], globalSettings: makeSettings() })
    );

    expect(result.current.poSiblings).toHaveLength(0);
  });

  it("excludes a sibling that is active (not expiring)", () => {
    const today = new Date();
    const farDate = new Date(today);
    farDate.setFullYear(today.getFullYear() + 2);
    const far = farDate.toISOString().slice(0, 10);

    const expiring = new Date(today);
    expiring.setDate(today.getDate() + 10);
    const expiringDate = expiring.toISOString().slice(0, 10);

    const license = makeLicense({ endDate: expiringDate });
    const active = makeLicense({ id: 2, endDate: far, expirationStatus: "active" });
    const { result } = renderHook(() =>
      useRenewalPanelModel({ license, allLicenses: [license, active], globalSettings: makeSettings() })
    );
    expect(result.current.poSiblings).toHaveLength(0);
  });
});
