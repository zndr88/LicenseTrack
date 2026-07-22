# Reports and calculations

Reports analyzes the license records visible to the current user. Viewers see
only their assigned departments; Admins and Editors see the records allowed by
their role.

## Filters

The report filter bar can include or exclude retired records, restrict licenses
by start date, and select one or more departments. Filters update the report
sections below the portfolio summary.

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
| Recurring annual cost | Active subscription, SaaS, and maintenance line costs |
| Budget forecast | Recurring annual baseline projected by the selected horizon and growth rate |
| Renewal calendar | Expiring active records across the next four configured fiscal quarters |
| Publisher/vendor overview | Calculated line value grouped by publisher and supplier |

Line value prefers Purchase Quantity multiplied by Unit Price, with stored PO
value used only where the section documents that fallback. Perpetual purchases
can contribute to lifecycle budget but not recurring annual cost.

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
