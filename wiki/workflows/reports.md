# Reports and calculations

Reports analyzes the license records visible to the current user. Viewers see
only their assigned departments; Admins and Editors see the records allowed by
their role.

## Filters

The report filter bar can include or exclude retired records, restrict licenses
by start date, and select one or more departments. Filters update the report
sections below the portfolio summary.

The department selector is searchable and scrollable so large department lists
remain usable.

Date-only values from license records and report filters are evaluated as local
calendar dates. A license dated `2026-07-01` is treated as July 1 in the user's
calendar, so negative UTC offsets do not move it into the previous quarter.

The Upcoming, Active, Expiring, and Expired counters reflect the filtered rows.
The portfolio-wide annual-cost chip comes from a separate server rollup and is
not narrowed by those local report filters.

## Money and currencies

LicenseTrack does not perform currency conversion. When records contain several
currencies, monetary totals remain grouped by ISO currency code. Charts that
would imply one converted total are replaced by an explanation while grouped
tables remain available.

Malformed legacy amounts and records without usable prices are excluded from
monetary totals and surfaced as excluded or unpriced counts.

## Main calculations

| Section | Calculation |
| --- | --- |
| Historical spend | Total PO values, de-duplicated by nonblank PO number |
| Lifecycle budget | Line value grouped by active, expiring, and expired status |
| Recurring annual cost | Active subscription, SaaS, maintenance, and current paid included-support costs |
| Budget forecast | Recurring annual baseline projected by the selected horizon and growth rate |
| Renewal calendar | Expiring active records across the next four configured fiscal quarters |
| Publisher/vendor overview | Calculated line value grouped by publisher and supplier |

Line value prefers Purchase Quantity multiplied by Unit Price, with stored PO
value used only where the section documents that fallback. Perpetual purchases
can contribute to lifecycle budget but not recurring annual cost.

Freeware/open-source records without paid included support contribute zero to
monetary totals and are not counted as unpriced purchases. When paid support is
included on a freeware, perpetual, or OEM parent, its current coverage-period
total contributes to recurring cost and forecast calculations. LicenseTrack
uses the stored total for that coverage period; it does not prorate or
annualize a multi-year support amount. Expired or not-yet-started included
coverage is excluded. Separately tracked support is represented and reported
through its own maintenance license line.

Upcoming, retired, renewed, legacy, expired, and pending-renewal records are
excluded from the recurring forecast baseline. Upcoming records remain separate
from Active until their start date arrives.

## PDF export

**Export PDF** captures the currently visible report sections into an A4
landscape document using the active theme.

!!! note
    PDF export captures rendered content. Very large scrollable tables may be
    clipped; use CSV exports when a complete row-level dataset is required.

For Registry export behavior, see [Dashboard and key views](../navigating/dashboard.md).
