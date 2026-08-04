import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mock browser APIs used by the download side effect — must come before the import
const mockClick = vi.fn()
const mockAnchor = { href: '', download: '', click: mockClick, remove: vi.fn() }
vi.spyOn(document, 'createElement').mockImplementation((tag) => {
  if (tag === 'a') return mockAnchor
  return document.createElement.wrappedMethod?.(tag) ?? {}
})
vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
URL.createObjectURL = vi.fn().mockReturnValue('blob:mock')
URL.revokeObjectURL = vi.fn()

import { exportFilteredCsv } from '../components/pages/LicensesPage.jsx'

const makeRow = (overrides = {}) => ({
  id: 1,
  publisherName: 'Acme',
  softwareDescription: 'Widget Pro',
  contractNumber: 'C-001',
  poNumber: 'PO-001',
  costCentre: 'IT',
  supplier: 'Vendor Inc',
  licenseType: 'subscription',
  licenseMetric: 'per_user',
  quantity: '5',
  unitPrice: '100',
  currency: 'EUR',
  startDate: '2024-01-01',
  endDate: '2025-01-01',
  skuCode: 'SKU-123',
  totalPoPrice: '500',
  documentCount: 2,
  expiration: { status: 'active', label: '200d' },
  completeness: { percentage: 80, isComplete: false, isExempt: false },
  licenseRef: null,
  externalRef: null,
  ...overrides,
})

let capturedCsvContent = ''
const OriginalBlob = global.Blob
beforeEach(() => {
  global.Blob = class MockBlob {
    constructor(parts) { capturedCsvContent = parts[0] }
  }
})
afterEach(() => {
  global.Blob = OriginalBlob
  capturedCsvContent = ''
})

