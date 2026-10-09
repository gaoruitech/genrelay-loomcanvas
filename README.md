# LoomCanvas

[简体中文](README.zh-CN.md)

An open-source, self-hosted infinite canvas for AI image and video creation. Connect text, images and models with lines, then run the whole flow in one click.

LoomCanvas does not sell credits and ships no models. You bring your own API keys; the canvas shows the estimated cost of each step and keeps a usage log.

> Status: early development. Interfaces may change before the first tagged release. The built-in providers are tested against a fake upstream and have not yet been exercised against the real services as part of this project; the S3 and OSS storage drivers are written but untested.

![The canvas editor](docs/images/11-editor-en.png)

## Features

- **Canvas editor.** Source nodes (text, image, image set, video), generation nodes (image generation, image edit, video generation, video edit, language model, video analysis), an output node, and groups. Typed connections, undo/redo, copy and paste, auto layout, node search.
- **Local tool nodes.** Slice, collage, resize, watermark and multi-platform export run on your own server and cost nothing.
- **Run orchestration.** Run a single node, a branch or the whole canvas; batch runs over a set of source images. Runs are queued with a concurrency limit and hard timeouts. After a server restart, queued runs and runs that already have an upstream task carry on.
- **Bring your own models.** Providers are plugins. Built in: Gaorui API (one key for image, video and chat models), any OpenAI-compatible endpoint (chat and text-to-image), and Google Gemini (image and chat).
- **Cost, not credits.** An estimate per run from a price table you maintain, shown as "Cost unknown" until you enter prices, plus usage records by day and by model.
- **Your files stay with you.** Results are copied into your own storage: local disk by default; S3-compatible storage and Aliyun OSS drivers are included.
- **Templates, brand kits, asset library, share links.** Read-only share links with expiry and revocation.
- **Chinese and English** interface and server messages; light and dark themes.
- **Single-user by design.** One optional shared access password. No accounts, no multi-tenant isolation.

## Screenshots

| | |
| --- | --- |
| ![Editor](docs/images/04-editor.png) Editor | ![A finished run](docs/images/06-editor-result.png) Results on the canvas |
| ![Dark theme](docs/images/09-editor-dark.png) Dark theme | ![Setup](docs/images/01-setup.png) First-run setup |
| ![Models and prices](docs/images/08-settings-models.png) Models and prices (example prices) | ![English interface](docs/images/11-editor-en.png) English interface |

## Quick start

You need Docker with Compose v2.

```bash
git clone https://gitee.com/jishulin/loomcanvas.git
cd loomcanvas
cp .env.example .env
# edit .env: set SECRET_KEY to a long random string
docker compose up -d
```

Open http://localhost:3000 (or the host's address, with the `PORT` you set) and follow the setup page to connect a model provider. The recommended one is the Gaorui API; get a key at https://gaorui.cc.

- `SECRET_KEY` encrypts your provider API keys in the database. Keep it safe and do not change it afterwards, or the saved keys can no longer be decrypted.
- `PUBLIC_URL` is optional. Leave it empty for local or LAN use: files are addressed relative to whatever address the app is opened at. Set it to the instance's public address so that upstream models can fetch reference media by URL (needed for video inputs with local storage).
- Set `ACCESS_PASSWORD` if anyone else can reach the machine.

Step by step: [Getting started](docs/getting-started.md).

## Documentation

| | |
| --- | --- |
| [Getting started](docs/getting-started.md) | From zero to the first image |
| [User guide](docs/user-guide.md) | Using the canvas |
| [Deployment](docs/deployment.md) | Docker, reverse proxy, backups, upgrades |
| [Configuration](docs/configuration.md) | Environment variables and settings |
| [Providers](docs/providers.md) | Provider types, models, pricing |
| [Security](docs/security.md) | Hardening and limits |
| [FAQ](docs/faq.md) | Common problems |
| [Development](docs/development.md) | Working on the code |
| [Writing a provider](docs/writing-a-provider.md) | Adding an upstream API format |
| [Billing hook](docs/billing-hook.md) | Metering and limits |
| [HTTP API](docs/api.md) | Endpoint reference |
| [Architecture](docs/architecture.md) | Frontend/backend contract (Chinese) |
| [Changelog](CHANGELOG.md) | What changed |

All pages: [docs/README.md](docs/README.md).

## Development

Requires Node.js 20.9+ and MongoDB 7.

```bash
# backend
cd server && npm install && cp .env.example .env   # then set SECRET_KEY in server/.env
npm run dev                                        # http://localhost:3000

# frontend, in another terminal
cd web && npm install && npm run dev               # http://localhost:5173, proxies /api to :3000
```

See [Development](docs/development.md).

## License

LoomCanvas is dual-licensed:

- **AGPL-3.0** — free to use and modify. If you run a modified version as a network service, you must publish your changes. See [LICENSE](LICENSE).
- **Commercial license** — for closed-source use or embedding in proprietary products. See [COMMERCIAL.md](COMMERCIAL.md).

"LoomCanvas" and its logo are trademarks and are not covered by the code license. See [TRADEMARK.md](TRADEMARK.md). Third-party software is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Contributions are welcome under the [Contributor License Agreement](CLA.md). See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).
