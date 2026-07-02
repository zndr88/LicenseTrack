import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCotermDetection } from "../../hooks/useCotermDetection.js";

const makeItem = (overrides = {}) => ({
  id: 1,
  isRenewal: false,
  renewalForLicenseId: null,
  publisherName: "Adobe",
  ...overrides,
});

const makeLicense = (overrides = {}) => ({
  id: 1,
  endDate: "2025-12-31",
  ...overrides,
});

describe("useCotermDetection", () => {
  it("returns empty array when sourcingItems is empty", () => {
    const { result } = renderHook(() => useCotermDetection([], []));
    expect(result.current).toEqual([]);
  });

  it("returns empty array when licenses is empty", () => {
    const items = [makeItem({ id: 1, isRenewal: true, renewalForLicenseId: 100 })];
    const { result } = renderHook(() => useCotermDetection(items, []));
    expect(result.current).toEqual([]);
  });

  it("returns empty array when inputs are null or undefined", () => {
    const { result: r1 } = renderHook(() => useCotermDetection(null, null));
    expect(r1.current).toEqual([]);
    const { result: r2 } = renderHook(() => useCotermDetection(undefined, []));
    expect(r2.current).toEqual([]);
  });

  it("ignores non-renewal sourcing items", () => {
    const items = [
      makeItem({ id: 1, isRenewal: false }),
      makeItem({ id: 2, isRenewal: false }),
    ];
    const { result } = renderHook(() => useCotermDetection(items, [makeLicense({ id: 1 })]));
    expect(result.current).toEqual([]);
  });

  it("returns empty when only one renewal item exists for a publisher+date", () => {
    const items = [makeItem({ id: 1, isRenewal: true, renewalForLicenseId: 100 })];
    const licenses = [makeLicense({ id: 100 })];
    const { result } = renderHook(() => useCotermDetection(items, licenses));
    expect(result.current).toEqual([]);
  });

  it("returns empty when renewal item has no matching predecessor license", () => {
    const items = [
      makeItem({ id: 1, isRenewal: true, renewalForLicenseId: 999 }),
      makeItem({ id: 2, isRenewal: true, renewalForLicenseId: 888 }),
    ];
    const licenses = [makeLicense({ id: 100 })];
    const { result } = renderHook(() => useCotermDetection(items, licenses));
    expect(result.current).toEqual([]);
  });

  it("detects a coterm group when 2 renewals share publisher and end date", () => {
    const items = [
      makeItem({ id: 1, isRenewal: true, renewalForLicenseId: 100, publisherName: "Adobe" }),
      makeItem({ id: 2, isRenewal: true, renewalForLicenseId: 101, publisherName: "Adobe" }),
    ];
    const licenses = [
      makeLicense({ id: 100, endDate: "2025-12-31" }),
      makeLicense({ id: 101, endDate: "2025-12-31" }),
    ];
    const { result } = renderHook(() => useCotermDetection(items, licenses));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].publisher).toBe("Adobe");
    expect(result.current[0].endDate).toBe("2025-12-31");
    expect(result.current[0].ids).toEqual([1, 2]);
  });

  it("is case-insensitive when matching publisher names", () => {
    const items = [
      makeItem({ id: 1, isRenewal: true, renewalForLicenseId: 100, publisherName: "adobe" }),
      makeItem({ id: 2, isRenewal: true, renewalForLicenseId: 101, publisherName: "ADOBE" }),
    ];
    const licenses = [
      makeLicense({ id: 100, endDate: "2025-12-31" }),
      makeLicense({ id: 101, endDate: "2025-12-31" }),
    ];
    const { result } = renderHook(() => useCotermDetection(items, licenses));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].ids).toHaveLength(2);
    expect(result.current[0].publisher).toBe("adobe");
  });

  it("does not group renewals with the same publisher but different end dates", () => {
    const items = [
      makeItem({ id: 1, isRenewal: true, renewalForLicenseId: 100, publisherName: "Adobe" }),
      makeItem({ id: 2, isRenewal: true, renewalForLicenseId: 101, publisherName: "Adobe" }),
    ];
    const licenses = [
      makeLicense({ id: 100, endDate: "2025-12-31" }),
      makeLicense({ id: 101, endDate: "2026-06-30" }),
    ];
    const { result } = renderHook(() => useCotermDetection(items, licenses));
    expect(result.current).toEqual([]);
  });

  it("returns separate groups for different publishers", () => {
    const items = [
      makeItem({ id: 1, isRenewal: true, renewalForLicenseId: 100, publisherName: "Adobe" }),
      makeItem({ id: 2, isRenewal: true, renewalForLicenseId: 101, publisherName: "Adobe" }),
      makeItem({ id: 3, isRenewal: true, renewalForLicenseId: 200, publisherName: "Microsoft" }),
      makeItem({ id: 4, isRenewal: true, renewalForLicenseId: 201, publisherName: "Microsoft" }),
    ];
    const licenses = [
      makeLicense({ id: 100, endDate: "2025-12-31" }),
      makeLicense({ id: 101, endDate: "2025-12-31" }),
      makeLicense({ id: 200, endDate: "2025-12-31" }),
      makeLicense({ id: 201, endDate: "2025-12-31" }),
    ];
    const { result } = renderHook(() => useCotermDetection(items, licenses));
    expect(result.current).toHaveLength(2);
    const publishers = result.current.map((g) => g.publisher).sort();
    expect(publishers).toEqual(["Adobe", "Microsoft"]);
  });

  it("handles perpetual predecessor licenses (null endDate) as a valid group key", () => {
    const items = [
      makeItem({ id: 1, isRenewal: true, renewalForLicenseId: 100, publisherName: "Adobe" }),
      makeItem({ id: 2, isRenewal: true, renewalForLicenseId: 101, publisherName: "Adobe" }),
    ];
    const licenses = [
      makeLicense({ id: 100, endDate: null }),
      makeLicense({ id: 101, endDate: null }),
    ];
    const { result } = renderHook(() => useCotermDetection(items, licenses));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].endDate).toBeNull();
  });
});
