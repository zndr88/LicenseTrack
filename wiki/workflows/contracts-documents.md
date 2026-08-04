# Contracts and documents

LicenseTrack keeps agreement-level files, license evidence, and procurement
evidence in distinct scopes. Choosing the right scope prevents one license from
silently inheriting documents that belong somewhere else.

## Contract records

Create a contract for an agreement that applies across one or more licenses.
Contracts are identified by publisher and contract number and can be linked from
license records.

Contract numbers are treated as case-insensitive identifiers. For example,
`CN-123` and `cn-123` refer to the same contract identity and cannot be created
as separate contract records through the normal UI/API. If older data already
contains duplicate contract numbers with different casing, LicenseTrack returns
a conflict instead of guessing which contract a license should link to.

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
| Manual creation batch | Quote, PO, and invoice evidence selected while creating several licenses | Licenses created in that batch |

Procurement documents shared after conversion are keyed by pending-order
relationship. Direct multi-license procurement evidence is keyed by its manual
creation batch. PO number is metadata and is not a sharing key.

Deleting a license removes its license-owned document rows and managed files
after the database deletion commits. Shared procurement evidence remains until
its owning workflow says it can be removed: pending-order evidence remains with
the order, while manual-batch evidence is removed only after the final license
in that batch is deleted.

## Upload limits

The configured upload limit applies to the file payload. A payload exactly at
the limit is valid, while a payload one byte over it is rejected. LicenseTrack
also applies a bounded transport-level ceiling that allows ordinary multipart
metadata without treating it as part of the file size.

## Completeness

Admins can require evidence categories such as invoice, purchase order, quote,
EULA, or proof of entitlement. The license completeness score checks visible
license-owned and procurement evidence against those requirements.

Adding evidence after conversion updates completeness without reopening the
procurement workflow. These late uploads and deletions are recorded as evidence
amendments in the audit log.

Contract-document uploads and deletions are also recorded with the contract,
document, optional folder, filename, and actor context. File contents are not
written to audit detail.

## Access and downloads

Editors and Admins can upload and manage documents. Viewer access is constrained
by department scope on the licenses linked to the contract. Contract-number
matching for this visibility check is case-insensitive, and document download
permission can be disabled per user. Possession of a direct download URL does
not bypass those checks.

## Backup responsibility

Uploaded documents live on the filesystem under the configured storage path.
Application database backups do not contain those files.

!!! danger
    Back up both the SQLite database and document storage. A database-only
    restore can recover metadata while leaving the referenced files unavailable.

See [Backup and restore](../operations/backup-restore.md) for the complete
recovery model.
