# Procurement from sourcing to license

LicenseTrack separates purchasing into three stages so quotes, purchase orders,
invoices, and the final entitlements remain traceable.

```text
Sourcing request → Pending order → License record
       quote            PO             invoice and entitlement
```

Admins and Editors can work the pipeline. Viewers do not have access to the
procurement workspaces.

## 1. Sourcing

A sourcing request is the quote-stage parent. It stores supplier and contact
context, notes, quote evidence, and one or more planned license lines. Each line
holds the publisher, description, quantity, estimated pricing, currency, dates,
and renewal context for one intended entitlement.

Use multiple lines when one supplier quote covers several products. Expand the
request row to edit individual lines. Request-level actions manage the quote,
conversion, or cancellation of the whole request.

Renewal sourcing records are created automatically when a renewal begins. When
several renewal lines should end on the same date, coterm merge combines them
while preserving their predecessor relationships.

## 2. Pending orders

Convert sourcing when the purchase is ready for a PO. The sourcing lines become
editable pending-order lines under one PO-level record. You can attach the PO,
adjust lines, or add a forgotten line before final conversion.

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

Conversion captures Request Date from the sourcing line and Purchase Date from
the pending order. Those milestones remain editable for imported or legacy data.

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
evidence links. A converted sourcing line can link forward to its pending order;
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
