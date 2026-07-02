import React from 'react'
import { expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import InvoiceConfirmModal from '../components/licenses/InvoiceConfirmModal.jsx'
import ConvertPendingOrderModal from '../components/procurement/ConvertPendingOrderModal.jsx'
import ConvertAllModal from '../components/procurement/ConvertAllModal.jsx'

const userSettings = {
  numberFormatLocale: 'en-US',
  visibleInDetail: {
    supplier: true,
    costCentre: true,
    licenseType: true,
    licenseMetric: true,
    quantity: true,
    skuCode: true,
    unitPrice: true,
    totalPoPrice: true,
    notes: true,
  },
}

test('manual license creation can submit a SaaS portal URL', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn()

  render(
    <InvoiceConfirmModal
      data={{
        publisherName: 'Acme',
        softwareDescription: 'Acme SaaS',
        quantity: '10',
        unitPrice: '5',
        currency: 'EUR',
        fileName: 'manual-entry',
        strategyUsed: 'manual',
      }}
      userSettings={userSettings}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />
  )

  await user.selectOptions(screen.getByLabelText(/License Type/i), 'saas')
  await user.type(screen.getByLabelText(/Portal URL/i), 'https://portal.example.com')
  await user.click(screen.getByRole('button', { name: /Save License/i }))

  // onConfirm is called as (allForms, attachedFile, category); allForms is an
  // array of license rows (multi-line support), so assert against the first row.
  expect(onConfirm.mock.calls[0][0][0]).toEqual(expect.objectContaining({
    licenseType: 'saas',
    portalUrl: 'https://portal.example.com',
  }))
})

test('single pending order conversion can submit a SaaS portal URL', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn().mockResolvedValue(true)

  render(
    <ConvertPendingOrderModal
      order={{ id: 1, poNumber: 'PO-1', items: [] }}
      prefill={{
        publisherName: 'Acme',
        softwareDescription: 'Acme SaaS',
        quantity: '10',
        unitPrice: '5',
        currency: 'EUR',
      }}
      userSettings={userSettings}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />
  )

  await user.selectOptions(screen.getByLabelText(/License Type/i), 'saas')
  await user.type(screen.getByLabelText(/Portal URL/i), 'https://pending.example.com')
  await user.click(screen.getByRole('button', { name: /Confirm & Create License/i }))

  await waitFor(() => {
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      licenseType: 'saas',
      portalUrl: 'https://pending.example.com',
    }), null)
  })
})

test('batch pending order conversion can submit SaaS portal URLs per item', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn().mockResolvedValue(true)

  render(
    <ConvertAllModal
      order={{
        id: 1,
        poNumber: 'PO-1',
        items: [{
          id: 11,
          publisherName: 'Acme',
          softwareDescription: 'Acme SaaS',
          quantity: '10',
          estimatedUnitPrice: '5',
          estimatedTotalPrice: '50',
          currency: 'EUR',
        }],
      }}
      licenses={[]}
      userSettings={userSettings}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />
  )

  fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2026-01-01' } })
  fireEvent.change(screen.getByLabelText(/^End Date/i), { target: { value: '2026-12-31' } })
  await user.selectOptions(screen.getByLabelText(/License Type/i), 'saas')
  await user.type(screen.getByLabelText(/Portal URL/i), 'https://batch.example.com')
  await user.click(screen.getByRole('button', { name: /Confirm & Create Licenses/i }))

  await waitFor(() => {
    expect(onConfirm).toHaveBeenCalledWith(1, [expect.objectContaining({
      sourcingItemId: 11,
      licenseType: 'saas',
      portalUrl: 'https://batch.example.com',
    })])
  })
})
