# Managing licenses and maintenance

License records can enter LicenseTrack through CSV import, procurement
conversion, an API integration, or direct creation in the License Overview.
Whichever route creates the record, the same validation, completeness, access,
and lifecycle rules apply.

## Create a license directly

Use **Add License** when the purchase does not need to pass through the sourcing
and pending-order workflow—for example a legacy entitlement, a freeware record,
or a purchase already completed outside LicenseTrack.

Record the publisher and software description first, then add the commercial,
ownership, date, and evidence fields available to you. LicenseTrack assigns the
LT reference automatically. It cannot be supplied or edited manually.

The **Review License Data** step can create several license lines together.
Use **Add License** inside that review to add another entitlement. Each eligible
line has the same included support choice, and each eligible perpetual, OEM, or
freeware/open-source line also has the separately tracked maintenance choice.
Price fields use your personal number format. LicenseTrack saves all lines as one database operation:
if any line fails, no part of the batch is created.

An optional Quote, Purchase Order, or Invoice selected for a multi-license batch
is shared across the licenses created in that batch. Other document categories
attach only to the first license. The document upload happens after the license
batch is committed; if it fails, open the first created license and retry the
attachment from **Documents** instead of submitting the licenses again.

For freeware and open-source software, choose **Freeware / Open Source** in the
ordinary **License Type** field. There is no separate acquisition mode. A
directly created record can leave commercial references and prices empty.
EULA, proof-of-entitlement, and publisher-contact completeness checks are not
applicable to this type. Contract, PO, invoice, and quote checks are also not
applicable while the record has no paid included support. Department and budget
owner requirements still apply so the record retains useful organizational
ownership.

!!! tip
    Use the [procurement workflow](../workflows/procurement.md) when a request
    should remain traceable even though the resulting entitlement is free.
    Freeware sourcing lines convert directly to the Registry without creating a
    pending order.

## Edit and review

The Registry supports inline editing for quick corrections to ordinary fields.
Open the License Details panel for a complete review, document management,
contract links, custom fields, lifecycle actions, and maintenance relationships.

Some fields are calculated or protected:

- LT Ref identifies the renewal chain and is read-only.
- Expiration and completeness are derived from dates, lifecycle state, mandatory
  fields, and required evidence.
- Total PO Value is calculated from license rows that share a PO number unless
  an Editor or Admin sets a shared manual override from License Details. Set,
  edit, or clear that override from any license in the PO; the same value is
  shown on every member.
- Renewal-chain fields change only through renewal or repair workflows.

## Maintenance and support records

Separately purchased maintenance or support is represented by a maintenance
license linked to an eligible parent. Eligible parents are active perpetual,
OEM, or freeware/open-source records.

Choose **Included** when support belongs on the parent record. For perpetual,
OEM, and freeware/open-source parents, its start/end dates define the coverage
period and its price can be a flat coverage fee or a covered quantity
multiplied by a support unit price. For subscription and SaaS records, included
support follows the subscription dates and total acquisition value, so the
coverage dates and support cost are derived automatically.

Choose **Separately tracked** to add a real maintenance line with its own
procurement evidence and renewal lifecycle. You can create that line while
sourcing, while editing a pending-order line, during direct license entry, or
later from the parent license. From the parent license's **Maintenance &
Support** section, choose whether to create a new maintenance record or link an
existing maintenance record from the searchable list. The active maintenance
record supplies the mirrored maintenance dates and cost shown on the parent.

One maintenance record can be linked to more than one eligible parent. This is
useful when a later renewal covers several perpetual purchases under one
support contract. Each parent keeps its own active-maintenance pointer, while
the maintenance record keeps the parent list for review and history.

When either kind of coverage is renewed, create a new line for the new coverage
period. This preserves the cost and dates of the expired period instead of
rewriting them.

!!! warning
    A maintenance line is never linked by PO number alone. Select the intended
    parent explicitly so reused PO numbers cannot create the wrong relationship.

Disabling linked maintenance clears the current mirror from that parent. If the
maintenance record is still linked to another parent, it remains active there.
If no parent links remain, the maintenance record is retired to preserve the
old single-parent behavior.

## Retired, legacy, and exempt records

- **Retired** removes a record from active operational totals while preserving
  its history.
- **Legacy** marks historical data that should remain visible without taking
  part in ordinary lifecycle processing.
- **Completeness exempt** keeps the record active but removes it from mandatory
  field and evidence alerts.

Use these flags deliberately: they affect filtering, notifications, reports,
and completeness calculations.

## Delete a license

Deletion permanently removes the license, its license-owned document rows, and
the corresponding managed files after the database deletion commits. Shared
procurement evidence remains available while another license in its order or
manual creation batch still owns that scope. It may be blocked when the record
participates in procurement, renewal, maintenance, or other protected
relationships.

!!! danger
    There is no recycle bin. Confirm your database and document-storage backups
    before deleting material records.

Continue with [Renewal and lifecycle](renewal-lifecycle.md) or learn how
[contracts and documents](../workflows/contracts-documents.md) are scoped.
