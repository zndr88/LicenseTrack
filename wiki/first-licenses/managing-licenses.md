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

!!! tip
    Use the [procurement workflow](../workflows/procurement.md) for new purchases
    that still need quotes, approvals, a PO, or invoice evidence. Direct creation
    records the entitlement but does not invent a sourcing or pending-order trail.

## Edit and review

The Registry supports inline editing for quick corrections to ordinary fields.
Open the License Details panel for a complete review, document management,
contract links, custom fields, lifecycle actions, and maintenance relationships.

Some fields are calculated or protected:

- LT Ref identifies the renewal chain and is read-only.
- Expiration and completeness are derived from dates, lifecycle state, mandatory
  fields, and required evidence.
- Total PO Value is calculated from license rows that share a PO number.
- Renewal-chain fields change only through renewal or repair workflows.

## Maintenance and support records

Separately purchased maintenance or support is represented by a maintenance
license linked to an eligible parent. Eligible parents are active perpetual,
OEM, or freeware/open-source records.

You can create maintenance from the parent license or select its parent during
pending-order conversion. The active maintenance child supplies the mirrored
maintenance dates and cost shown on the parent.

!!! warning
    A maintenance line is never linked by PO number alone. Select the intended
    parent explicitly so reused PO numbers cannot create the wrong relationship.

Disabling linked maintenance retires the active maintenance relationship and
clears the current mirror from the parent without rewriting historical records.

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

Deletion permanently removes the license and its license-owned documents. It
may be blocked when the record participates in procurement, renewal, maintenance,
or other protected relationships.

!!! danger
    There is no recycle bin. Confirm your database and document-storage backups
    before deleting material records.

Continue with [Renewal and lifecycle](renewal-lifecycle.md) or learn how
[contracts and documents](../workflows/contracts-documents.md) are scoped.
