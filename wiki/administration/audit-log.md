# Audit log

The audit log records security-sensitive and data-changing events so Admins can
answer who changed what, when, and through which access path.

## Recorded activity

Audit coverage includes authentication, users and roles, settings, licenses,
procurement, documents and evidence amendments, contracts, backup and restore,
API tokens, integration capabilities, document processing, and webhook-backed
events.

Events identify the actor, action, target type and identifier, time, and
structured detail where the workflow needs more context than a simple field
change.

API-token activity records token ID and name alongside the owning Admin account.
This lets operators isolate one integration even when several tokens share an
owner.

## Search and export

Admins can filter and search the audit table and export the matching result to
CSV. Keep exports in your normal evidence or log-retention system when policy
requires history beyond the application's configured retention window.

Suggested reviews include:

- failed login patterns and account changes;
- Admin, Editor, department, and download-permission changes;
- OIDC, SMTP, storage, and mandatory-field configuration;
- database restore and backup failures;
- document uploads, deletions, and post-conversion amendments; and
- API-token, webhook, and integration activity.

## Retention and operational logs

Audit retention is configured in Admin Settings and pruned by background work.
Reducing retention can remove older audit rows after the next prune cycle.

!!! note
    Audit history is a product event record, not a replacement for container,
    reverse-proxy, identity-provider, or operating-system logs. Forward those
    logs to your normal monitoring platform for incident response.

See the [Operations runbook](../operations/runbook.md) for broader monitoring
and review guidance.