describe('exportFilteredCsv', () => {
  it('exports the immutable license row identifier with its canonical header', () => {
    const row = makeRow({ id: 42 })
    const cols = [{ key: 'recordId', label: 'License Record ID' }]

    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())

    const lines = capturedCsvContent.split('\n')
    expect(lines[0]).toBe('license_record_id')
    expect(lines[1]).toBe('42')
  })

  it('produces correct header row from column definitions', () => {
    const cols = [
      { key: 'publisher', label: 'Publisher' },
      { key: 'description', label: 'Description' },
    ]
    exportFilteredCsv([makeRow()], cols, 'en-US', 'EUR', [makeRow()], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[0]).toBe('publisher_name,software_description')
  })

  it('exports request/purchase date columns with importable snake_case headers', () => {
    const cols = [
      { key: 'requestDate', label: 'Request Date' },
      { key: 'purchaseDate', label: 'Purchase Date' },
    ]
    const row = makeRow({ requestDate: '2026-01-15T00:00:00Z', purchaseDate: '2026-02-20T00:00:00Z' })
    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[0]).toBe('request_date,purchase_date')
  })

  it('maps publisher and description fields to correct cells', () => {
    const cols = [
      { key: 'publisher', label: 'Publisher' },
      { key: 'description', label: 'Description' },
    ]
    exportFilteredCsv([makeRow()], cols, 'en-US', 'EUR', [makeRow()], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('Acme,Widget Pro')
  })

  it('calcTotal is empty string when quantity or unitPrice is missing', () => {
    const row = makeRow({ quantity: null, unitPrice: null })
    const cols = [{ key: 'calcTotal', label: 'Calc. Total' }]
    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('')
  })

  it('calcTotal is quantity × unitPrice when both are numeric', () => {
    const row = makeRow({ quantity: '5', unitPrice: '100' })
    const cols = [{ key: 'calcTotal', label: 'Calc. Total' }]
    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('500')
  })

  it('wraps values containing commas in double quotes', () => {
    const row = makeRow({ softwareDescription: 'Widget, Pro Edition' })
    const cols = [{ key: 'description', label: 'Description' }]
    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('"Widget, Pro Edition"')
  })

  it('escapes double quotes within values', () => {
    const row = makeRow({ softwareDescription: 'Say "hello"' })
    const cols = [{ key: 'description', label: 'Description' }]
    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('"Say ""hello"""')
  })

  it('prefixes spreadsheet formula values before export', () => {
    const row = makeRow({ softwareDescription: '=HYPERLINK("http://example.test")' })
    const cols = [{ key: 'description', label: 'Description' }]
    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://example.test"")"')
  })

  it('startDate and endDate export as ISO YYYY-MM-DD in canonical mode', () => {
    const cols = [
      { key: 'startDate', label: 'Start Date' },
      { key: 'endDate', label: 'End Date' },
    ]
    exportFilteredCsv([makeRow()], cols, 'en-US', 'EUR', [makeRow()], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[0]).toBe('start_date,end_date')
    expect(lines[1]).toBe('2024-01-01,2025-01-01')
  })

  it('startDate and endDate use user date format in localized mode', () => {
    const cols = [
      { key: 'startDate', label: 'Start Date' },
      { key: 'endDate', label: 'End Date' },
    ]
    exportFilteredCsv([makeRow()], cols, 'en-US', 'EUR', [makeRow()], new Map(), {
      localized: true,
      userSettings: { dateFormat: 'DD/MM/YYYY' },
    })
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('01/01/2024,01/01/2025')
  })

  it('unitPrice exports as canonical decimal in canonical mode', () => {
    const cols = [{ key: 'unitPrice', label: 'Unit Price' }]
    exportFilteredCsv([makeRow()], cols, 'en-US', 'EUR', [makeRow()], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('100')
  })

  it('unitPrice exports with locale decimal in localized mode', () => {
    const cols = [{ key: 'unitPrice', label: 'Unit Price' }]
    exportFilteredCsv([makeRow()], cols, 'en-US', 'EUR', [makeRow()], new Map(), {
      localized: true,
      userSettings: { numberFormatLocale: 'nl-BE' },
    })
    const lines = capturedCsvContent.split('\n')
    // nl-BE uses comma as decimal separator
    expect(lines[1]).toBe('"100,00"')
  })

  it('custom field column returns valueText from customFieldValuesMap', () => {
    const cfDef = { id: 1, fieldType: 'text' }
    const col = { key: 'cf_owner', label: 'Owner', _cfDef: cfDef }
    const row = makeRow({ id: 42 })
    const valuesMap = new Map([[42, [{ customFieldDefId: 1, valueText: 'IT Dept' }]]])
    exportFilteredCsv([row], [col], 'en-US', 'EUR', [row], valuesMap)
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('IT Dept')
  })

  it('uses the stable custom field key for canonical full-data exports', () => {
    const cfDef = { id: 1, fieldKey: 'cf_contract_owner', fieldType: 'text' }
    const col = { key: 'cf_cf_contract_owner', label: 'Contract Owner', _cfDef: cfDef }
    const row = makeRow({ id: 42 })
    const valuesMap = new Map([[42, [{ customFieldDefId: 1, valueText: 'Alice' }]]])

    exportFilteredCsv([row], [col], 'en-US', 'EUR', [row], valuesMap, {
      stableCustomFieldHeaders: true,
    })

    const lines = capturedCsvContent.split('\n')
    expect(lines[0]).toBe('cf_contract_owner')
    expect(lines[1]).toBe('Alice')
  })

  it('custom field column returns empty string when license id not in map', () => {
    const cfDef = { id: 1, fieldType: 'text' }
    const col = { key: 'cf_owner', label: 'Owner', _cfDef: cfDef }
    const row = makeRow({ id: 99 })
    exportFilteredCsv([row], [col], 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('')
  })

  it('custom boolean field exports true, false, or an empty cell', () => {
    const cfDef = { id: 1, fieldType: 'boolean' }
    const col = { key: 'cf_uses_ai', label: 'Uses AI', _cfDef: cfDef }
    const rows = [makeRow({ id: 1 }), makeRow({ id: 2 }), makeRow({ id: 3 })]
    const valuesMap = new Map([
      [1, [{ customFieldDefId: 1, valueText: 'true' }]],
      [2, [{ customFieldDefId: 1, valueText: 'false' }]],
      [3, [{ customFieldDefId: 1, valueText: null }]],
    ])

    exportFilteredCsv(rows, [col], 'en-US', 'EUR', rows, valuesMap)
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('true')
    expect(lines[2]).toBe('false')
    expect(lines[3]).toBe('')
  })

  it('unknown column key produces empty cell', () => {
    const cols = [{ key: 'nonexistent', label: 'X' }]
    exportFilteredCsv([makeRow()], cols, 'en-US', 'EUR', [makeRow()], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('')
  })

  it('exports multiple rows', () => {
    const cols = [{ key: 'publisher', label: 'Publisher' }]
    const rows = [makeRow({ publisherName: 'Acme' }), makeRow({ publisherName: 'Contoso' })]
    exportFilteredCsv(rows, cols, 'en-US', 'EUR', rows, new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines).toHaveLength(3) // header + 2 data rows
    expect(lines[1]).toBe('Acme')
    expect(lines[2]).toBe('Contoso')
  })

  it('exports License Ref, External Ref, and Currency when selected', () => {
    const row = makeRow({
      licenseRef: 'LT-2026-00001',
      externalRef: 'EXT-123',
    })
    const cols = [
      { key: 'licenseRef', label: 'License Ref' },
      { key: 'externalRef', label: 'External Ref' },
      { key: 'currency', label: 'Currency' },
      { key: 'publisher', label: 'Publisher' },
    ]
    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[0]).toBe('license_ref,external_ref,currency,publisher_name')
    expect(lines[1]).toBe('LT-2026-00001,EXT-123,EUR,Acme')
  })

  it('exports full notes and history metadata without table truncation', () => {
    const row = makeRow({
      notes: 'A long note that must remain complete in CSV exports.',
      createdByName: 'admin',
      createdAt: '2026-05-01T10:15:00Z',
    })
    const cols = [
      { key: 'notes', label: 'Notes' },
      { key: 'createdBy', label: 'Created By' },
      { key: 'createdAt', label: 'Created' },
    ]
    exportFilteredCsv([row], cols, 'en-US', 'EUR', [row], new Map())
    const lines = capturedCsvContent.split('\n')
    expect(lines[1]).toBe('A long note that must remain complete in CSV exports.,admin,2026-05-01T10:15:00Z')
  })
})
