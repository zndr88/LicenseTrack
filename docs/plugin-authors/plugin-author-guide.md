# Official Extension Release Maintainer Guide

This guide is internal first-party material. Use it only for extensions owned,
reviewed, published, and signed by the LicenseTrack project. Do not distribute
unsigned or third-party packages as supported LicenseTrack extensions.

## Product and trust rules

- The host is disabled unless `PLUGIN_HOST_ENABLED=true`.
- Stable mode installs and runs only packages signed by a pinned LicenseTrack
  Ed25519 release key.
- `PLUGIN_HOST_DEVELOPER_MODE=true` permits unsigned local packages, marks them
  `developer`, and is unsupported in production.
- Manifest publisher metadata is descriptive and never establishes trust.
- Official status comes only from signature verification against
  `OFFICIAL_EXTENSION_PUBLIC_KEYS`.
- Official Extensions are trusted application code, not sandboxed code. Review
  their full source and dependency chain before signing.

The production key IDs, public keys, private-key custody, release signing
procedure, and rotation/revocation policy require an owner-approved release
decision. Do not invent or commit production private keys. Public keys must be
distributed through an official LicenseTrack release channel.

## Package layout

An extension package is a zip with these root entries:

```text
plugin.ltplugin
README.md
LICENSE
SIGNATURE.json
runtime/
  main.py
```

The manifest remains `manifestVersion: 1` and declares identity,
compatibility, a Python managed-process runtime, access, settings,
capabilities, and core-rendered action slots. Internal `plugin_*` names and API
paths are implementation details and may change with LicenseTrack.

## Signature format

`SIGNATURE.json` is a detached signature document:

```json
{
  "schemaVersion": 1,
  "algorithm": "Ed25519",
  "keyId": "owner-approved-release-key-id",
  "signature": "base64-encoded-64-byte-signature"
}
```

The signature covers the raw SHA-256 digest of a deterministic framing of every
non-directory zip entry except `SIGNATURE.json`, sorted by normalized POSIX
path. For each entry the framing is:

1. four-byte big-endian UTF-8 path length;
2. UTF-8 normalized path;
3. eight-byte big-endian content length;
4. raw file content.

Use the exact implementation in
`backend/app/services/plugin_signature_service.py` when building the release
signer. The package preview displays both the complete zip SHA-256 checksum and
the verified key identity.

`OFFICIAL_EXTENSION_PUBLIC_KEYS` is a JSON array:

```json
[
  {
    "keyId": "owner-approved-release-key-id",
    "signer": "LicenseTrack Project",
    "publicKey": "base64-encoded-raw-32-byte-ed25519-public-key"
  }
]
```

Multiple entries support key rotation. Removing a key prevents new
verification with that key; coordinate removal with the release and upgrade
policy.

## Runtime and access

The runtime is a managed local Python process. It receives only the host's
explicit runtime environment allow-list plus `LT_PLUGIN_*` callback values. It
must bind to the allocated loopback port, authenticate callbacks with the
runtime bearer token, expose the declared health path, and return structured
action results.

Declare every access the runtime uses. `plugin:settings:read` is required for
the runtime settings callback. `documents:read` is required for document
content, document references, and draft contexts that contain raw file content
or document IDs. Core validates roles, target scope, suggestions, and final
data writes.

Disable and uninstall terminate the managed process tree. This is lifecycle
cleanup, not isolation. Runtime code executes under the LicenseTrack OS account
and may access files and the database available to that account.

## Release checklist

1. Confirm the extension is first-party and has a named LicenseTrack maintainer.
2. Review source, transitive dependencies, provider behavior, and data flows.
3. Validate manifest compatibility and least-required access.
4. Build reproducibly and record the full package SHA-256 checksum.
5. Sign with the owner-approved offline/release process.
6. Test preview, install-disabled, explicit enable confirmation, health,
   actions, suggestions, disable, process-tree cleanup, and uninstall.
7. Publish the package, checksum, key ID, and public-key configuration through
   an official LicenseTrack release channel.
8. Document upgrade, rollback, credential, data-processing, and support notes.
