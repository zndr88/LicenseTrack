# Settings, notifications, and email

**My Settings** contains personal display preferences. **Admin > Settings**
contains installation-wide behavior and is divided into General, Integrations,
and Operations sections. Each settings section saves independently.

## Personal settings

Users can control theme, UI size, currency display, number/date/time format,
time zone, sidebar state, Registry column visibility, and saved views. These
preferences do not change another user's display.

Number formats are identified by their rendered pattern (`1,234.50`,
`1.234,50`, or `1 234,50`) instead of country names. CSV Import uses the
personal number format as its default while allowing a per-file override for
source data that uses another separator convention.

## Completeness and custom fields

Admins choose which supported fields and evidence categories contribute to
license completeness. New requirements are disabled by default so an existing
portfolio can be improved gradually.

Changing mandatory fields recalculates completeness when records reload; it
does not edit the stored license fields.

Custom fields add installation-specific Text, Currency, Date, or True/False
values to every license. Each definition has a stable key used by CSV and API
integrations. Deleting a definition also deletes its stored values.

## Notifications

The scheduled notification run evaluates expiring licenses, notice deadlines,
and incomplete licenses. Admins
configure:

- the daily notification hour;
- the expiry alert window;
- the notice deadline alert window;
- the manager digest address;
- allowed recipient domains; and
- customizable email introduction and sign-off text.

The manager digest is eligible whenever the run contains an expired, expiring,
notice-due, or incomplete-license item. An incomplete-only run therefore sends
the configured manager digest; a run with no eligible items sends no empty
digest.

Notification and daily database-backup hours use the full `0..23` range. Hour
`0` is midnight and is preserved as entered. Blank, non-numeric, and
out-of-range values fail validation instead of silently becoming a default
hour.

Budget-owner renewal email requires a valid owner address and the license's
**Renewal notifications** flag. That flag is enabled by default and can suppress
expiry email for one active license without retiring it.

The expiry alert window is the shared definition of "expiring soon" throughout
the app. Registry badges and statistics, license detail calculations, exports,
reports, contracts, renewal and maintenance responses, and notifications all use
the configured value.

The notice deadline alert window is separate. Notice deadline reminders are
sent to the configured manager digest address and do not email the budget owner.
Once a notice deadline has been reviewed, editors and admins can mark it
handled from the license detail panel. Handled notice dates are suppressed from
future notice alerts until the notice date is changed.

## SMTP

Configure SMTP host, port, sender name/address, username, password, encryption
mode, and the **Enable Email Notifications** switch inside Admin Settings.
Credentials are encrypted at rest and returned to the browser as masked values.

- **Send test email** validates SMTP by sending one message to the manager
  address.
- **Trigger notifications now** executes the real notification workflow and may
  send messages to configured recipients.

!!! warning
    Use the test-email action while configuring SMTP. The manual notification
    trigger is an operational retry and is not a harmless preview.

## OIDC

OIDC configuration includes the discovery URL, client ID, and client secret.
LicenseTrack validates server-fetched discovery and key URLs against SSRF
restrictions. Plain HTTP, loopback, private, link-local, and reserved hosts are
blocked unless the server operator deliberately enables the documented unsafe
development flags.

Changing OIDC settings invalidates the availability cache, so the login page
reflects the new provider state without an application restart.

See [Production deployment](../operations/deployment.md) for HTTPS, cookies,
CORS, and development-only OIDC network allowances.
