import { renderHook } from "@testing-library/react"
import { useLicenseData } from "../../hooks/useLicenseData.js"

vi.mock("../../utils/helpers.js", () => ({
  daysBetween: vi.fn(() => 1460),
  getCompleteness: vi.fn(() => ({
    percentage: 100,
    checks: [],
    isComplete: true,
    isPending: false,
    isExempt: false,
  })),
  getExpirationStatus: vi.fn(() => ({
    status: "active",
    days: 60,
    label: "60d remaining",
  })),
  todayStr: vi.fn(() => "2026-01-01"),
}))

const defaultOptions = {
  search: "",
  statusFilters: [],
  deptFilter: "all",
  yearFilter: "all",
  currentPage: 1,
  pageSize: 25,
  sortCol: null,
  sortDir: "asc",
  globalSettings: { mandatoryFields: {}, notificationDays: 30 },
  userSettings: {},
  apiStats: null,
}

let _id = 0
const makeLicense = (overrides = {}) => ({
  id: ++_id,
  publisherName: "Acme",
  softwareDescription: "Acme Suite",
  contractNumber: "",
  poNumber: "",
  supplier: "",
  costCentre: "Engineering",
  startDate: "2024-01-01",
  endDate: null,
  expirationStatus: "active",
  daysUntilExpiry: 60,
  completenessPct: 100,
  isCompletenessExempt: false,
  lifecycleStatus: null,
  renewedToId: null,
  retired: false,
  quantity: "10",
  unitPrice: "100",
  currency: "EUR",
  ...overrides,
})

beforeEach(() => {
  _id = 0
})

