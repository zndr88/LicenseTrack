import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import DetailPanel from '../components/licenses/DetailPanel.jsx'
import { updateLicense } from '../api/licenses.js'

vi.mock('../api/documents.js', () => ({
  getDocuments: vi.fn().mockResolvedValue({ data: [], error: null }),
  uploadDocument: vi.fn(),
  deleteDocument: vi.fn(),
  deleteProcurementDocument: vi.fn(),
  downloadDocument: vi.fn(),
  downloadProcurementDocument: vi.fn(),
  invokeDocumentAction: vi.fn(),
  listDocumentActions: vi.fn().mockResolvedValue({ data: [], error: null }),
  listDocumentProcessingResults: vi.fn().mockResolvedValue({ data: [], error: null }),
  acceptDocumentProcessingResult: vi.fn(),
  rejectDocumentProcessingResult: vi.fn(),
}))

vi.mock('../api/pluginActions.js', () => ({
  listPluginActions: vi.fn().mockResolvedValue({ data: { actions: [] }, error: null }),
  invokePluginAction: vi.fn(),
}))

vi.mock('../api/pluginSuggestions.js', () => ({
  listPluginSuggestions: vi.fn().mockResolvedValue({ data: [], error: null }),
  acceptPluginSuggestion: vi.fn(),
  rejectPluginSuggestion: vi.fn(),
}))

vi.mock('../api/settings.js', () => ({
  listCustomFields: vi.fn().mockResolvedValue({ data: [], error: null }),
}))

vi.mock('../api/licenses.js', () => ({
  getCustomFieldValues: vi.fn().mockResolvedValue({ data: { values: [] }, error: null }),
  getLicenseProcurementTrail: vi.fn().mockResolvedValue({
    data: {
      licenseId: 1,
      licenseRef: 'LT-2026-00001',
      sourcingRequest: null,
      sourcingItem: null,
      pendingOrder: null,
      conversion: { sourceMatchType: 'none' },
    },
    error: null,
  }),
  getLicense: vi.fn(),
  upsertCustomFieldValues: vi.fn(),
  getAllCustomFieldValues: vi.fn(),
  getLicenses: vi.fn(),
  updateLicense: vi.fn(),
  patchLicenseField: vi.fn(),
  markLicenseNoticeHandled: vi.fn(),
  deleteLicense: vi.fn(),
  getStats: vi.fn(),
  initiateRenewal: vi.fn(),
  initiateRenewalBundle: vi.fn(),
  cancelRenewal: vi.fn(),
  getMaintenanceForParent: vi.fn(),
  disableMaintenance: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function render(ui) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  )
}

const baseLicense = {
  id: 1,
  licenseRef: 'LT-2026-00001',
  publisherName: 'Acme Corp',
  softwareDescription: 'Widget Pro',
  licenseType: 'subscription',
  licenseMetric: 'per_user',
  quantity: '10',
  unitPrice: '50',
  currency: 'EUR',
  startDate: '2024-01-01',
  endDate: '2025-01-01',
  contractNumber: 'C-001',
  poNumber: 'PO-001',
  invoiceNumber: 'INV-001',
  contactEmail: 'vendor@example.com',
  supplier: 'Vendor Inc',
  costCentre: 'IT',
  notes: '',
  portalUrl: null,
  retired: false,
  lifecycleStatus: 'active',
  isCompletenessExempt: false,
  renewedToId: null,
  renewedFromId: null,
  documentCount: 0,
  documents: { invoice: [], eula: [], entitlement: [] },
  expiration: { status: 'active', label: '200d' },
  completeness: { percentage: 80, isComplete: false, isExempt: false },
}

const baseProps = {
  license: baseLicense,
  user: { id: 2, role: 'viewer' },
  userSettings: {
    visibleInDetail: {
      licenseType: true, licenseMetric: true, quantity: true,
      skuCode: true, unitPrice: true, totalPoPrice: true,
      supplier: true, costCentre: true, notes: true,
    },
    numberFormatLocale: 'en-US',
    displayCurrency: 'EUR',
  },
  globalSettings: { notificationDays: 30, mandatoryFields: [] },
  allLicenses: [baseLicense],
  sourcingItems: [],
  pendingOrders: [],
  contracts: [],
  onClose: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onCreateRenewal: vi.fn(),
  onCancelRenewal: vi.fn(),
  onNavigateToSourcing: vi.fn(),
  onNavigateToPendingOrder: vi.fn(),
  onNavigateToContract: vi.fn(),
  onCreateContract: vi.fn(),
  onNavigate: vi.fn(),
}

describe('DetailPanel identity references', () => {
  it('shows the external reference next to the LT reference', () => {
    render(
      <DetailPanel
        {...baseProps}
        license={{ ...baseLicense, externalRef: 'EXT-123' }}
      />
    )

    expect(screen.getByText('LT-2026-00001 | EXT-123')).toBeInTheDocument()
  })

  it('shows only the LT reference when no external reference exists', () => {
    render(<DetailPanel {...baseProps} />)

    expect(screen.getByText('LT-2026-00001')).toBeInTheDocument()
    expect(screen.queryByText(/LT-2026-00001 \|/)).not.toBeInTheDocument()
  })
})

describe('DetailPanel secondary contacts', () => {
  it('edits secondary contacts from the people section', async () => {
    const user = userEvent.setup()
    updateLicense.mockResolvedValue({
      data: {
        ...baseLicense,
        budgetOwnerEmail: 'owner@example.com',
        secondaryContacts: ['legal@example.com'],
      },
      error: null,
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        license={{
          ...baseLicense,
          budgetOwnerEmail: 'owner@example.com',
          secondaryContacts: ['secondary@example.com'],
        }}
      />
    )

    await user.click(screen.getByText('Relationships'))
    await user.click(screen.getByRole('button', { name: /edit secondary contacts/i }))
    const input = screen.getByLabelText('Secondary contact')
    await user.clear(input)
    await user.type(input, 'legal@example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLicense).toHaveBeenCalledWith(1, {
        secondaryContacts: ['legal@example.com'],
      })
    })
  })
})

