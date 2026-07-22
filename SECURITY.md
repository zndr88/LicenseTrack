# Security policy

## Supported versions

The stable release track supports the latest stable Docker release series.
Security fixes are provided via updated container images and dependency updates.

If you are running an older image tag, upgrade to the latest stable release.

## Reporting a vulnerability

Please report security issues privately by opening a GitHub Security Advisory
(private vulnerability report) from the repository's Security tab. Do not open
a public issue for security reports.

Include:
- A clear description of the issue and impact
- Steps to reproduce (or a proof-of-concept)
- Affected versions/tags if known
- Any relevant logs or configuration details

## Response targets

These are best-effort targets (not a contractual SLA):
- Critical: acknowledge within 3 business days, fix/mitigation as soon as feasible
- High: acknowledge within 5 business days
- Medium/Low: acknowledge within 10 business days

## Release hygiene (supply chain)

These are best-effort goals for releases, not guarantees:
- A dependency SBOM for Python and npm
- Dependency vulnerability scans for Python and npm manifests
- A container/image vulnerability scan for the final release image
- A documented upgrade path for Docker deployments
- Removal of unsupported runtimes from the stable track.

## Built-in protections

The application ships with the following defenses enabled by default:

- Startup refuses to run with a blank or common-default `JWT_SECRET` or
  `ADMIN_PASSWORD`.
- Passwords are hashed with bcrypt; the initial admin account is forced to
  change its password on first login.
- Login attempts are throttled per username **and** per source IP, so neither
  single-account brute force nor password spraying across many usernames goes
  unthrottled. The failed-attempt counters are memory-bounded. A missing user
  triggers a constant-time dummy verification so usernames cannot be enumerated
  by response timing.
- Security response headers (a strict Content-Security-Policy,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and a referrer
  policy) are applied to every response.
- CORS is an explicit origin allow-list; non-listed origins receive no
  `Access-Control-Allow-Origin`.
- Uploaded file names are reduced to a safe basename, stored under a random
  identifier, and validated by size, extension, and MIME type. Download paths
  are confined to the storage root.
- The Official Extensions host is disabled by default. Outside explicit
  developer mode, packages require an Ed25519 signature from a pinned
  LicenseTrack release key. Package extraction rejects zip-slip paths and
  symlinks and stays inside a staging directory.
- Outbound requests built from operator-supplied URLs (OIDC discovery, webhook
  delivery) pass an SSRF guard that blocks loopback, private, link-local, and
  reserved addresses, re-checked on every redirect hop.
- The interactive API docs and OpenAPI schema are disabled unless
  `EXPOSE_API_DOCS=true`.

## Operator responsibilities

Some protections depend on correct deployment configuration:

- Serve the application over HTTPS and set `SESSION_COOKIE_SECURE=true` so the
  session cookie is never sent over plain HTTP.
- Terminate TLS at a reverse proxy and forward the real client IP (for example,
  run uvicorn with `--proxy-headers`). Login IP throttling uses the connecting
  address; without forwarded headers every request appears to come from the
  proxy.
- Keep `EXPOSE_API_DOCS` unset (or `false`) in production.
- Set a strong, unique `JWT_SECRET`; it also derives the encryption key for
  stored integration secrets.
- Install Official Extensions only from official LicenseTrack release
  channels. Do not add unreviewed keys to `OFFICIAL_EXTENSION_PUBLIC_KEYS`, and
  never enable `PLUGIN_HOST_DEVELOPER_MODE` in production.

## Known limitations

- Session tokens (JWTs) are stateless and cannot be individually revoked before
  they expire; logout clears the session cookie. Keep `TOKEN_EXPIRY` reasonable
  and rotate `JWT_SECRET` to invalidate all outstanding sessions if needed. The
  session cookie is `HttpOnly`, which — together with the Content-Security-Policy
  — limits token theft via cross-site scripting.

- Official Extensions are trusted application code. Managed processes,
  declared permissions, callback tokens, environment allow-listing, and
  process-tree shutdown reduce accidental exposure and improve lifecycle
  control, but they do not provide a hostile-code sandbox. An enabled extension
  runs under the LicenseTrack operating-system account and may access resources
  available to that account, including application files and the database.
- Unofficial or third-party in-process packages are outside the supported
  security model. Use API tokens, webhooks, or externally hosted sidecars for
  custom and third-party automation.

## Compliance posture

Security evidence in this repository is not a formal certification, penetration test report, SOC report, or regulatory attestation.
