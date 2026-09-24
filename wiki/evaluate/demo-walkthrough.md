# Explore the demo

Use these three examples to see how LicenseTrack connects records, purchasing,
and renewals. You can follow them in order or choose one.

[Open the demo](https://zndr88.github.io/LicenseTrack/demo/){ .md-button .md-button--primary }

Sign in with the prefilled **demo / demo** credentials. These credentials work
only in the hosted demo. Changes to sample records stay in this browser tab's
memory and reset when you **refresh or log out**. Sample dates are relative to
the day you open the demo, so they will differ from documentation screenshots.

## 1. Inspect a license and its contract

1. Open **License Overview** and search for **Jira**.
2. Open **Jira Software Data Center, 250 users** from Atlassian.
3. Inspect its commercial details, dates, supplier, budget owner, and contract
   number **CTR-AT-2025-014**. Notice that the license expires in about 20 days.
4. Open **Contracts** and find **CTR-AT-2025-014**. Inspect its linked license
   and the **Signed agreement** and **Renewal quotes** folders.

**What to look for:** ownership and purchase context stay connected to the
license. Contract files in this demo are placeholders; license attachment
lists are empty. To evaluate actual file storage and previews, use an installed
instance and the [documents guide](../workflows/contracts-documents.md).

## 2. Follow a purchase into the registry

1. Open **Sourcing Overview** and find **Datadog - Infrastructure Monitoring,
   75 hosts** under **Direct Software Desk**. Expand the request and inspect
   the quantity, estimated cost, and supplier context.
2. Use its **Convert** action to create a new pending order. Use a sample PO
   number such as **DEMO-PO-001** when a PO number is requested.
3. Open **Pending Orders**, find that order, and review its line. Choose
   **Convert**, complete any required commercial fields, and confirm. Keep the
   sample dates; skip optional file uploads.
4. Find **Datadog** in **License Overview**. Its future start date makes it
   **Upcoming** until coverage begins. Open **History** to inspect the purchase trail.

**What to look for:** the line moves through the workflow without losing the
supplier and pricing context. Completed sourcing and orders are accessible through
their respective **History** views.

Prefer to start with an existing order? Open **PO-2026-0142**, the seeded Okta
order with **Workforce Identity** and **Advanced Server Access** lines. It
carries a manual PO total marked **Override**: the quote's bundle price, which
each converted license shows as its Total PO Value while the line prices stay
as quoted.

## 3. Start a renewal

1. Open **Renewals** and find the Atlassian **Jira** license from the first example.
2. Choose **Initiate Renewal** to open the license, then choose **Initiate Renewal**
   in its details panel. The sample license already has a budget owner.
3. Open **Sourcing Overview** and inspect the new Atlassian renewal line. Compare
   its proposed term with the original license's dates.
4. Continue through a pending order and conversion as in the purchase example,
   or stop here and inspect the renewal's progress from the workbench.

The workbench also shows two other kinds of deadline. **Arctic Wolf** is a
renewable managed service whose notice deadline comes before its end date, so
it is listed by the notice date with an **N** marker. **Sparx Systems** is a
perpetual license whose included support is ending; its row offers **Start
support renewal**, which creates a maintenance sourcing line for that license.

**What to look for:** starting renewal creates procurement work. The successor
is recorded when that purchase is converted; starting work does not itself
extend the current license's coverage. The installed application also supports
[linking an eligible existing successor](../first-licenses/renewal-reference.md#link-an-existing-successor).

## Demo limits

| Area | What to expect |
|---|---|
| Sample records | License, sourcing, order, and contract changes work in memory. Refresh or logout restores the seed data. |
| Documents | License and procurement file operations are unavailable. Contract uploads keep metadata only, and downloads contain placeholder text, not real PDF contents. |
| CSV import | Import processing and template download require an installed instance. Follow the [first import guide](../first-licenses/importing.md) there. |
| Server services | SMTP delivery, OIDC sign-in, database backup/restore, API-token creation, and webhook delivery require a real deployment. |
| Links | The demo keeps one browser address. An installed instance shows the page and selected license in the address, so links can be bookmarked and shared. |
| Other actions | Some screens are illustrative or simplified. Unsupported actions report that they need a real deployment. |

Use sample information for this walkthrough. Browser download and email-client
actions can still open your normal browser or mail tools; the demo does not
provide a working mail server or integration service.

## Continue with your own data

Choose an [installation method](../getting-started/prerequisites.md), then
[import your first records](../first-licenses/importing.md). For a complete renewal
example on an installed instance, follow the [renewal walkthrough](../first-licenses/renewal-lifecycle.md).