describe("useLicenseData", () => {
  // 4k
  test("returns all licenses when no filters applied", () => {
    const licenses = [makeLicense(), makeLicense(), makeLicense()]
    const { result } = renderHook(() => useLicenseData(licenses, defaultOptions))
    expect(result.current.filtered.length).toBe(3)
  })

  // 4l
  test("search filters by publisherName", () => {
    const licenses = [
      makeLicense({ publisherName: "Acme" }),
      makeLicense({ publisherName: "Acme" }),
      makeLicense({ publisherName: "Contoso", softwareDescription: "Contoso App" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, search: "contoso" })
    )
    expect(result.current.filtered.length).toBe(1)
  })

  // 4m
  test("search is case-insensitive", () => {
    const licenses = [makeLicense({ publisherName: "acme" })]
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, search: "ACME" })
    )
    expect(result.current.filtered.length).toBe(1)
  })

  test("search matches a former renewal-chain reference alias", () => {
    const licenses = [
      makeLicense({
        licenseRef: "LT-2026-00150",
        licenseRefAliases: ["LT-2026-00151"],
      }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, search: "00151" })
    )
    expect(result.current.filtered).toHaveLength(1)
  })

  // 4n
  test("statusFilters filters by expiration status", () => {
    const licenses = [
      makeLicense({ expirationStatus: "active" }),
      makeLicense({ expirationStatus: "upcoming", startDate: "2030-01-01", daysUntilExpiry: 365 }),
      makeLicense({ expirationStatus: "expired" }),
      makeLicense({ expirationStatus: "expiring" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, statusFilters: ["expired"] })
    )
    expect(result.current.filtered.length).toBe(1)
    expect(result.current.filtered[0].expirationStatus).toBe("expired")
  })

  test("statusFilters filters upcoming licenses", () => {
    const licenses = [
      makeLicense({ expirationStatus: "active" }),
      makeLicense({ expirationStatus: "upcoming", startDate: "2030-01-01" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, statusFilters: ["upcoming"] })
    )
    expect(result.current.filtered.length).toBe(1)
    expect(result.current.filtered[0].expirationStatus).toBe("upcoming")
  })

  test("active filter does not include licenses in the expiring bucket", () => {
    const licenses = [
      makeLicense({ expirationStatus: "active" }),
      makeLicense({ expirationStatus: "perpetual" }),
      makeLicense({ expirationStatus: "expiring" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, statusFilters: ["active"] })
    )

    expect(result.current.filtered.map((license) => license.expirationStatus)).toEqual(["active", "perpetual"])
  })

  test("incomplete filter excludes completeness-exempt licenses", () => {
    const licenses = [
      makeLicense({ completenessPct: 50 }),
      makeLicense({ completenessPct: null, isCompletenessExempt: true }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, statusFilters: ["incomplete"] })
    )

    expect(result.current.filtered).toHaveLength(1)
    expect(result.current.filtered[0].isCompletenessExempt).toBe(false)
  })

  test("stats count upcoming separately from active", () => {
    const licenses = [
      makeLicense({ expirationStatus: "active" }),
      makeLicense({ expirationStatus: "upcoming", startDate: "2030-01-01" }),
      makeLicense({ expirationStatus: "expiring" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, defaultOptions)
    )
    expect(result.current.stats.active).toBe(1)
    expect(result.current.stats.upcoming).toBe(1)
    expect(result.current.stats.expiring).toBe(1)
  })

  // 4o
  test("costCentre columnFilter filters by department", () => {
    const licenses = [
      makeLicense({ costCentre: "Engineering" }),
      makeLicense({ costCentre: "Finance" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, columnFilters: { costCentre: ["Finance"] } })
    )
    expect(result.current.filtered.length).toBe(1)
  })

  // 4p
  test("pagination slices correctly", () => {
    const licenses = Array.from({ length: 10 }, () => makeLicense())
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, pageSize: 3, currentPage: 2 })
    )
    expect(result.current.paginatedItems.length).toBe(3)
    // Page 2 = items at index 3, 4, 5 (ids 4, 5, 6 since id starts at 1)
    expect(result.current.paginatedItems[0].id).toBe(4)
    expect(result.current.paginatedItems[2].id).toBe(6)
  })

  // 4q
  test("totalPages is correct", () => {
    const licenses = Array.from({ length: 10 }, () => makeLicense())
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, pageSize: 3 })
    )
    expect(result.current.totalPages).toBe(4)
  })

  test("keeps one pagination page when filters match no licenses", () => {
    const { result } = renderHook(() => useLicenseData([], defaultOptions))

    expect(result.current.totalPages).toBe(1)
    expect(result.current.paginatedItems).toEqual([])
  })

  test("uses the last valid page when the requested page is out of range", () => {
    const licenses = Array.from({ length: 4 }, () => makeLicense())
    const { result } = renderHook(() =>
      useLicenseData(licenses, { ...defaultOptions, pageSize: 3, currentPage: 9 })
    )

    expect(result.current.totalPages).toBe(2)
    expect(result.current.paginatedItems.map((license) => license.id)).toEqual([4])
  })

  // 4r
  test("departments derived from licenses (deduplicated and sorted)", () => {
    const licenses = [
      makeLicense({ costCentre: "Engineering" }),
      makeLicense({ costCentre: "Finance" }),
      makeLicense({ costCentre: "Engineering" }),
    ]
    const { result } = renderHook(() => useLicenseData(licenses, defaultOptions))
    expect(result.current.departments).toEqual(["Engineering", "Finance"])
  })

  // 4s
  test("sorting by a string field (ascending)", () => {
    const licenses = [
      makeLicense({ publisherName: "Zebra" }),
      makeLicense({ publisherName: "Acme" }),
      makeLicense({ publisherName: "Mango" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        sortCol: "publisher",
        sortDir: "asc",
      })
    )
    expect(result.current.sorted[0].publisherName).toBe("Acme")
  })
})

