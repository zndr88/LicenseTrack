# Procurement History And Trail Links

This note records the intended behavior for procurement history views and the
license detail procurement trail. The important rule is that navigation follows
stored database relationships, not display text such as PO number.

## User-Facing Flow

Sourcing Overview shows only active quote-stage work by default. The History
button opens a second paginated table below the active table. That history
table contains converted and cancelled sourcing requests, keeps request ids and
line ids visible, remains searchable, and is read-only for record fields. Users
can download or delete quote evidence and inspect line details, but cannot add
lines, edit, merge, convert, or cancel historical sourcing rows.

Pending Orders works the same way. The active table shows pending and
invoice-received orders. The History button opens a second paginated table
below it for converted and cancelled orders. Historical pending orders keep
order ids, line ids, PO documents, invoice evidence, carried-forward quote
context, and conversion references. Users can download or delete PO and quote
evidence through row action menus when permitted. Parent rows link to a created
license when the order maps to one license; multi-line orders expose View
License actions on their expanded line rows.

License Details > History shows the license row creator/timestamps plus a
Procurement Trail when source records exist. The trail links to the source
sourcing item and pending order. If either source record has moved out of the
active table, the destination page enables its History table and highlights the
record there.

## Identity Rules

- Sourcing request ids and sourcing item ids are stable reference ids. Cancelling
  or converting a request does not reassign those ids.
- Pending order ids are stable reference ids. Converting or cancelling an order
  does not reassign the id.
- PO number is commercial metadata. It is not a relationship key and must not be
  used to decide whether records share documents, history, or navigation.
- Procurement reference is optional workflow metadata for internal requests or
  approval numbers. It is not a relationship key.
- License ids identify concrete database rows. License refs identify entitlement
  chains and can repeat across renewal successors.

## Implementation Boundaries

- Sourcing history data is loaded through the sourcing request history query in
  `frontend/src/components/pages/sourcing/useSourcingPageData.js` and rendered by
  `SourcingTable.jsx` in `mode="history"`.
- Pending-order history data is loaded through
  `frontend/src/components/pages/usePendingOrdersData.js` and rendered by
  `pendingOrders/PendingOrdersTable.jsx` in `mode="history"`.
- License procurement trail data is assembled by
  `backend/app/services/license_procurement_trail_service.py` and displayed by
  `frontend/src/components/licenses/detail/HistorySection.jsx`.
- Cross-page navigation is coordinated at app level by highlight ids. Do not
  duplicate lookup logic in the table components.

## Regression Risks

When changing procurement pages, verify these paths:

- license detail history to sourcing history;
- sourcing history to active pending order;
- sourcing history to converted pending-order history;
- pending-order history parent row to a single created license;
- pending-order history line row to a created license in a multi-line order;
- active and historical sourcing quote download/delete actions;
- active and historical pending-order PO and sourcing quote download/delete
  actions.
