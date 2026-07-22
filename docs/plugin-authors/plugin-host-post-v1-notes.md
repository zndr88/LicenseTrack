# Official Extensions Maintainer Notes

The earlier generic Plugin Host direction has been superseded by the trusted
first-party Official Extensions model. Marketplace discovery, community
package compatibility, third-party signing enrollment, and arbitrary custom UI
are not product commitments.

## Owner decision still required

Before a production Official Extension can ship, the repository owner must
approve:

- production Ed25519 key IDs and public key material;
- private-key custody and authorized signers;
- build provenance and release signing procedure;
- rotation, compromise, and revocation policy;
- where release packages, checksums, and trust-store configuration are
  published;
- which extensions receive project support and who maintains them.

The surrounding trust store, signature format, persistence, migration, admin
review, and runtime enforcement are implemented. The repository intentionally
contains no invented production key material.

## Possible future maintainer work

- release tooling that produces the canonical digest and detached signature;
- reproducible-build and provenance attestations;
- SBOM display for official packages;
- explicit revoked-key metadata and upgrade guidance;
- compatibility checks against the next LicenseTrack release;
- additional core-rendered action slots for official project needs.

Any future work must preserve the public customization boundary: custom and
third-party automation uses APIs, webhooks, and sidecars, not unofficial
in-process packages.