describe('DetailPanel procurement milestones', () => {
  it('shows request and purchase timestamps under key dates and contract', async () => {
    const user = userEvent.setup()
    render(
      <DetailPanel
        {...baseProps}
        license={{
          ...baseLicense,
          requestDate: '2026-05-02T13:45:00Z',
          purchaseDate: '2026-05-04T09:15:00Z',
        }}
      />
    )

    await user.click(screen.getByText('Key Dates & Contract'))

    expect(screen.getByText('Request Date')).toBeInTheDocument()
    expect(screen.getByText('02/05/2026 13:45')).toBeInTheDocument()
    expect(screen.getByText('Purchase Date')).toBeInTheDocument()
    expect(screen.getByText('04/05/2026 09:15')).toBeInTheDocument()
  })

  it('marks a notice deadline handled from the key dates section', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const { markLicenseNoticeHandled } = await import('../api/licenses.js')
    markLicenseNoticeHandled.mockResolvedValue({
      data: {
        ...baseLicense,
        noticeDate: '2026-07-26',
        noticeHandledAt: '2026-06-26T07:00:00Z',
        noticeHandledByUserId: 2,
      },
      error: null,
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        license={{ ...baseLicense, noticeDate: '2026-07-26' }}
        onUpdate={onUpdate}
      />
    )

    await user.click(screen.getByText('Key Dates & Contract'))
    await user.click(screen.getByRole('button', { name: /mark handled/i }))

    await waitFor(() => {
      expect(markLicenseNoticeHandled).toHaveBeenCalledWith(1)
    })
    expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
      noticeHandledAt: '2026-06-26T07:00:00Z',
      noticeHandledByUserId: 2,
    }))
  })
})

describe('DetailPanel renewal bundles', () => {
  it('initiates one bundle request for same-PO same-end-date siblings', async () => {
    const user = userEvent.setup()
    const onCreateRenewal = vi.fn()
    const onCreateRenewalBundle = vi.fn().mockResolvedValue({ ok: true, data: {} })
    const renewalLicense = {
      ...baseLicense,
      budgetOwnerEmail: 'owner@example.com',
      poNumber: 'PO-BUNDLE-1',
      endDate: '2026-01-01',
    }
    const sibling = {
      ...baseLicense,
      id: 2,
      softwareDescription: 'Widget Add-on',
      budgetOwnerEmail: 'owner@example.com',
      poNumber: 'PO-BUNDLE-1',
      endDate: '2026-01-01',
    }

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        license={renewalLicense}
        allLicenses={[renewalLicense, sibling]}
        onCreateRenewal={onCreateRenewal}
        onCreateRenewalBundle={onCreateRenewalBundle}
      />
    )

    expect(screen.getByText(/One sourcing request with 2 license lines/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /initiate renewal \(2 licenses\)/i }))

    await waitFor(() => {
      expect(onCreateRenewalBundle).toHaveBeenCalledWith([1, 2])
    })
    expect(onCreateRenewal).not.toHaveBeenCalled()
  })
})

