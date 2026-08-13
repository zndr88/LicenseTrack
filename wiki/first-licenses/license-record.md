# Understanding the license record

Clicking a license in the overview opens the **License Details** panel:

![A license row selected in the overview](../assets/record-01-overview-row.png)

The License Details panel holds all the data of your license record.

![The License Details panel, Identity section](../assets/record-02-identity.png)

The **Identity** section is the main view, always visible at the top. It holds key information such as the publisher identity, the license description, and the unique LicenseTrack identifier number.

It also shows three flags: **days remaining until expiration**, a **completeness score** (more on that below), and the **license type**.

The record is organized into the following sections:

- Key Dates & Contract
- Details
- Maintenance & Support
- Relationships
- Documents
- Completeness & Flags
- Notes
- Custom Fields
- History

Let's walk through each one.

## Key Dates & Contract

![Key Dates & Contract section](../assets/record-03-key-dates-contract.png)

Here you'll find the important dates for your license purchase. The **start**
and **end** dates represent the license lifecycle. **Request date** is filled
when a license originates from sourcing, including direct freeware conversion.
**Purchase date** is filled only when a pending order exists. Together they give
you a clear reading of the path the entitlement followed.

**Notice date** is an optional manually entered contractual notice deadline,
for example the last date to cancel or change renewal terms. It is independent
from the license end date and is not calculated automatically. LicenseTrack
warns if the notice date is after the end date, but it does not block saving.
When the deadline has been reviewed, editors and admins can mark the notice as
handled. That stops further notice-deadline reminders for the current notice
date; changing the notice date clears the handled state.

Your **PO number**, **invoice number**, and — if required — **contract number** are shown in this section. You can also link the license to a dedicated contract from here. More on that later.

A license can have more than one invoice number. Click the invoice number or the add control to manage the invoice-number list. The first invoice number is the primary invoice shown in the overview table and exports.

## Details

![Details section](../assets/record-04-details.png)

Here you'll find more detail about the license record: the **license type**, **metric**, **quantity**, **SKU code**, and **pricing**.

Use **Service** for implementation, installation, or service costs associated
with a license purchase. Use **Other** for rare purchase types that should stay
visible in the registry while you decide how to classify them. Service and
Other records are not treated as renewable entitlement lines.

The **calculated total** is quantity × unit price, computed automatically. The
**total PO price** is the acquisition value of the whole purchase order, which
may span multiple lines in a single PO. Freeware/open-source records have no
acquisition price; paid support is recorded in **Maintenance & Support**.

## Maintenance & Support

Perpetual, OEM, and freeware/open-source records classify support as
**Unknown**, **Not applicable**, **Included**, or **Separately tracked**.

Included support stays on the parent license. Its start/end dates define the
coverage period, and its price is either one flat fee or a covered quantity
multiplied by a support unit price. The resulting support cost is the total for
that coverage period, not an automatically annualized amount.

Separately tracked support uses its own linked maintenance license, procurement
evidence, cost, dates, and renewal lifecycle. The parent shows the active
maintenance line's current dates and cost for convenient review.

## Relationships

![Relationships section](../assets/record-05-relationships.png)

Here you'll find the **supplier** (where you purchased the license), the internal **cost center or department** the license is for, your **contact** at the publisher, the internal **budget or department owner**, and optional **secondary contacts**.

The budget owner receives automated renewal notifications, if enabled.
Secondary contacts are copied on those budget-owner renewal emails.

## Documents

![Documents section](../assets/record-06-documents.png)

In this section you can upload any document related to the purchase cycle of a software license — quick, easy access to the quote, PO, invoice, entitlements, and EULA files.

Quote, Purchase Order, and Invoice files can be procurement evidence shared by
licenses created from the same pending order or the same direct multi-license
batch. Sharing follows that internal relationship, never matching PO-number
text. License-specific evidence such as an EULA or entitlement certificate
remains attached to one license.

PDF documents can be previewed from the document row. The preview opens beside
the details panel so you can keep reviewing or editing the license while
checking the document. Download remains available for every file the user is
allowed to access.

The configured upload maximum applies to the file payload. A file exactly at
that limit is accepted; a file one byte over it is rejected. LicenseTrack also
keeps a separate bounded allowance for multipart request metadata.

!!! note
    Keep more detailed contract data out of this section. Upload contract files to the dedicated **Contracts** page instead.

## Completeness & Flags

![Completeness & Flags section](../assets/record-07-completeness-flags.png)

Each purchase has a **completeness score**. The completeness requirements are defined by the admin under settings. In this example, the invoice, proof of entitlement, start and end date, contract number, and PO number are all required for a license to count as **complete**. Admins can also include notice date when contractual notice tracking is part of their housekeeping goals.

For a freeware/open-source record, EULA, proof-of-entitlement, and
publisher-contact requirements do not apply. Contract, PO, invoice, and quote
requirements also do not apply unless the record includes paid support.
Department and budget-owner requirements remain useful and continue to apply
when enabled.

Licenses that are not marked complete generate email notifications, and you'll see alerts in the top-right menu.

You can also mark a license as **retired** or **legacy**, or **exempt** it from completeness entirely to suppress the alerts.

The **Renewal notifications** toggle controls expiry emails for this specific license. It is enabled by default. Turn it off when a license is still active but should not send renewal emails, for example because renewal discussions have already started.

## Notes, Custom Fields & History

![Notes, Custom Fields and History sections](../assets/record-08-notes-custom-history.png)

- **Notes** — add custom messages to the license for follow-up.
- **Custom Fields** — hold values that have no natural place in the other sections. You define a custom field and its section under the admin menu.
- **History** — the unique **License Record ID**, creator, creation and update
  timestamps, an audit trail of changes to the record, and links back to the
  sourcing request and, when one exists, the pending order that created the
  license. The License Record ID identifies this exact database row; it differs
  from the LT Ref retained across a renewal chain.

When a procurement trail exists, the History section can take you back to the original quote-stage sourcing line and the related pending order. Converted or cancelled procurement records open in their history tables, so you can inspect old quote, PO, invoice, price, and note context without reopening the workflow.

Registry CSV exports use **License Record ID** for this unique row identifier.
Use it when an integration or investigation must distinguish individual rows in
a renewal chain that share the same LT Ref.

## Email & delete

![Email Publisher and Delete buttons](../assets/record-09-email-delete-buttons.png)

At the bottom of the panel are the **Email Publisher** and **Delete** buttons.

!!! danger "Delete is permanent"
    Delete removes the license and its license-owned files after the database
    deletion succeeds. Shared procurement evidence remains while another
    license is still linked to its order or manual creation batch. There is no
    recovering deleted data unless you have backed up both the database and
    document storage.

The **Email Publisher** button opens your default email program and pre-fills the message with the important license data:

![Pre-filled email to the publisher](../assets/record-10-email-prefill.png)

You can achieve the same result by clicking the publisher's email address under the **Relationships** section.

<div class="page-nav" markdown>
[:material-arrow-right: Renewal &amp; the license lifecycle in action](renewal-lifecycle.md)
</div>
