# Advanced Integrations

LicenseTrack works without integrations or plugins. The advanced extension paths
are for technical operators who need automation, private connectors, document
processing, or installable add-ons.

## Choose The Right Path

| Need | Start here |
| --- | --- |
| Script or service that reads/writes LicenseTrack data | API/webhook integration docs |
| External system reacting to LicenseTrack events | Webhook docs |
| Operator-triggered parsing of uploaded documents | Document processor docs |
| Installable package with settings, permissions, and UI actions | Plugin author docs |

## Repository Docs

These advanced docs live in the GitHub repository rather than the published
operator manual:

- [Extension author docs](https://github.com/zndr88/LicenseTrack/tree/main/docs/extension-authors)
- [Plugin author docs](https://github.com/zndr88/LicenseTrack/tree/main/docs/plugin-authors)
- [Maintainer docs](https://github.com/zndr88/LicenseTrack/tree/main/docs/maintainer)

Keep baseline deployments simple. Do not configure API tokens, webhooks,
document processors, or plugins unless you actually need them.