describe('DetailPanel history', () => {
  it('shows creator and record timestamps in a history section', async () => {
    const user = userEvent.setup()
    render(
      <DetailPanel
        {...baseProps}
        license={{
          ...baseLicense,
          createdBy: 7,
          createdByName: 'creator-account',
          createdByEmail: 'creator@example.com',
          createdAt: '2026-05-02T13:45:00Z',
          updatedAt: '2026-05-04T09:15:00Z',
        }}
      />
    )

    await user.click(screen.getByText('History'))

    const recordIdLabel = screen.getByText('License Record ID')
    expect(recordIdLabel.parentElement).toHaveTextContent('1')
    expect(screen.getByText('Created By')).toBeInTheDocument()
    expect(screen.getByText('creator-account')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('02/05/2026 13:45')).toBeInTheDocument()
    expect(screen.getByText('Last Updated')).toBeInTheDocument()
    expect(screen.getByText('04/05/2026 09:15')).toBeInTheDocument()
  })

  it('shows linked procurement trail records and navigation actions', async () => {
    const user = userEvent.setup()
    const { getLicenseProcurementTrail } = await import('../api/licenses.js')
    getLicenseProcurementTrail.mockResolvedValueOnce({
      data: {
        licenseId: 1,
        licenseRef: 'LT-2026-00001',
        sourcingRequest: {
          id: 42,
          status: 'converted',
          supplier: 'Reseller One',
          contactEmail: 'sales@example.com',
          notes: null,
          createdAt: '2026-05-02T13:45:00Z',
          updatedAt: '2026-05-03T13:45:00Z',
          quoteDocuments: [{ id: 7, originalFilename: 'quote.pdf', category: 'quote', uploadedAt: '2026-05-02T14:00:00Z' }],
        },
        sourcingItem: {
          id: 99,
          status: 'converted',
          publisherName: 'Acme Corp',
          softwareDescription: 'Widget Pro',
          quantity: '10',
          estimatedUnitPrice: '50',
          estimatedTotalPrice: '500',
          currency: 'EUR',
          renewalForLicenseId: null,
          cotermPredecessorIds: null,
        },
        pendingOrder: {
          id: 77,
          poNumber: 'PO-001',
          status: 'converted',
          supplier: 'Reseller One',
          notes: null,
          createdAt: '2026-05-04T09:15:00Z',
          updatedAt: '2026-05-05T09:15:00Z',
          documents: [{ id: 8, originalFilename: 'invoice.pdf', category: 'invoice', uploadedAt: '2026-05-05T10:00:00Z' }],
        },
        conversion: {
          pendingOrderId: 77,
          sourceSourcingItemId: 99,
          sourceMatchType: 'exact',
          requestDate: '2026-05-02T13:45:00Z',
          purchaseDate: '2026-05-04T09:15:00Z',
        },
      },
      error: null,
    })

    render(<DetailPanel {...baseProps} />)

    await user.click(screen.getByText('History'))

    expect(await screen.findByText('Procurement Trail')).toBeInTheDocument()
    expect(screen.getByText('Sourcing Request')).toBeInTheDocument()
    expect(screen.getByText(/Sourcing Request ID #42/)).toBeInTheDocument()
    expect(screen.getByText('Sourcing Line')).toBeInTheDocument()
    expect(screen.getByText(/Sourcing Line ID #99/)).toBeInTheDocument()
    expect(screen.getByText('Pending Order')).toBeInTheDocument()
    expect(screen.getByText(/PO-001/)).toBeInTheDocument()
    expect(screen.getByText(/Pending Order #77/)).toBeInTheDocument()
    expect(screen.queryByText('Evidence')).not.toBeInTheDocument()
    expect(screen.queryByText('Quote x1')).not.toBeInTheDocument()
    expect(screen.queryByText('Invoice x1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view sourcing/i }))
    expect(baseProps.onNavigateToSourcing).toHaveBeenCalledWith(99)
    await user.click(screen.getByRole('button', { name: /view order/i }))
    expect(baseProps.onNavigateToPendingOrder).toHaveBeenCalledWith(77)
  })
})

describe('DetailPanel email publisher scope', () => {
  it('prompts for same-PO same-publisher license lines using case-insensitive matching', async () => {
    const user = userEvent.setup()
    const siblingLicense = {
      ...baseLicense,
      id: 2,
      publisherName: ' acme corp ',
      softwareDescription: 'Widget Add-on',
      contractNumber: 'C-002',
      invoiceNumber: 'INV-002',
      quantity: '5',
      skuCode: 'ADDON-5',
    }
    const otherPublisherLicense = {
      ...baseLicense,
      id: 3,
      publisherName: 'Other Corp',
      softwareDescription: 'Other Suite',
    }

    render(
      <DetailPanel
        {...baseProps}
        allLicenses={[baseLicense, siblingLicense, otherPublisherLicense]}
      />
    )

    await user.click(screen.getByRole('link', { name: /email publisher/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/This PO has 2 license lines for Acme Corp/i)).toBeInTheDocument()

    const allMatchingLink = screen.getByRole('link', { name: /all matching licenses/i })
    const decodedHref = decodeURIComponent(allMatchingLink.getAttribute('href'))
    expect(decodedHref).toContain('mailto:vendor@example.com?subject=Re: PO PO-001 - Acme Corp licenses')
    expect(decodedHref).toContain('1. Widget Pro')
    expect(decodedHref).toContain('2. Widget Add-on')
    expect(decodedHref).not.toContain('Other Suite')

    const singleLink = screen.getByRole('link', { name: /this license only/i })
    const decodedSingleHref = decodeURIComponent(singleLink.getAttribute('href'))
    expect(decodedSingleHref).toContain('Re: Contract C-001 - Widget Pro')
    expect(decodedSingleHref).not.toContain('Widget Add-on')
  })

  it('keeps a direct mailto link when no same-publisher PO sibling exists', async () => {
    render(
      <DetailPanel
        {...baseProps}
        allLicenses={[
          baseLicense,
          { ...baseLicense, id: 2, publisherName: 'Other Corp', softwareDescription: 'Other Suite' },
        ]}
      />
    )

    const emailLink = screen.getByRole('link', { name: /email publisher/i })
    expect(decodeURIComponent(emailLink.getAttribute('href'))).toContain('Re: Contract C-001 - Widget Pro')
  })
})

describe('DetailPanel — portal URL', () => {
  it('does not render Portal URL label when portalUrl is null', async () => {
    render(<DetailPanel {...baseProps} />)
    await waitFor(() => {
      expect(screen.queryByText('Portal URL')).not.toBeInTheDocument()
    })
  })

  it('renders editable Portal URL row for SaaS licenses even when blank', async () => {
    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        license={{ ...baseLicense, licenseType: 'saas', portalUrl: null }}
      />
    )
    const detailsBtn = await screen.findByRole('button', { name: /^details$/i })
    fireEvent.click(detailsBtn)

    expect(screen.getByText('Portal URL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit portal url/i })).toBeInTheDocument()
  })

  it('does not render Portal URL when licenseType is not saas even with a portalUrl', async () => {
    const props = {
      ...baseProps,
      license: { ...baseLicense, licenseType: 'perpetual', portalUrl: 'https://example.com' },
    }
    render(<DetailPanel {...props} />)
    await waitFor(() => {
      expect(screen.queryByText('Portal URL')).not.toBeInTheDocument()
    })
  })

  it('renders Portal URL as an anchor with correct attributes when saas + portalUrl set', async () => {
    const props = {
      ...baseProps,
      license: { ...baseLicense, licenseType: 'saas', portalUrl: 'https://portal.example.com' },
    }
    render(<DetailPanel {...props} />)
    // The 'Details' section header (commercial) is closed by default — open it
    const detailsBtn = await screen.findByRole('button', { name: /^details$/i })
    fireEvent.click(detailsBtn)
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /portal\.example\.com/i })
      expect(link).toHaveAttribute('href', 'https://portal.example.com')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })
})

describe('DetailPanel — custom fields section', () => {
  it('does not render Custom Fields section header when listCustomFields returns empty', async () => {
    render(<DetailPanel {...baseProps} />)
    await waitFor(() => {
      expect(screen.queryByText('Custom Fields')).not.toBeInTheDocument()
    })
  })

  it('renders Custom Fields section header when defs are returned', async () => {
    const { listCustomFields } = await import('../api/settings.js')
    listCustomFields.mockResolvedValueOnce({
      data: [{
        id: 1, name: 'Contract Owner', fieldKey: 'contract_owner',
        fieldType: 'text', displayOrder: 0,
      }],
      error: null,
    })
    render(<DetailPanel {...baseProps} />)
    await waitFor(() => {
      expect(screen.getByText('Custom Fields')).toBeInTheDocument()
    })
  })

  it('does not render Custom Fields section when all defs have visibleInDetail explicitly false', async () => {
    const { listCustomFields } = await import('../api/settings.js')
    listCustomFields.mockResolvedValueOnce({
      data: [{
        id: 1, name: 'Contract Owner', fieldKey: 'contract_owner',
        fieldType: 'text', displayOrder: 0,
      }],
      error: null,
    })
    const props = {
      ...baseProps,
      userSettings: {
        ...baseProps.userSettings,
        visibleInDetail: {
          ...baseProps.userSettings.visibleInDetail,
          cf_contract_owner: false,
        },
      },
    }
    render(<DetailPanel {...props} />)
    await waitFor(() => {
      expect(screen.queryByText('Custom Fields')).not.toBeInTheDocument()
    })
  })

  it('saves a custom text field through the field edit modal', async () => {
    const user = userEvent.setup()
    const { listCustomFields } = await import('../api/settings.js')
    const { getCustomFieldValues, upsertCustomFieldValues } = await import('../api/licenses.js')
    listCustomFields.mockResolvedValueOnce({
      data: [{
        id: 7, name: 'Contract Owner', fieldKey: 'contract_owner',
        fieldType: 'text', displayOrder: 0,
      }],
      error: null,
    })
    getCustomFieldValues.mockResolvedValueOnce({
      data: { values: [{ customFieldDefId: 7, valueText: 'Alice' }] },
      error: null,
    })
    upsertCustomFieldValues.mockResolvedValueOnce({
      data: { values: [{ customFieldDefId: 7, valueText: 'Bob' }] },
      error: null,
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^custom fields$/i }))
    await user.click(screen.getByRole('button', { name: /edit contract owner/i }))
    const input = screen.getByDisplayValue('Alice')
    await user.clear(input)
    await user.type(input, 'Bob')
    expect(input).toHaveValue('Bob')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(upsertCustomFieldValues).toHaveBeenCalledWith(1, {
        values: [{ customFieldDefId: 7, valueText: 'Bob' }],
      })
    })
  })

  it('displays boolean and blank custom field values', async () => {
    const user = userEvent.setup()
    const { listCustomFields } = await import('../api/settings.js')
    const { getCustomFieldValues } = await import('../api/licenses.js')
    listCustomFields.mockResolvedValueOnce({
      data: [
        {
          id: 8, name: 'Approval Required', fieldKey: 'approval_required',
          fieldType: 'boolean', displayOrder: 0,
        },
        {
          id: 9, name: 'Empty Field', fieldKey: 'empty_field',
          fieldType: 'text', displayOrder: 1,
        },
      ],
      error: null,
    })
    getCustomFieldValues.mockResolvedValueOnce({
      data: { values: [{ customFieldDefId: 8, valueText: 'true' }] },
      error: null,
    })

    render(<DetailPanel {...baseProps} />)

    await user.click(await screen.findByRole('button', { name: /^custom fields$/i }))
    expect(screen.getByText('Approval Required')).toBeInTheDocument()
    expect(screen.getByText('True')).toBeInTheDocument()

    const blankRow = screen.getByText('Empty Field').closest('.dp-field')
    expect(within(blankRow).getByText('—')).toBeInTheDocument()
  })

  it('saves a custom boolean field through the field edit modal', async () => {
    const user = userEvent.setup()
    const { listCustomFields } = await import('../api/settings.js')
    const { getCustomFieldValues, upsertCustomFieldValues } = await import('../api/licenses.js')
    upsertCustomFieldValues.mockClear()
    listCustomFields.mockResolvedValueOnce({
      data: [{
        id: 8, name: 'Approval Required', fieldKey: 'approval_required',
        fieldType: 'boolean', displayOrder: 0,
      }],
      error: null,
    })
    getCustomFieldValues.mockResolvedValueOnce({
      data: { values: [{ customFieldDefId: 8, valueText: 'false' }] },
      error: null,
    })
    upsertCustomFieldValues.mockResolvedValueOnce({
      data: { values: [{ customFieldDefId: 8, valueText: 'true' }] },
      error: null,
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^custom fields$/i }))
    await user.click(screen.getByRole('button', { name: /edit approval required/i }))
    await user.selectOptions(screen.getByRole('combobox'), 'true')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(upsertCustomFieldValues).toHaveBeenCalledWith(1, {
        values: [{ customFieldDefId: 8, valueText: 'true' }],
      })
    })
  })

  it('saves a custom number field through the field edit modal', async () => {
    const user = userEvent.setup()
    const { listCustomFields } = await import('../api/settings.js')
    const { getCustomFieldValues, upsertCustomFieldValues } = await import('../api/licenses.js')
    upsertCustomFieldValues.mockClear()
    listCustomFields.mockResolvedValueOnce({
      data: [{
        id: 10, name: 'Seat Buffer', fieldKey: 'seat_buffer',
        fieldType: 'number', displayOrder: 0,
      }],
      error: null,
    })
    getCustomFieldValues.mockResolvedValueOnce({
      data: { values: [{ customFieldDefId: 10, valueText: '12' }] },
      error: null,
    })
    upsertCustomFieldValues.mockResolvedValueOnce({
      data: { values: [{ customFieldDefId: 10, valueText: '24' }] },
      error: null,
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^custom fields$/i }))
    await user.click(screen.getByRole('button', { name: /edit seat buffer/i }))
    const input = screen.getByDisplayValue('12')
    expect(input).toHaveAttribute('type', 'number')
    await user.clear(input)
    await user.type(input, '24')
    expect(input).toHaveValue(24)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(upsertCustomFieldValues).toHaveBeenCalledWith(1, {
        values: [{ customFieldDefId: 10, valueText: '24' }],
      })
    })
  })

  it('toggles renewal notifications from completeness and flags', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        license={{ ...baseLicense, renewalNotificationsEnabled: true }}
        onUpdate={onUpdate}
      />
    )

    await user.click(screen.getByRole('button', { name: /^completeness & flags$/i }))
    await user.click(screen.getByRole('switch', { name: /toggle renewal notifications/i }))

    expect(onUpdate).toHaveBeenCalledWith(1, {
      renewalNotificationsEnabled: false,
    })
  })
})

