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

Records without usable line prices are excluded from line-based monetary totals
and surfaced as unpriced counts.

## Main calculations

| Section | Calculation |
| --- | --- |
| Spend by license | Purchase Quantity multiplied by Unit Price for each license line |
| Spend by PO value | Lines grouped by PO number; a manual override is used once when present, otherwise the calculated lines are summed |
| Difference | PO-value spend minus license-line spend |
| Lifecycle budget | Line value grouped by active, expiring, and expired status |
| Recurring annual cost | Active subscription, SaaS, maintenance, and current paid included-support costs, annualized when the term is longer than one year |
| Budget forecast | Recurring annual baseline projected by the selected horizon and growth rate |
| Renewal calendar | Expiring active records across the next four configured fiscal quarters |
| Publisher/vendor overview | Calculated line value grouped by publisher and supplier |

The two headline spend totals use Purchase Quantity multiplied by Unit Price as
their line value. Effective Quantity and the legacy stored PO-value import field
do not affect those headline totals. Detailed license-based reports retain the
legacy stored value as a fallback when line pricing is missing; a manual PO
override is never used as a license fallback. Perpetual purchases can contribute
to lifecycle budget but not recurring annual cost.

Licenses without a PO number are counted individually in both headline spend
totals. Manual PO overrides are included once in Spend by PO Value, but are not
distributed across license lines, publisher/vendor breakdowns, lifecycle
budgets, or forecasts. When a date range is selected, an override is shown as
the full PO value because LicenseTrack has no line-level or time-based allocation
for that amount.

Freeware/open-source records without paid included support contribute zero to
monetary totals and are not counted as unpriced purchases. When paid support is
included on a freeware, perpetual, or OEM parent, its current coverage-period
total contributes to recurring cost and forecast calculations.

Recurring subscription, SaaS, maintenance, and included-support values use the
stored value for the complete term or coverage period. When that term is longer
than one year, the forecast baseline annualizes it by calendar days. When a
report range is selected, recurring value is allocated by overlapping days. For
example, an 18-month record worth EUR 12,000 contributes roughly the first 12
months of value to a first-year range and the remaining 6 months of value to
the following year. Expired or not-yet-started included coverage is excluded.
Separately tracked support is represented and reported through its own
maintenance license line.

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
