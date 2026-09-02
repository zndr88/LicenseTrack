import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { useLicenseTableState } from "../components/pages/licenses/useLicenseTableState.js";
import { DEFAULT_STATUS_FILTERS } from "../constants/licenseData.js";

describe("useLicenseTableState", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  test("initializes with default status filters", () => {
    const { result } = renderHook(() => useLicenseTableState());
    expect(result.current.statusFilters).toEqual(DEFAULT_STATUS_FILTERS);
  });

  test("initializes with empty search and page 1", () => {
    const { result } = renderHook(() => useLicenseTableState());
    expect(result.current.search).toBe("");
    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageSize).toBe(20);
  });

  test("initializes sortCol as null", () => {
    const { result } = renderHook(() => useLicenseTableState());
    expect(result.current.sortCol).toBeNull();
    expect(result.current.sortDir).toBe("asc");
  });

  test("handleSortCol sets column to asc on first call", () => {
    const { result } = renderHook(() => useLicenseTableState());
    act(() => result.current.handleSortCol("publisher"));
    expect(result.current.sortCol).toBe("publisher");
    expect(result.current.sortDir).toBe("asc");
  });

  test("handleSortCol switches to desc on second call for same column", () => {
    const { result } = renderHook(() => useLicenseTableState());
    act(() => result.current.handleSortCol("publisher"));
    act(() => result.current.handleSortCol("publisher"));
    expect(result.current.sortCol).toBe("publisher");
    expect(result.current.sortDir).toBe("desc");
  });

  test("handleSortCol resets to null on third call for same column", () => {
    const { result } = renderHook(() => useLicenseTableState());
    act(() => result.current.handleSortCol("publisher"));
    act(() => result.current.handleSortCol("publisher"));
    act(() => result.current.handleSortCol("publisher"));
    expect(result.current.sortCol).toBeNull();
    expect(result.current.sortDir).toBe("asc");
  });

  test("handleSortCol switching to a different column resets to asc", () => {
    const { result } = renderHook(() => useLicenseTableState());
    act(() => result.current.handleSortCol("publisher"));
    act(() => result.current.handleSortCol("publisher")); // now desc
    act(() => result.current.handleSortCol("description")); // new column → asc
    expect(result.current.sortCol).toBe("description");
    expect(result.current.sortDir).toBe("asc");
  });

  test("hasColumnFilters is false initially", () => {
    const { result } = renderHook(() => useLicenseTableState());
    expect(result.current.hasColumnFilters).toBe(false);
  });

  test("hasColumnFilters is true when text filter is non-empty", () => {
    const { result } = renderHook(() => useLicenseTableState());
    act(() => result.current.setColumnFilters({ publisher: "Acme" }));
    expect(result.current.hasColumnFilters).toBe(true);
  });

  test("hasColumnFilters is false when text filter is empty string", () => {
    const { result } = renderHook(() => useLicenseTableState());
    act(() => result.current.setColumnFilters({ publisher: "" }));
    expect(result.current.hasColumnFilters).toBe(false);
  });

  test("hasColumnFilters is true when multiselect has values", () => {
    const { result } = renderHook(() => useLicenseTableState());
    act(() => result.current.setColumnFilters({ licenseType: ["perpetual"] }));
    expect(result.current.hasColumnFilters).toBe(true);
  });

  test("hasColumnFilters is false when multiselect array is empty", () => {
    const { result } = renderHook(() => useLicenseTableState());
    act(() => result.current.setColumnFilters({ licenseType: [] }));
    expect(result.current.hasColumnFilters).toBe(false);
  });

  test("selectedIds initializes as empty Set", () => {
    const { result } = renderHook(() => useLicenseTableState());
    expect(result.current.selectedIds.size).toBe(0);
  });

  test("showBulkDeleteConfirm initializes as false", () => {
    const { result } = renderHook(() => useLicenseTableState());
    expect(result.current.showBulkDeleteConfirm).toBe(false);
  });

  test("dismissedAttentionIds initializes as empty Set", () => {
    const { result } = renderHook(() => useLicenseTableState());
    expect(result.current.dismissedAttentionIds.size).toBe(0);
  });

  test("dismissed attention items survive leaving and revisiting the page", () => {
    const firstVisit = renderHook(() => useLicenseTableState());
    act(() => firstVisit.result.current.setDismissedAttentionIds(new Set([12, 34])));
    firstVisit.unmount();

    const secondVisit = renderHook(() => useLicenseTableState());
    expect([...secondVisit.result.current.dismissedAttentionIds]).toEqual([12, 34]);
  });
});