describe('DetailPanel documents', () => {
  it('hides license document download actions for read-only viewers', async () => {
    const user = userEvent.setup()
    const { getDocuments, downloadDocument } = await import('../api/documents.js')
    getDocuments.mockResolvedValueOnce({
      data: [{
        id: 9,
        category: 'invoice',
        original_filename: 'invoice.pdf',
        file_size: 2048,
        uploaded_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'viewer', allowDownloads: false }}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^documents/i }))
    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^download$/i })).not.toBeInTheDocument()
    expect(downloadDocument).not.toHaveBeenCalled()
  })

  it('removes a document and refreshes the license document count', async () => {
    const user = userEvent.setup()
    const { getDocuments, deleteDocument } = await import('../api/documents.js')
    const { getLicense } = await import('../api/licenses.js')
    const onUpdate = vi.fn()
    getDocuments
      .mockResolvedValueOnce({
        data: [{
          id: 9,
          category: 'invoice',
          original_filename: 'invoice.pdf',
          file_size: 2048,
          uploaded_at: '2026-01-01T00:00:00Z',
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })
    deleteDocument.mockResolvedValueOnce({ error: null })
    getLicense.mockResolvedValueOnce({ data: { completenessPct: 100 }, error: null })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        onUpdate={onUpdate}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^documents/i }))
    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^remove$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^remove$/i }))

    await waitFor(() => {
      expect(deleteDocument).toHaveBeenCalledWith(9)
      expect(onUpdate).toHaveBeenCalledWith(1, {
        documentCount: 0,
        availableDocumentCount: 0,
        missingDocumentCount: 0,
        unavailableDocumentCount: 0,
        completenessPct: 100,
      })
    })
  })

  it('keeps missing document rows visible and disables download', async () => {
    const user = userEvent.setup()
    const { getDocuments, downloadDocument } = await import('../api/documents.js')
    getDocuments.mockResolvedValueOnce({
      data: [
        {
          id: 9,
          category: 'invoice',
          original_filename: 'invoice.pdf',
          file_size: 2048,
          uploaded_at: '2026-01-01T00:00:00Z',
          file_availability: 'missing',
        },
      ],
      error: null,
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin', allowDownloads: true }}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^documents/i }))
    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.getByText('File missing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^download$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^documents/i })).toHaveTextContent('Documents (1)')

    await user.click(screen.getByRole('button', { name: /^download$/i }))
    expect(downloadDocument).not.toHaveBeenCalled()
  })

  it('shows the specific missing-file error when a download fails after load', async () => {
    const user = userEvent.setup()
    const { getDocuments, downloadDocument } = await import('../api/documents.js')
    getDocuments.mockResolvedValueOnce({
      data: [
        {
          id: 9,
          category: 'invoice',
          original_filename: 'invoice.pdf',
          file_size: 2048,
          uploaded_at: '2026-01-01T00:00:00Z',
          file_availability: 'available',
        },
      ],
      error: null,
    })
    downloadDocument.mockResolvedValueOnce({
      error: 'The document record exists, but the file is missing from managed storage.',
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin', allowDownloads: true }}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^documents/i }))
    await user.click(await screen.findByRole('button', { name: /^download$/i }))

    expect(await screen.findByText('The document record exists, but the file is missing from managed storage.')).toBeInTheDocument()
    expect(downloadDocument).toHaveBeenCalledWith(9, 'invoice.pdf')
  })

  it('refreshes processing suggestions after requesting document processing', async () => {
    const user = userEvent.setup()
    const {
      getDocuments,
      invokeDocumentAction,
      listDocumentActions,
      listDocumentProcessingResults,
    } = await import('../api/documents.js')

    getDocuments.mockResolvedValueOnce({
      data: [{
        id: 9,
        category: 'invoice',
        original_filename: 'invoice.pdf',
        file_size: 2048,
        uploaded_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    })
    listDocumentActions.mockResolvedValueOnce({
      data: [{
        key: 'request_processing',
        label: 'Request processing',
        description: 'Emit a document action event for an external processor.',
      }],
      error: null,
    })
    listDocumentProcessingResults
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    invokeDocumentAction.mockResolvedValueOnce({ data: { status: 'accepted' }, error: null })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^documents/i }))
    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /^request processing$/i }))

    await waitFor(() => {
      expect(invokeDocumentAction).toHaveBeenCalledWith('request_processing', {
        documentType: 'license_document',
        documentId: 9,
      })
      expect(listDocumentProcessingResults).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByText('Waiting for processor...')).toBeInTheDocument()
  })

  it('shows pending document processing suggestions and accepts them', async () => {
    const user = userEvent.setup()
    const {
      getDocuments,
      listDocumentProcessingResults,
      acceptDocumentProcessingResult,
    } = await import('../api/documents.js')
    const { getLicense } = await import('../api/licenses.js')
    const onUpdate = vi.fn()

    getDocuments.mockResolvedValue({ data: [], error: null })
    listDocumentProcessingResults
      .mockResolvedValueOnce({
        data: [{
          id: 4,
          status: 'pending',
          capabilityKey: 'licensetrack-ai',
          summary: 'Detected entitlement details.',
          suggestedFields: [{
            field: 'quantity',
            value: '25',
            confidence: 0.91,
            source: 'Page 1',
          }],
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })
    acceptDocumentProcessingResult.mockResolvedValueOnce({
      data: { appliedFields: ['quantity'] },
      error: null,
    })
    getLicense.mockResolvedValueOnce({
      data: { ...baseLicense, quantity: '25' },
      error: null,
    })

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        onUpdate={onUpdate}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^documents/i }))
    expect(await screen.findByText('Detected entitlement details.')).toBeInTheDocument()
    expect(screen.getByText('91%')).toBeInTheDocument()

    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^accept selected/i }))

    await waitFor(() => {
      expect(acceptDocumentProcessingResult).toHaveBeenCalledWith(4, [0])
      expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ quantity: '25' }))
    })
  })
})