describe("useLicenseData — columnFilters", () => {
  const customFieldDefs = [
    { id: 1, fieldKey: "owner", fieldType: "text" },
    { id: 2, fieldKey: "renewal", fieldType: "date" },
    { id: 3, fieldKey: "budget", fieldType: "currency" },
    { id: 4, fieldKey: "enabled", fieldType: "boolean" },
  ]
  const customFieldValuesMap = new Map([
    [1, [{ customFieldDefId: 1, valueText: "Alice" }, { customFieldDefId: 2, valueText: "2026-01-01" }, { customFieldDefId: 3, valueCurrency: "10" }, { customFieldDefId: 4, valueText: "true" }]],
    [2, [{ customFieldDefId: 1, valueText: "Bob" }, { customFieldDefId: 2, valueText: "2026-12-01" }, { customFieldDefId: 3, valueCurrency: "20" }, { customFieldDefId: 4, valueText: "false" }]],
  ])

  function withCustomFields(overrides) {
    return { ...defaultOptions, customFieldDefs, customFieldValuesMap, ...overrides }
  }

  test.each([
    ["effectiveQuantity", { effectiveQuantity: "25" }, "25"],
    ["quantityPerUnit", { quantityPerUnit: "5" }, "5"],
    ["noticeDate", { noticeDate: "2026-04-15" }, "2026-04"],
  ])("columnFilters: %s controls filter rows", (key, values, input) => {
    const licenses = [makeLicense(values), makeLicense(values[key] === "25" ? { [key]: "10" } : { [key]: "" })]
    const { result } = renderHook(() => useLicenseData(licenses, { ...defaultOptions, columnFilters: { [key]: input } }))
    expect(result.current.filtered).toHaveLength(1)
  })

  test.each([
    ["cf_owner", "alice"], ["cf_renewal", "2026-01"], ["cf_budget", "10"], ["cf_enabled", "true"],
  ])("columnFilters: custom field %s uses its rendered/canonical value", (key, value) => {
    const licenses = [makeLicense({ id: 1 }), makeLicense({ id: 2 })]
    const { result } = renderHook(() => useLicenseData(licenses, withCustomFields({ columnFilters: { [key]: value } })))
    expect(result.current.filtered.map((license) => license.id)).toEqual([1])
  })

  test("columnFilters: createdBy uses the displayed fallback chain", () => {
    const licenses = [makeLicense({ createdByName: "Alice" }), makeLicense({ createdByEmail: "bob@example.com" }), makeLicense({ createdBy: 42 })]
    const { result } = renderHook(() => useLicenseData(licenses, { ...defaultOptions, columnFilters: { createdBy: "user #42" } }))
    expect(result.current.filtered.map((license) => license.createdBy)).toEqual([42])
  })

  test("columnFilters: License Record ID matches the immutable row id", () => {
    const licenses = [
      makeLicense({ id: 101 }),
      makeLicense({ id: 202 }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { recordId: "202" },
      })
    )

    expect(result.current.filtered.map((license) => license.id)).toEqual([202])
  })

  test("columnFilters: text substring match on publisher", () => {
    const licenses = [
      makeLicense({ publisherName: "Acme Corp" }),
      makeLicense({ publisherName: "Contoso" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { publisher: "acme" },
      })
    )
    expect(result.current.filtered.length).toBe(1)
    expect(result.current.filtered[0].publisherName).toBe("Acme Corp")
  })

  test("columnFilters: exact match on licenseType", () => {
    const licenses = [
      makeLicense({ licenseType: "subscription" }),
      makeLicense({ licenseType: "perpetual" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { licenseType: "subscription" },
      })
    )
    expect(result.current.filtered.length).toBe(1)
    expect(result.current.filtered[0].licenseType).toBe("subscription")
  })

  test("columnFilters: quantity numeric substring match", () => {
    const licenses = [
      makeLicense({ quantity: "10" }),
      makeLicense({ quantity: "25" }),
      makeLicense({ quantity: "100" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { quantity: "10" },
      })
    )
    // "10" matches quantity "10" and "100"
    expect(result.current.filtered.length).toBe(2)
  })

  test("columnFilters: startDate substring match", () => {
    const licenses = [
      makeLicense({ startDate: "2023-01-01" }),
      makeLicense({ startDate: "2024-06-01" }),
      makeLicense({ startDate: "2025-01-01" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { startDate: "2024" },
      })
    )
    // "2024" substring matches only "2024-06-01"
    expect(result.current.filtered.length).toBe(1)
    expect(result.current.filtered[0].startDate).toBe("2024-06-01")
  })

  test("columnFilters: calcTotal filters by computed value", () => {
    const licenses = [
      makeLicense({ quantity: "5", unitPrice: "100" }),  // calcTotal = 500
      makeLicense({ quantity: "2", unitPrice: "100" }),  // calcTotal = 200
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { calcTotal: "500" },
      })
    )
    expect(result.current.filtered.length).toBe(1)
  })

  test("columnFilters: localized price input matches canonical prices", () => {
    const licenses = [
      makeLicense({ unitPrice: "0.01" }),
      makeLicense({ unitPrice: "1.01" }),
    ]
    const { result } = renderHook(() => useLicenseData(licenses, {
      ...defaultOptions,
      userSettings: { numberFormatLocale: "nl-BE" },
      columnFilters: { unitPrice: "0,01" },
    }))

    expect(result.current.filtered.map((license) => license.unitPrice)).toEqual(["0.01"])
  })

  test("columnFilters: maintenance coverage uses selectable values", () => {
    const licenses = [
      makeLicense({ maintenanceCoverage: "included" }),
      makeLicense({ maintenanceCoverage: "separately_tracked" }),
    ]
    const { result } = renderHook(() => useLicenseData(licenses, {
      ...defaultOptions,
      columnFilters: { maintenanceCoverage: ["separately_tracked"] },
    }))

    expect(result.current.filtered.map((license) => license.maintenanceCoverage)).toEqual(["separately_tracked"])
  })

  test("columnFilters: multiple filters are AND-combined", () => {
    const licenses = [
      makeLicense({ publisherName: "Acme", licenseType: "subscription" }),
      makeLicense({ publisherName: "Acme", licenseType: "perpetual" }),
      makeLicense({ publisherName: "Contoso", licenseType: "subscription" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { publisher: "acme", licenseType: "subscription" },
      })
    )
    expect(result.current.filtered.length).toBe(1)
    expect(result.current.filtered[0].publisherName).toBe("Acme")
    expect(result.current.filtered[0].licenseType).toBe("subscription")
  })

  test("columnFilters: empty columnFilters object shows all licenses", () => {
    const licenses = [makeLicense(), makeLicense(), makeLicense()]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: {},
      })
    )
    expect(result.current.filtered.length).toBe(3)
  })

  test("columnFilters: datesFrom filters by exact start year (array)", () => {
    const licenses = [
      makeLicense({ startDate: "2023-01-01" }),
      makeLicense({ startDate: "2024-06-01" }),
      makeLicense({ startDate: "2025-01-01" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { datesFrom: ["2024"] },
      })
    )
    expect(result.current.filtered.length).toBe(1)
    expect(result.current.filtered[0].startDate).toBe("2024-06-01")
  })

  test("columnFilters: datesTo filters by exact end year, excludes perpetuals", () => {
    const licenses = [
      makeLicense({ endDate: "2025-12-31" }),
      makeLicense({ endDate: "2026-06-01" }),
      makeLicense({ endDate: null }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { datesTo: ["2025"] },
      })
    )
    expect(result.current.filtered.length).toBe(1)
    expect(result.current.filtered[0].endDate).toBe("2025-12-31")
  })

  test("columnFilters: costCentre array matches multiple departments (OR logic)", () => {
    const licenses = [
      makeLicense({ costCentre: "IT" }),
      makeLicense({ costCentre: "Finance" }),
      makeLicense({ costCentre: "HR" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { costCentre: ["IT", "Finance"] },
      })
    )
    expect(result.current.filtered.length).toBe(2)
  })

  test("columnFilters: licenseType array matches multiple types (OR logic)", () => {
    const licenses = [
      makeLicense({ licenseType: "subscription" }),
      makeLicense({ licenseType: "perpetual" }),
      makeLicense({ licenseType: "oem" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { licenseType: ["subscription", "perpetual"] },
      })
    )
    expect(result.current.filtered.length).toBe(2)
  })

  test("columnFilters: licenseMetric array filters to matching metric only", () => {
    const licenses = [
      makeLicense({ licenseMetric: "per_user" }),
      makeLicense({ licenseMetric: "per_device" }),
      makeLicense({ licenseMetric: "per_user" }),
    ]
    const { result } = renderHook(() =>
      useLicenseData(licenses, {
        ...defaultOptions,
        columnFilters: { licenseMetric: ["per_user"] },
      })
    )
    expect(result.current.filtered.length).toBe(2)
  })
})
