# Procurement from sourcing to license

LicenseTrack keeps requests traceable while allowing the route to match what is
actually being acquired.

```text
Sourcing request -- paid purchase --> Pending order --> License record
        |
        +-- zero-cost freeware/open source ----------> License record
```

Admins and Editors can work the pipeline. Viewers do not have access to the
procurement workspaces.

## 1. Sourcing

A sourcing request is the quote-stage parent. It stores supplier and contact
context, notes, quote evidence, and one or more planned license lines. Each line
holds the publisher, description, optional license type, quantity, estimated
pricing, currency, dates, and renewal context for one intended entitlement.

Use multiple lines when one supplier quote covers several products. Expand the
request row to edit individual lines. Request-level actions manage the quote,
conversion, or cancellation of the whole request.

The request supplier is the proposed target for the complete purchase, not a
copy of historical supplier ownership. It can remain unassigned while sourcing
is unresolved and is human-editable across renewals, but paid lines cannot move
to a pending order until one supplier is selected. Changing it updates the
compatible open lines; converted and cancelled history is left unchanged.

Renewal sourcing records are created automatically when a renewal begins. When
several renewal lines should end on the same date, coterm merge combines them
while preserving their predecessor relationships. If the historical supplier
suggestions differ, the new request remains unassigned until procurement chooses
one target supplier.

For freeware or open-source requests, set the line's optional **License Type**
to **Freeware / Open Source**. Converting that line creates an active Registry
license directly. It preserves the sourcing relationship and Request Date but
does not create a pending order, Purchase Date, PO, invoice, contract, or
purchase price. In a mixed request, one conversion action sends the free lines
to the Registry and the paid lines to the pending order.

Freeware/open-source lines do not show license acquisition-price fields because
their acquisition cost is zero. Perpetual and OEM lines retain their acquisition
pricing independently of support.

Perpetual, OEM, and freeware/open-source lines also expose
**Maintenance / Support**:

- **Included** keeps support on the parent line and records the coverage dates.
  Support can be entered as a flat coverage fee or as covered quantity times
  support unit price. The calculated coverage-period total contributes to the
  sourcing estimate and pending-order total exactly once.
- **Separately tracked** offers an explicit **Add maintenance line** action. The
  new line is prefilled but editable, follows the paid PO path, and retains its
  parent relationship during conversion. A different support supplier creates
  a separate linked sourcing request.
- **Unknown** and **Not applicable** do not create another line.

Freeware with a positive included-support cost follows the PO path because the
support purchase needs normal procurement evidence.

Support prices always describe the displayed coverage period. LicenseTrack
does not convert a multi-year coverage total into an annualized figure. When
coverage is renewed, the new coverage becomes a new procurement/license line
instead of overwriting the expired period.

Dates entered during sourcing and pending-order work are planning values. The
license manager confirms the delivered entitlement and support start/end dates
during final conversion because publisher dates can change between quote,
order, and delivery.

## 2. Pending orders

Convert sourcing when the purchase is ready for a PO. The sourcing lines become
editable pending-order lines under one PO-level record. You can attach the PO,
adjust lines, or add a forgotten line before final conversion.

One pending order has one supplier. An unassigned sourcing request adopts the
supplier of an existing PO; a conflicting request is rejected instead of being
combined with that PO.

Quote evidence remains connected to its sourcing origin and is visible from the
pending order. The PO number is commercial metadata; the pending-order database
relationship—not matching PO text—connects evidence and history.

## 3. Convert to licenses

When fulfillment is complete, convert the pending order. A single-line order can
use the focused conversion form; a multi-line order can convert all lines in one
review. Each line becomes a separate license.

During conversion you can:

- review dates, ownership, pricing, and license type;
- upload the invoice;
- copy shared PO-level fields across batch lines;
- select explicit parents for maintenance lines; and
- confirm renewal successors and coterm relationships.

Conversion captures Request Date from the sourcing line. The license manager
confirms the actual Purchase Date during conversion; it is not inferred from
the pending-order creation timestamp. Those milestones remain editable for
imported or legacy data.

The pending-order supplier is the final procurement supplier used by each
resulting license. Earlier license suppliers remain historical context and are
not overwritten or enforced on the renewal.

## Evidence ownership

Evidence is scoped to the workflow record that owns it:

| Evidence | Initial scope | After license conversion |
| --- | --- | --- |
| Quote | Sourcing request | Copied into the pending-order procurement bundle |
| Purchase order | Pending order | Shared by licenses created from that order |
| Invoice uploaded during conversion | Pending order | Shared by licenses created from that order |
| EULA or entitlement | License | Remains attached to that license |

Two unrelated pending orders do not share documents merely because their PO
numbers match.

## History and recovery

Converted and cancelled sourcing requests and pending orders move to searchable,
read-only history tables. History rows retain identifiers, notes, prices, and
evidence links. A converted sourcing line can link forward to its pending order
or directly created freeware license;
a converted pending-order line can link to its resulting license.

The License Details **History** section exposes the same procurement trail in
reverse, letting you navigate from an entitlement back to its quote and PO work.

If evidence transfer fails after license creation, the licenses remain committed
and the order records a recoverable transfer status. LicenseTrack retries the
transfer, and Admins or Editors can request another retry without reconverting
the order.

!!! warning
    Converted records are locked. Add late evidence as a documented amendment;
    do not try to reopen or recreate the original conversion.
