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

Active sourcing rows start expanded so same-supplier requests can be scanned
without opening each parent first. Collapse rows individually when you need a
shorter overview.

Use **Edit Sourcing Request** to update the supplier, contact, request notes,
and every open line in one save. Publisher, description, type, quantity,
estimated prices, currency, dates, and line notes are validated together;
converted and cancelled lines stay read-only. The save is atomic, so a rejected
line does not leave the rest of the request partially updated.

When creating a sourcing request with a quote attachment, the form can preview
PDF, image, and text files before save. Expand the preview for detailed review
or return to the split view while entering line data. Unsupported file types
remain attachable but show that an inline preview is unavailable.

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

Perpetual, OEM, freeware/open-source, subscription, and SaaS lines also expose
**Maintenance / Support**:

- **Included** keeps support on the parent line. For perpetual, OEM, and
  freeware/open-source lines, support can be entered as a flat coverage fee or
  as covered quantity times support unit price. For subscription and SaaS
  lines, included support uses the subscription start/end dates and the
  subscription acquisition total, so the derived coverage dates and cost are
  hidden in the forms. The calculated or derived total contributes to the
  sourcing estimate and pending-order total exactly once.
- **Separately tracked** offers an explicit **Add maintenance line** action. The
  new line is prefilled but editable, follows the paid PO path, and retains its
  parent relationship during conversion. This option is available only for
  perpetual, OEM, or freeware/open-source parents. A different support supplier
  creates a separate linked sourcing request. If a later renewal covers several
  eligible parent purchases, the resulting maintenance license can be linked to
  the additional parents from License Details.
- **Unknown** and **Not applicable** do not create another line.

Freeware with a positive included-support cost follows the PO path because the
support purchase needs normal procurement evidence.

Support prices always describe the displayed coverage period. When coverage is
renewed, the new coverage becomes a new procurement/license line instead of
overwriting the expired period. Reports annualize recurring multi-year records
and allocate selected report ranges by overlapping days.

Dates entered during sourcing and pending-order work are planning values. The
license manager confirms the delivered entitlement and support start/end dates
during final conversion because publisher dates can change between quote,
order, and delivery.

## 2. Pending orders

Convert sourcing when the purchase is ready for procurement tracking. The
sourcing lines become editable pending-order lines under one order-level
record. The order can start with a real PO number, a procurement reference such
as an internal request or approval number, or only the generated Pending Order
ID while the formal PO is still being created.

You can add the PO number later, attach the PO document when it is available,
adjust lines, or add a forgotten line before final conversion. LicenseTrack
will not convert a pending order into active licenses until a real PO number is
recorded.

One pending order has one supplier. An unassigned sourcing request adopts the
supplier of an existing pending order; a conflicting request is rejected instead
of being combined with that order.

Supplier agreement is based on the canonical organization ID, not spelling in a
legacy mirror. A name, alias, case variant, or whitespace variant that resolves
to the same organization is compatible, and request, open-item, pending-order,
and converted-license mirrors are written with that organization's canonical
name. Different organizations remain a conflict.

Quote evidence remains connected to its sourcing origin and is visible from the
pending order action menu. The PO number and procurement reference are
metadata; the pending-order database relationship - not matching PO text -
connects evidence and history.

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
| Quote, PO, or invoice uploaded during direct multi-license entry | Manual creation batch | Shared by licenses created in that batch |
| EULA or entitlement | License | Remains attached to that license |

Two unrelated pending orders or direct-creation batches do not share documents
merely because their PO numbers match. The pending-order relationship or manual
batch identifier is the sharing key.

Active and historical sourcing and pending-order rows expose evidence actions
from the row action menu. Filenames are shown directly in the Download and
Delete actions so multiple quotes or PO files remain distinguishable.

## History and recovery

Converted and cancelled sourcing requests and pending orders move to searchable,
paginated history tables. History rows are read-only for record fields, but
evidence can still be downloaded or removed when the user has permission.
History rows retain identifiers, notes, prices, and evidence links. A converted
sourcing line can link forward to its pending order or directly created
freeware license; a converted pending-order line can link to its resulting
license.

CSV exports name these internal row identifiers explicitly: **Sourcing Request
ID**, **Sourcing Line ID**, **Pending Order ID**, and **Pending Order Line ID**.
They are distinct from commercial PO numbers and display-only line ordering. A
sourcing line carried into a pending order retains the same line row, so its
Sourcing Line ID and Pending Order Line ID intentionally have the same numeric
value.

The License Details **History** section exposes the same procurement trail in
reverse, letting you navigate from an entitlement back to its quote and PO work.

If evidence transfer fails after license creation, the licenses remain committed
and the order records a recoverable transfer status. LicenseTrack retries the
transfer, and Admins or Editors can request another retry without reconverting
the order. Quote and invoice transfer phases are committed independently, so a
later status failure does not remove evidence that was already stored. When an
invoice was supplied during conversion, retry cannot mark the transfer complete
unless the required invoice evidence still exists in document storage.

For a multi-line pending order, conversion must include every eligible line
exactly once. Missing, duplicate, already converted, or ineligible line IDs are
rejected before LicenseTrack locks the order or creates any licenses.

!!! warning
    Converted records are locked. Add late evidence as a documented amendment;
    do not try to reopen or recreate the original conversion.
