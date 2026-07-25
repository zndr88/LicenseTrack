import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RenewalWorkflowSection from '../components/licenses/detail/RenewalWorkflowSection.jsx'

const baseLicense = {
  id: 20,
  publisherName: 'Current Publisher',
  softwareDescription: 'Current License',
  quantity: '10',
  endDate: '2027-12-31',
  lifecycleStatus: 'pending_renewal',
  renewedFromId: null,
  renewedToId: null,
  cotermFromIds: null,
  retired: false,
}

function renderSection({
  license = baseLicense,
  exp = { status: 'pending_renewal' },
  allLicenses = [license],
  sourcingItems = [],
  pendingOrders = [],
  canEdit = true,
} = {}) {
  const handlers = {
    onCreateRenewal: vi.fn(),
    onCreateRenewalBundle: vi.fn(),
    onCancelRenewal: vi.fn(),
    onNavigate: vi.fn(),
    onNavigateToSourcing: vi.fn(),
    onNavigateToPendingOrder: vi.fn(),
    setToast: vi.fn(),
  }

  render(
    <RenewalWorkflowSection
      license={license}
      perms={{ canEdit }}
      exp={exp}
      allLicenses={allLicenses}
      sourcingItems={sourcingItems}
      pendingOrders={pendingOrders}
      globalSettings={{ notificationDays: 30 }}
      userSettings={{ dateFormat: 'DD/MM/YYYY' }}
      {...handlers}
    />
  )

  return handlers
}

describe('RenewalWorkflowSection pending ancestry', () => {
  it('shows progress without ancestry for a base license and keeps sourcing and cancellation actions wired', () => {
    const handlers = renderSection({
      sourcingItems: [
        {
          id: 91,
          renewalForLicenseId: baseLicense.id,
          status: 'sourcing',
        },
      ],
    })

    expect(screen.getByText('Renewal in Progress')).toBeInTheDocument()
    expect(screen.queryByText('Renewed From')).not.toBeInTheDocument()
    expect(screen.queryByText('Consolidated Renewal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /view in sourcing overview/i }))
    expect(handlers.onNavigateToSourcing).toHaveBeenCalledWith(91)

    fireEvent.click(screen.getByRole('button', { name: /cancel renewal/i }))
    expect(handlers.onCancelRenewal).toHaveBeenCalledWith(baseLicense.id)
  })

  it('shows progress and normal ancestry together and keeps pending-order navigation wired', () => {
    const predecessor = {
      ...baseLicense,
      id: 11,
      publisherName: 'Previous Publisher',
      softwareDescription: 'Previous License',
      lifecycleStatus: 'renewed',
    }
    const successor = {
      ...baseLicense,
      renewedFromId: predecessor.id,
    }
    const handlers = renderSection({
      license: successor,
      allLicenses: [predecessor, successor],
      sourcingItems: [
        {
          id: 92,
          renewalForLicenseId: successor.id,
          status: 'converted',
        },
      ],
      pendingOrders: [
        {
          id: 77,
          items: [{ id: 92 }],
        },
      ],
    })

    expect(screen.getByText('Renewal in Progress')).toBeInTheDocument()
    const ancestryCard = screen.getByText('Renewed From').closest('.dp-neutral-box')
    expect(ancestryCard).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /view in pending orders/i }))
    expect(handlers.onNavigateToPendingOrder).toHaveBeenCalledWith(77)

    fireEvent.click(within(ancestryCard).getByRole('button', { name: /view previous/i }))
    expect(handlers.onNavigate).toHaveBeenCalledWith(predecessor.id)
  })

  it('shows progress and complete coterm ancestry together with every predecessor navigation', () => {
    const firstPredecessor = {
      ...baseLicense,
      id: 11,
      publisherName: 'First Publisher',
      softwareDescription: 'First License',
      quantity: '4',
      lifecycleStatus: 'renewed',
    }
    const secondPredecessor = {
      ...baseLicense,
      id: 12,
      publisherName: 'Second Publisher',
      softwareDescription: 'Second License',
      quantity: '6',
      lifecycleStatus: 'renewed',
    }
    const successor = {
      ...baseLicense,
      renewedFromId: firstPredecessor.id,
      cotermFromIds: [firstPredecessor.id, secondPredecessor.id],
    }
    const handlers = renderSection({
      license: successor,
      allLicenses: [firstPredecessor, secondPredecessor, successor],
      sourcingItems: [
        {
          id: 93,
          renewalForLicenseId: successor.id,
          status: 'sourcing',
        },
      ],
    })

    expect(screen.getByText('Renewal in Progress')).toBeInTheDocument()
    const ancestryCard = screen.getByText('Consolidated Renewal').closest('.dp-neutral-box')
    expect(ancestryCard).not.toBeNull()
    expect(within(ancestryCard).getByText(/First Publisher/)).toBeInTheDocument()
    expect(within(ancestryCard).getByText(/Second Publisher/)).toBeInTheDocument()

    const predecessorButtons = within(ancestryCard).getAllByRole('button', { name: /view/i })
    fireEvent.click(predecessorButtons[0])
    fireEvent.click(predecessorButtons[1])
    expect(handlers.onNavigate).toHaveBeenNthCalledWith(1, firstPredecessor.id)
    expect(handlers.onNavigate).toHaveBeenNthCalledWith(2, secondPredecessor.id)
  })

  it('keeps ancestry without a progress card when a successor is not pending', () => {
    const successor = {
      ...baseLicense,
      lifecycleStatus: 'active',
      renewedFromId: 11,
    }
    renderSection({
      license: successor,
      exp: { status: 'active' },
      allLicenses: [{ ...baseLicense, id: 11 }, successor],
    })

    expect(screen.queryByText('Renewal in Progress')).not.toBeInTheDocument()
    expect(screen.getByText('Renewed From')).toBeInTheDocument()
  })

  it('keeps incoming and outgoing navigation for a completed intermediate renewal', () => {
    const predecessor = { ...baseLicense, id: 11 }
    const completedIntermediate = {
      ...baseLicense,
      lifecycleStatus: 'renewed',
      renewedFromId: predecessor.id,
      renewedToId: 30,
    }
    const nextSuccessor = { ...baseLicense, id: 30, renewedFromId: completedIntermediate.id }
    const handlers = renderSection({
      license: completedIntermediate,
      exp: { status: 'renewed' },
      allLicenses: [predecessor, completedIntermediate, nextSuccessor],
    })

    expect(screen.queryByText('Renewal in Progress')).not.toBeInTheDocument()
    const renewedCard = screen.getByText('Renewed').closest('.dp-neutral-box')
    const ancestryCard = screen.getByText('Renewed From').closest('.dp-neutral-box')

    fireEvent.click(within(renewedCard).getByRole('button', { name: /view renewal/i }))
    fireEvent.click(within(ancestryCard).getByRole('button', { name: /view previous/i }))
    expect(handlers.onNavigate).toHaveBeenNthCalledWith(1, nextSuccessor.id)
    expect(handlers.onNavigate).toHaveBeenNthCalledWith(2, predecessor.id)
  })
})
