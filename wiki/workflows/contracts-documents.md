# Contracts and documents

LicenseTrack keeps agreement-level files, license evidence, and procurement
evidence in distinct scopes. Choosing the right scope prevents one license from
silently inheriting documents that belong somewhere else.

## Contract records

Create a contract for an agreement that applies across one or more licenses.
Contracts are identified by publisher and contract number and can be linked from
license records.

Use folders inside the contract to organize signed agreements, amendments,
schedules, data-processing terms, or other agreement-level material. Folder
names organize files; they do not create separate permission boundaries.

Deleting a contract removes its stored contract documents and unlinks affected
licenses. The license records themselves remain and can be linked to another
contract later.

## Document scopes

| Scope | Appropriate content | Visibility |
| --- | --- | --- |
| Contract | Agreements, amendments, schedules | Through the contract record |
| License | EULA, entitlement certificate, license-specific evidence | One license |
| Sourcing | Supplier quote and quote-stage evidence | Sourcing request and its history |
| Pending order | PO and invoice evidence | Pending order and licenses created from it |

Procurement documents shared after conversion are keyed by pending-order
relationship. PO number is metadata and is not a sharing key.

## Completeness

Admins can require evidence categories such as invoice, purchase order, quote,
EULA, or proof of entitlement. The license completeness score checks visible
license-owned and procurement evidence against those requirements.

Adding evidence after conversion updates completeness without reopening the
procurement workflow. These late uploads and deletions are recorded as evidence
amendments in the audit log.

## Access and downloads

Editors and Admins can upload and manage documents. Viewer access is constrained
by department scope, and document download permission can be disabled per user.
Possession of a direct download URL does not bypass those checks.

## Backup responsibility

Uploaded documents live on the filesystem under the configured storage path.
Application database backups do not contain those files.

!!! danger
    Back up both the SQLite database and document storage. A database-only
    restore can recover metadata while leaving the referenced files unavailable.

See [Backup and restore](../operations/backup-restore.md) for the complete
recovery model.
