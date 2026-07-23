# Versioning

LicenseTrack uses three-part release numbers in the form `major.milestone.train`.
This resembles Semantic Versioning, but it is not strict SemVer: a train release
may include backward-compatible product features as well as fixes.

## Major releases

The first number marks a new product generation. It changes only when
LicenseTrack introduces intentionally breaking compatibility or another
fundamental change that warrants a new major line.

Example: `2.0.0`.

## Milestone releases

The second number marks a substantial, coherent step in the product or
platform. A milestone may introduce an important workflow, runtime baseline,
architecture evolution, or similarly notable body of work.

Example: `1.2.0`.

A milestone release does not imply that earlier releases in the same major line
were unstable, and it does not by itself authorize breaking stable API
contracts.

## Release-train updates

The third number advances the active milestone series. These releases may
contain any backward-compatible combination of:

- product features;
- bug fixes;
- security and deployment hardening;
- dependency updates;
- documentation and usability improvements.

Examples: `1.1.1`, `1.1.2`.

Release notes identify what changed so operators do not need to infer the
contents from the number alone.

## Compatibility

Stable API and integration contracts follow the deprecation and breaking-change
rules in
[docs/extension-authors/api-stability.md](docs/extension-authors/api-stability.md).
New optional fields, new routes, and other additive changes may ship within a
release train. Breaking stable contracts normally require a new major release
or a documented deprecation path.

Security vulnerabilities, data-corruption risks, and severe authorization
defects may require an exceptional compatibility change. Such changes must be
called out clearly in the release notes with operator guidance.

Database migrations may appear in milestone or train releases when they are
handled by the supported upgrade process and preserve the documented upgrade
path.
