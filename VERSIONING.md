# Versioning

Starting with 1.2.0, LicenseTrack follows
[Semantic Versioning](https://semver.org/): release numbers take the form
`major.minor.patch`, and each part tells operators what kind of change to
expect before they read the release notes.

## Major releases

The first number changes only when a release intentionally breaks
compatibility: a stable API or integration contract, a supported upgrade path,
or a deployment requirement that operators must act on. Major releases are
rare and always ship with upgrade guidance.

Example: `2.0.0`.

## Minor releases

The second number marks a feature release. Minor releases bundle
backward-compatible work that has accumulated since the previous minor release:

- new product features and workflow improvements;
- changes to existing behavior that stay backward compatible;
- database schema migrations;
- runtime, dependency, and platform baseline updates;
- documentation and usability improvements.

Minor releases ship when a coherent body of work is ready, typically every six
to eight weeks, rather than on a fixed date.

Example: `1.2.0`.

## Patch releases

The third number marks a fix-only release for the current minor line. Patch
releases contain no new features. They may include:

- bug fixes;
- security fixes and hardening;
- dependency updates needed for a fix or advisory;
- documentation corrections.

Fixes are grouped rather than released one at a time. A patch release goes out
promptly for security issues, data-integrity risks, or defects that block
normal use; other fixes wait for the next patch or minor release.

A patch release avoids database migrations unless a fix requires one.

Example: `1.2.1`.

## Unreleased work

Work merged to `main` between releases is recorded under **Unreleased** in
[CHANGELOG.md](CHANGELOG.md). `main` is not a release; operators should deploy
tagged versions.

## Compatibility

Stable API and integration contracts follow the deprecation and breaking-change
rules in
[docs/extension-authors/api-stability.md](docs/extension-authors/api-stability.md).
New optional fields, new routes, and other additive changes may ship in minor
releases. Breaking stable contracts requires a new major release or a
documented deprecation path.

Security vulnerabilities, data-corruption risks, and severe authorization
defects may require an exceptional compatibility change. Such changes must be
called out clearly in the release notes with operator guidance.

Database migrations are applied by the supported upgrade process in every
release type and preserve the documented upgrade path.

## Earlier releases

Releases 1.0.0 through 1.1.24 used a milestone and release-train model in which
the third number could also carry new features. Their release notes in
[CHANGELOG.md](CHANGELOG.md) describe what each one contains.
