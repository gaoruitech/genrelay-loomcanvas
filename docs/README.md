# LoomCanvas documentation

[简体中文](README.zh-CN.md)

> Status: early development. Interfaces may change before the first tagged release.

## Using it

| Page | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | From zero to your first generated image: start the stack, sign in as the super admin, add a provider, run a node. Accounts, and a first team in four steps. |
| [User guide](user-guide.md) | Finding your way around (workbench, canvases, assets, models, history, settings) and the canvas: the editor (toolbar, queue button, several nodes at once), nodes and their three layouts, wiring, running, results and history, brand kits, templates, assets, share links, shortcuts. Teams: spaces and roles, invites, canvases in a team, taking turns, monthly limits and usage, activity, team settings. |
| [FAQ](faq.md) | Problems people run into (models and cost, media, storage, runs, the editor, access and startup, teams), and licensing pointers. |

## Running it

| Page | What it covers |
| --- | --- |
| [Deployment](deployment.md) | Docker Compose, running without Docker, reverse proxy and HTTPS, backups, upgrades. |
| [Configuration](configuration.md) | Environment variables, admin settings and where each one is on the Settings page, what the super admin decides about teams, in-canvas settings, fixed limits. |
| [Storage](storage.md) | Local disk or an S3-compatible bucket (AWS S3, Cloudflare R2, Aliyun OSS, MinIO): setup per vendor, private buckets, delivery, switching, what has been tested. |
| [Providers](providers.md) | The three vendors and the models each supports, custom models, changing the address, upgrading from the previous version, how media reaches upstreams, pricing and usage. |
| [Security](security.md) | Hardening a deployment, accounts and teams and what keeps them apart, what is public, what LoomCanvas does not do. |

## Extending it

| Page | What it covers |
| --- | --- |
| [Development](development.md) | Repository layout, dev setup, scripts, adding nodes, strings and migrations, conventions. |
| [Integration](integration.md) | Building LoomCanvas into your own product: mounting the whole app in a host page, or only the canvas editor behind an adapter you supply. Options, events, the document format, style isolation, authentication patterns, compatibility, licensing. Examples in [`examples/`](../examples/README.md). |
| [Writing a provider](writing-a-provider.md) | The vendor module interface and the catalog file format, with a worked example and tests. |
| [Billing hook](billing-hook.md) | Metering or limiting runs with your own module. |
| [HTTP API](api.md) | Endpoint reference, with the contract of spaces and teams. |
| [Architecture and API contract](architecture.md) | The design contract between frontend and backend (Chinese). |

## Project

| Page | What it covers |
| --- | --- |
| [README](../README.md) | Overview and quick start. |
| [CHANGELOG](../CHANGELOG.md) | What changed. |
| [CONTRIBUTING](../CONTRIBUTING.md) | How to contribute. |
| [SECURITY](../SECURITY.md) | How to report a vulnerability. |
| [LICENSE](../LICENSE), [COMMERCIAL](../COMMERCIAL.md), [CLA](../CLA.md), [TRADEMARK](../TRADEMARK.md) | Licensing. |
| [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) | Third-party software and its licenses. |
