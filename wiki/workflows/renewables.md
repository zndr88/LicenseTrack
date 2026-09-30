# Certificates, Domains and Other Renewables

LicenseTrack can track anything that expires and has to be renewed, not only
software licenses. SSL/TLS certificates, domain names, support plans billed
per year and similar items use the same renewal workflow as subscriptions.

## Recording one

1. Add a license and choose the **Other** license type.
2. Enter a short **Type Description**, for example `SSL/TLS certificate` or
   `Domain name`. It is required for the Other type. Turn on the **Type
   Description** column in the Registry's column selector to see and sort by it;
   it is also included in the CSV export.
3. Tick **Renewable?**. The record now behaves like a subscription: it
   appears in the Renewal Workbench, raises expiry alerts and counts toward
   recurring cost.
4. Set the **Start Date** and **End Date** to the validity or registration
   period. Alerts follow the end date, using the notification window from
   Settings, so a record without an end date never raises an alert.
5. Use **Software Description** for what it covers, for example
   `*.example.com wildcard` or `example.com`, and **Supplier** for the
   certificate authority or registrar.

Quantity and unit price feed recurring cost as they do for any other record.
Extra details that matter to you, such as the certificate's common name, the
DNS provider or the server it is installed on, fit in custom fields.

## Renewing

Renew these records like any subscription: from the Renewal Workbench or from
the record itself. The new term becomes a new record in the same renewal
chain, so the history stays together.

## One-off items

Leave **Renewable?** unticked for something that simply ends, such as a
training voucher. A one-off record is retired automatically after its end
date and never raises renewal work.
