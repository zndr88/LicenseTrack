import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProcurementTrail } from '../components/licenses/detail/HistorySection.jsx'

const trail = {
  sourcingRequest: {
    id: 42,
    status: 'converted',
    supplier: 'A supplier with a deliberately long name for compact layout coverage',
    createdAt: '2026-05-02T13:45:00Z',
    quoteDocuments: [
      { id: 7, originalFilename: 'quote.pdf', category: 'quote' },
    ],
  },
  sourcingItem: {
    id: 99,
    publisherName: 'A publisher with a deliberately long name',
    softwareDescription: 'A software description with enough detail to require wrapping in a narrow panel',
    estimatedTotalPrice: '500',
    currency: 'EUR',
    renewalForLicenseId: null,
  },
  pendingOrder: {
    id: 77,
    poNumber: 'PO-WITH-A-DELIBERATELY-LONG-REFERENCE-001',
    status: 'converted',
    supplier: 'Reseller One',
    createdAt: '2026-05-04T09:15:00Z',
    documents: [
      { id: 7, originalFilename: 'quote.pdf', category: 'quote' },
      { id: 8, originalFilename: 'invoice.pdf', category: 'invoice' },
    ],
  },
  conversion: {
    sourceMatchType: 'exact',
  },
}

function renderTrail(overrides = {}) {
  const handlers = {
    onNavigateToSourcing: vi.fn(),
    onNavigateToPendingOrder: vi.fn(),
  }

  render(
    <ProcurementTrail
      trail={trail}
      loading={false}
      error={null}
      userSettings={{ numberFormatLocale: 'en-US' }}
      {...handlers}
      {...overrides}
    />
  )

  return handlers
}

describe('ProcurementTrail', () => {
  it('uses neutral trail cards, preserves content and actions, and omits evidence counts', () => {
    const handlers = renderTrail()

    expect(screen.getByText('Sourcing Request')).toBeInTheDocument()
    expect(screen.getByText(/Sourcing Request ID #42/)).toBeInTheDocument()
    expect(screen.getByText('Sourcing Line')).toBeInTheDocument()
    expect(screen.getByText(/Sourcing Line ID #99/)).toBeInTheDocument()
    expect(screen.getByText('Pending Order')).toBeInTheDocument()
    expect(screen.getByText(/PO-WITH-A-DELIBERATELY-LONG-REFERENCE-001/)).toBeInTheDocument()
    expect(screen.getByText(/Pending Order #77/)).toBeInTheDocument()

    const cards = document.querySelectorAll('.dp-neutral-box.dp-trail-row')
    expect(cards).toHaveLength(3)
    expect(document.querySelectorAll('.dp-trail-chips')).toHaveLength(0)
    expect(screen.queryByText('Evidence')).not.toBeInTheDocument()
    expect(screen.queryByText(/Quote x/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Invoice x/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /view sourcing/i }))
    expect(handlers.onNavigateToSourcing).toHaveBeenCalledWith(99)
    fireEvent.click(screen.getByRole('button', { name: /view order/i }))
    expect(handlers.onNavigateToPendingOrder).toHaveBeenCalledWith(77)
  })

  it('preserves the loading state', () => {
    renderTrail({ loading: true })

    expect(screen.getByText('Loading procurement trail...')).toBeInTheDocument()
    expect(screen.queryByText('Sourcing Request')).not.toBeInTheDocument()
  })

  it('preserves the unavailable state', () => {
    renderTrail({ error: new Error('unavailable') })

    expect(screen.getByText('Procurement trail unavailable.')).toBeInTheDocument()
  })

  it('preserves the empty state', () => {
    renderTrail({
      trail: {
        sourcingRequest: null,
        sourcingItem: null,
        pendingOrder: null,
        conversion: { sourceMatchType: 'none' },
      },
    })

    expect(screen.getByText('No linked procurement trail.')).toBeInTheDocument()
  })
})
