# Renewal rules and alternatives

For your first renewal, follow the [sourcing-to-renewal walkthrough](renewal-lifecycle.md).
This page explains existing purchases, overlapping coverage states, and less common cases.

## Link an existing successor

If the next entitlement period was already purchased and exists as an Active
or Upcoming license from the same publisher, choose **Link Existing Successor**
instead. This secures the renewal and adopts the selected record as its normal
successor without creating another sourcing request or pending order. The
current record remains Active or Expiring through its own end date, while the
renewal actions and workbench alert disappear immediately. The selected record
inherits the renewal-chain LT reference; its former reference remains reserved
and searchable in history. Date gaps and overlaps are shown for confirmation
before linking. If there is a gap, the predecessor remains Expired until the
successor starts; it is shown as Renewed only after successor coverage begins.
While the linked successor is Upcoming, the expiring predecessor shows **Renews in
X days** (or **Renews today**) from the successor's start date. A coverage gap remains
visible, and pending procurement by itself does not show this countdown.

Publisher is the required matching identity: comparison ignores case and surrounding
whitespace. The PO number and description may differ. Both licenses must be
eligible renewable types; the successor must extend coverage and have no incoming
renewal link. Linking uses the same renewal-action window as initiation, but does
not require a budget owner. Open procurement work and existing renewal links must
be resolved first.

An existing-purchase renewal has no new sourcing or pending-order stages to
show. Its procurement trail records the predecessor and successor record IDs,
PO number, former successor reference, actor, and link time, while preserving
the successor's original purchase trail.

## Renewal work and coverage dates

Pending Renewal describes the procurement workflow; it does not replace the
current term's date status. In License Overview, a pending row keeps its purple
shade and Pending Renewal badge while an orange or red edge and a second badge
show whether the term is Expiring or Expired. The row appears under Pending and
also under its applicable Expiring or Expired filter.

## Renewal-action window and annual value

Administrators can configure the renewal-action window independently from the
expiry-alert window. Until configured, it inherits the expiry-alert value.
Changing the action window does not change when a term is Expiring or Expired.

The workbench's estimated annual value annualizes multi-year term cost, so a
two- or three-year purchase is not presented as though the complete term value
were one year's spend.

## Information carried into the next term

Admins can also choose, per custom-field definition, whether its value is
copied into a renewal. Copied values are a snapshot taken when renewal starts;
fields configured to start blank can be completed for the new term during
sourcing or pending-order review.

The predecessor's explicit maintenance/support classification travels with the
renewal. Older recurring records without a stored classification use the
type-appropriate default, including through coterm merging and final conversion.

## Legacy-unlinked maintenance

Legacy-unlinked maintenance follows the same renewal chain. If it is still
parentless when the pending order is converted, the successor remains active
maintenance with no parent and retains the legacy-unlinked marker; LicenseTrack
does not invent a parent link, mirror, or coverage relationship. The current
predecessor is reread during conversion, so linking it while renewal sourcing
is in progress makes the successor an ordinary linked maintenance record.

## Coterm renewals

Coterm work combines eligible renewal lines into a shared successor term. Review
the selected predecessors, quantity, dates, and commercial terms together before
merging. Follow the [procurement guide](../workflows/procurement.md) for the
sourcing merge workflow and its eligibility rules.

## Purchase history and LT references

After conversion, the sourcing request leaves the active Sourcing Overview table and remains available through the **History** button. Sourcing history opens as a second read-only table below active sourcing work. It keeps the old request id, line id, quote evidence, supplier, pricing, and notes, and it can link forward to the related pending order.

After conversion to licenses, the pending order leaves the active Pending
Orders table and remains available through the **History** button.
Pending-order history is also read-only for record fields. It keeps the PO id,
line ids, PO document, carried-forward quote context, invoice evidence, and
links to the license records created from each line; permitted users can still
download or remove evidence from the row action menu.

The renewed license's **History** section also shows the procurement trail when the renewal passed through LicenseTrack sourcing and pending orders. From there you can jump back to the historical sourcing item, then through to the historical PO, and finally back to the created license. This is useful when an old renewal is restarted months later and you need the previous quote, notes, or PO evidence for reference.

!!! info "About the LT-Reference number"
    A renewal successor inherits the predecessor's complete LT reference,
    including its year. The reference identifies the entitlement chain, so
    several terms can share it. Use the immutable License Record ID to identify
    one exact record, and its dates and history to distinguish terms.
