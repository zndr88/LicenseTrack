# Renewal & the license lifecycle in action

So far you've imported licenses and learned the record. Now let's walk through what LicenseTrack is really built for: the **renewal lifecycle** — taking an expiring license from an alert all the way to a fresh active record, with sourcing and procurement handled along the way.

For this example I changed the expiration date of our Ableton license so that it falls **28 days from now** — inside the "expiring within 30 days" alert window.

## The renewal workflow appears

Once a license is inside the alert window, the renewal workflow activates. An **Initiate Renewal** button appears in the License Details panel, and the license shows up in the **Renewal Workbench**.

![License Details panel showing the "Expires in 28D" flag and the Initiate Renewal button](../assets/renewal-01-expiring-flag.png)

![The Renewal Workbench listing the expiring Ableton license](../assets/renewal-02-workbench.png)

From either view you can start the renewal, provided all conditions are met.

If the next entitlement period was already purchased and exists as an Active
or Upcoming license under the same PO, choose **Link Existing Successor**
instead. This secures the renewal and adopts the selected record as its normal
successor without creating another sourcing request or pending order. The
current record remains Active or Expiring through its own end date, while the
renewal actions and workbench alert disappear immediately. The selected record
inherits the renewal-chain LT reference; its former reference remains reserved
and searchable in history. Date gaps and overlaps are shown for confirmation
before linking. If there is a gap, the predecessor remains Expired until the
successor starts; it is shown as Renewed only after successor coverage begins.

The workbench's estimated annual value annualizes multi-year term cost, so a
two- or three-year purchase is not presented as though the complete term value
were one year's spend.

!!! note "A budget owner is required"
    You can't start a renewal until the license has a **budget owner** assigned (under the Relationships section). The budget owner is who the renewal is routed to.

## Initiate the renewal

Pressing **Initiate Renewal** changes the Ableton license status from **active** to **pending**, signalling that there's an open action on this license.

![Initiating the renewal changes the status to pending](../assets/renewal-03-initiate.png)

At the same time, a new record is created in the **Sourcing Overview** page.

![A new sourcing record created in the Sourcing Overview](../assets/renewal-04-sourcing-record.png)

## Source and quote

The sourcing record is pre-populated with information from the previous
license. When you receive a quote from your supplier, update the record with
the current figures and attach the quote to the request. Once procurement work
is ready to track, convert it to a **pending order**. The predecessor's explicit
maintenance/support classification travels with the renewal; older recurring
records without a stored classification use the type-appropriate default so
coverage is not lost during sourcing, coterm merging, or final conversion.
Admins can also choose, per custom-field definition, whether its value is
copied into a renewal. Copied values are a snapshot taken when renewal starts;
fields configured to start blank can be completed for the new term during
sourcing or pending-order review.

![Editing the sourcing record and attaching the quote](../assets/renewal-05-edit-sourcing.png)

When converting, you can attach the item to an **existing pending order** or
**create a new one**. If the formal PO number is not available yet, use a
procurement reference or the generated Pending Order ID while the PO is being
created. You must add the real PO number before converting the pending order
into active licenses.

![Converting the sourcing item to a pending order](../assets/renewal-06-convert-to-po.png)

After conversion, the sourcing request leaves the active Sourcing Overview table and remains available through the **History** button. Sourcing history opens as a second read-only table below active sourcing work. It keeps the old request id, line id, quote evidence, supplier, pricing, and notes, and it can link forward to the related pending order.

## Pending orders

Once converted, the item clears out of sourcing and enters the **Pending Orders** phase.

![The item now in the Pending Orders phase](../assets/renewal-07-pending-order.png)

Here you can still edit the order or the line items in case of a last-minute
adjustment, add the real PO number if it was not known earlier, and attach the
official PO document when available. For this example we'll convert it as-is
into a new active license.

You get a chance to review the purchase and upload the received invoice, if you
already have it. **Confirm & Renew License** completes the action.

![Reviewing the purchase and uploading the invoice](../assets/renewal-08-review-invoice.png)

After conversion to licenses, the pending order leaves the active Pending
Orders table and remains available through the **History** button.
Pending-order history is also read-only for record fields. It keeps the PO id,
line ids, PO document, carried-forward quote context, invoice evidence, and
links to the license records created from each line; permitted users can still
download or remove evidence from the row action menu.

## The lifecycle closes

The successor becomes **active** on its own start date. The previous record
continues to show its date-based coverage state through its end date and is
shown as **renewed** once its term has ended and successor coverage has begun.

Looking the license up in the License Overview, you'll see the historical link back to the previous term via **View Previous**.

Legacy-unlinked maintenance follows the same renewal chain. If it is still
parentless when the pending order is converted, the successor remains active
maintenance with no parent and retains the legacy-unlinked marker; LicenseTrack
does not invent a parent link, mirror, or coverage relationship. The current
predecessor is reread during conversion, so linking it while renewal sourcing
is in progress makes the successor an ordinary linked maintenance record.

![The renewed license with a link back to the previous term](../assets/renewal-09-renewed-link.png)

The renewed license's **History** section also shows the procurement trail when the renewal passed through LicenseTrack sourcing and pending orders. From there you can jump back to the historical sourcing item, then through to the historical PO, and finally back to the created license. This is useful when an old renewal is restarted months later and you need the previous quote, notes, or PO evidence for reference.

An existing-purchase renewal has no new sourcing or pending-order stages to
show. Its procurement trail records the predecessor and successor record IDs,
PO number, former successor reference, actor, and link time, while preserving
the successor's original purchase trail.

!!! info "About the LT-Reference number"
    You might notice the LT-Reference number is unchanged. A license keeps a single unique identifier for its whole life — on renewal in future years the **year** in the reference changes, but the identifier number does not. Because this is an example renewal within the same year, both records show the same year.

That completes the license lifecycle renewal — from expiry alert, through sourcing and procurement, to a fresh active license with a full historical trail.

<div class="page-nav" markdown>
[:material-arrow-right: Navigating the tool: dashboard &amp; key views](../navigating/dashboard.md)
</div>
