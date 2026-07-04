# Renewal & the license lifecycle in action

So far you've imported licenses and learned the record. Now let's walk through what LicenseTrack is really built for: the **renewal lifecycle** — taking an expiring license from an alert all the way to a fresh active record, with sourcing and procurement handled along the way.

For this example I changed the expiration date of our Ableton license so that it falls **28 days from now** — inside the "expiring within 30 days" alert window.

## The renewal workflow appears

Once a license is inside the alert window, the renewal workflow activates. An **Initiate Renewal** button appears in the License Details panel, and the license shows up in the **Renewal Workbench**.

![License Details panel showing the "Expires in 28D" flag and the Initiate Renewal button](../assets/renewal-01-expiring-flag.png)

![The Renewal Workbench listing the expiring Ableton license](../assets/renewal-02-workbench.png)

From either view you can start the renewal, provided all conditions are met.

!!! note "A budget owner is required"
    You can't start a renewal until the license has a **budget owner** assigned (under the Relationships section). The budget owner is who the renewal is routed to.

## Initiate the renewal

Pressing **Initiate Renewal** changes the Ableton license status from **active** to **pending**, signalling that there's an open action on this license.

![Initiating the renewal changes the status to pending](../assets/renewal-03-initiate.png)

At the same time, a new record is created in the **Sourcing Overview** page.

![A new sourcing record created in the Sourcing Overview](../assets/renewal-04-sourcing-record.png)

## Source and quote

The sourcing record is pre-populated with information from the previous license. When you receive a quote from your supplier, update the record with the current figures and attach the quote to the item. Once it's filled in, convert it to a **purchase order**.

![Editing the sourcing record and attaching the quote](../assets/renewal-05-edit-sourcing.png)

When converting, you can attach the item to an **existing PO** or **create a new one**.

![Converting the sourcing item to a purchase order](../assets/renewal-06-convert-to-po.png)

## Pending orders

Once converted, the item clears out of sourcing and enters the **Pending Orders** phase.

![The item now in the Pending Orders phase](../assets/renewal-07-pending-order.png)

Here you can still edit the PO or the line items in case of a last-minute adjustment, and attach the official PO document. For this example we'll convert it as-is into a new active license.

You get a chance to review the purchase and upload the received invoice, if you already have it. **Confirm and Renew** completes the action.

![Reviewing the purchase and uploading the invoice](../assets/renewal-08-review-invoice.png)

## The lifecycle closes

The new record becomes the **active** license. The previous record — which was in the pending state — is marked **renewed**.

Looking the license up in the License Overview, you'll see the historical link back to the previous term via **View Previous**.

![The renewed license with a link back to the previous term](../assets/renewal-09-renewed-link.png)

!!! info "About the LT-Reference number"
    You might notice the LT-Reference number is unchanged. A license keeps a single unique identifier for its whole life — on renewal in future years the **year** in the reference changes, but the identifier number does not. Because this is an example renewal within the same year, both records show the same year.

That completes the license lifecycle renewal — from expiry alert, through sourcing and procurement, to a fresh active license with a full historical trail.

<div class="page-nav" markdown>
[:material-arrow-right: Navigating the tool: dashboard &amp; key views](../navigating/dashboard.md)
</div>
