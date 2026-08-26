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
The report API applies the same filters and returns the annual-cost baseline used
by the chip, detailed sections, and forecast, so those values remain consistent.

All report sections start collapsed for a cleaner overview and remember their
expanded state for the current browser session. Detailed recurring-cost and
publisher/supplier tables provide compact searches with matching-row counts.

## Money and currencies

LicenseTrack does not perform currency conversion. When records contain several
currencies, monetary totals remain grouped by ISO currency code. Charts that
would imply one converted total are replaced by an explanation while grouped
tables remain available.

Records with blank or invalid prices are excluded from the affected monetary
totals and surfaced as unpriced or excluded counts. Invalid stored values are
never interpreted with locale-specific comma replacement.

## Main calculations

| Section | Calculation |
| --- | --- |
| Spend by license | Purchase Quantity multiplied by Unit Price for each license line |
| Spend by PO value | Procurement events use pending-order ID, procurement-bundle ID, then normalized PO number plus currency; a manual override is used once when present, otherwise calculated lines are summed |
| Difference | PO-value spend minus license-line spend |
| Lifecycle budget | Line value grouped by active, expiring, and expired status |
| Recurring annual cost | Active subscription, SaaS, maintenance, and current paid included-support costs, annualized when the term is longer than one year |
| Budget forecast | Recurring annual baseline projected by the selected horizon and growth rate |
| Renewal calendar | Subscription/SaaS term expiry, separately tracked maintenance expiry, and included-support coverage expiry across the next four configured fiscal quarters |
| Publisher/vendor overview | Calculated line value grouped by publisher and supplier |
| Perpetual licenses & maintenance | Perpetual acquisition value beside included or separately tracked support, grouped by currency |
| Purchase Order Value Tracker | One row per PO and currency, comparing the authoritative PO value with its priced license lines |

The two headline spend totals use Purchase Quantity multiplied by Unit Price as
their line value. Effective Quantity and the legacy stored PO-value import field
do not affect those headline totals. Detailed license-based reports retain the
legacy stored value as a fallback when line pricing is missing; a manual PO
override is never used as a license fallback. Perpetual purchases can contribute
to lifecycle budget but not recurring annual cost.

Licenses without a durable identity are counted individually in both headline spend
totals. Manual PO overrides are included once in Spend by PO Value, but are not
distributed across license lines, publisher/vendor breakdowns, lifecycle
budgets, or forecasts. When a date range is selected, an override is shown as
the full PO value because LicenseTrack has no line-level or time-based allocation
for that amount. If the PO group also contains an undated recurring line in a
selected period, the override is marked unallocated and excluded from that
period's monetary total.

The **Purchase Order Value Tracker** exposes the same reconciliation at row
level. A PO with a manual override uses that override as its PO value; otherwise
it uses the sum of priced lines. The table shows line count, publisher (or
Multiple publishers), PO value, line value, and Difference. Lines without a PO
number remain individually counted and are reported as unkeyed rather than
being silently grouped together.

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

The **Perpetual Licenses & Maintenance** section lists perpetual parent records
with their acquisition value and support classification. Included coverage uses
the parent record's maintenance cost. Separately tracked coverage uses linked
maintenance records and displays those records beneath the parent. Missing
included cost or a missing separate record is flagged in the table, and mixed
currencies remain separate in the summary totals.

Upcoming, retired, renewed, legacy, expired, and pending-renewal records are
excluded from the recurring forecast baseline. Upcoming records remain separate
from Active until their start date arrives.

For a selected period, a recurring record must have bounded coverage dates before
its value can be allocated. Missing or unbounded dates are reported as
**undated/unallocated** with their native-currency value and are excluded from
period totals. All-terms reporting may retain a current baseline for an
unbounded recurring record.

## CSV and PDF export

**Export report CSV** downloads the complete server-generated report model,
including every row in the recurring, publisher/vendor, renewal, maintenance,
portfolio, and purchase-order datasets. It preserves native currencies, emits
canonical decimal and ISO date values, includes row/report type columns, and is
protected against spreadsheet formula injection. It is separate from Registry
CSV export.

**Export filtered report (PDF)** generates a structured, paginated A4 landscape
document from the same detailed report data. It includes filters, generation
date, the no-conversion disclaimer, data-quality counts, native-currency
summaries, and complete tables with repeated headers. It does not depend on the
visible table viewport or chart screenshots.

Both exports are available to authenticated users and API tokens with the
`reports:read` scope. Export is disabled until an invalid custom date range has
been corrected.

For Registry export behavior, see [Dashboard and key views](../navigating/dashboard.md).