describe('DetailPanel field editing', () => {
  it('saves full detail panel edits with blank date fields', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(
      <DetailPanel
        {...baseProps}
        license={{ ...baseLicense, startDate: '', endDate: '' }}
        user={{ id: 2, role: 'admin' }}
        onUpdate={onUpdate}
      />
    )

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const descriptionInput = screen.getByLabelText('Software Description')
    await user.clear(descriptionInput)
    await user.type(descriptionInput, 'Panel Edited Suite')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
        softwareDescription: 'Panel Edited Suite',
        startDate: '',
        endDate: '',
      }))
    })
  })

  it('saves a single field through the detail panel edit modal', async () => {
    const user = userEvent.setup()
    const { patchLicenseField } = await import('../api/licenses.js')
    patchLicenseField.mockResolvedValueOnce({
      data: { ...baseLicense, publisherName: 'Updated Publisher' },
      error: null,
    })
    const onUpdate = vi.fn()

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        onUpdate={onUpdate}
      />
    )

    await user.click(await screen.findByRole('button', { name: /edit publisher/i }))
    const input = screen.getByDisplayValue('Acme Corp')
    fireEvent.change(input, { target: { value: 'Updated Publisher' } })
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(patchLicenseField).toHaveBeenCalledWith(1, 'publisherName', 'Updated Publisher')
    })
    expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
      publisherName: 'Updated Publisher',
      documentCount: baseLicense.documentCount,
    }))
  })

  it('applies dependent fields returned by a single-field license type edit', async () => {
    const user = userEvent.setup()
    const { patchLicenseField } = await import('../api/licenses.js')
    patchLicenseField.mockResolvedValueOnce({
      data: {
        ...baseLicense,
        licenseType: 'perpetual',
        endDate: null,
        expirationStatus: 'perpetual',
        daysUntilExpiry: null,
      },
      error: null,
    })
    const onUpdate = vi.fn()

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        onUpdate={onUpdate}
      />
    )

    await user.click(await screen.findByRole('button', { name: /edit license type/i }))
    await user.selectOptions(screen.getByRole('combobox'), 'perpetual')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(patchLicenseField).toHaveBeenCalledWith(1, 'licenseType', 'perpetual')
    })
    expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
      licenseType: 'perpetual',
      endDate: '',
      expirationStatus: 'perpetual',
    }))
  })

  it('edits a legacy request date from the key dates section', async () => {
    const user = userEvent.setup()
    const { patchLicenseField } = await import('../api/licenses.js')
    patchLicenseField.mockResolvedValueOnce({
      data: { ...baseLicense, requestDate: '2025-03-04T00:00:00' },
      error: null,
    })
    const onUpdate = vi.fn()

    render(
      <DetailPanel
        {...baseProps}
        user={{ id: 2, role: 'admin' }}
        onUpdate={onUpdate}
      />
    )

    await user.click(screen.getByText('Key Dates & Contract'))
    await user.click(screen.getByRole('button', { name: /edit request date/i }))
    const input = document.querySelector('input[type="date"]')
    expect(input).not.toBeNull()
    // Set the date atomically — user.type() into <input type="date"> enters
    // segments character-by-character and can leave the controlled value empty.
    fireEvent.change(input, { target: { value: '2025-03-04' } })
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(patchLicenseField).toHaveBeenCalledWith(1, 'requestDate', '2025-03-04')
    })
    expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
      requestDate: '2025-03-04T00:00:00',
    }))
  })

  it('edits repeatable invoice numbers from the key dates section', async () => {
    const user = userEvent.setup()
    const { updateLicense } = await import('../api/licenses.js')
    updateLicense.mockResolvedValueOnce({
      data: {
        ...baseLicense,
        invoiceNumber: 'INV-001',
        invoiceNumbers: ['INV-001', 'INV-002'],
      },
      error: null,
    })
    const onUpdate = vi.fn()

    render(
      <DetailPanel
        {...baseProps}
        license={{ ...baseLicense, invoiceNumbers: ['INV-001'] }}
        user={{ id: 2, role: 'admin' }}
        onUpdate={onUpdate}
      />
    )

    await user.click(screen.getByText('Key Dates & Contract'))
    await user.click(screen.getByRole('button', { name: /add invoice number/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /add invoice number/i }))
    const inputs = within(dialog).getAllByRole('textbox')
    await user.type(inputs[1], 'INV-002')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(updateLicense).toHaveBeenCalledWith(1, {
        invoiceNumbers: ['INV-001', 'INV-002'],
      })
    })
    expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
      invoiceNumber: 'INV-001',
      invoiceNumbers: ['INV-001', 'INV-002'],
    }))
  })
})
