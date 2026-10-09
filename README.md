# LoomCanvas

[简体中文](README.zh-CN.md)

An open-source, self-hosted infinite canvas for AI image and video creation. Connect text, images and models with lines, then run the whole flow in one click.

LoomCanvas does not sell credits. You bring your own API keys; the canvas shows the estimated cost of each step and keeps a usage log.

> Status: early development. Interfaces may change before the first tagged release.

## Features

- **Canvas editor** — input nodes (text, image, image set, video), generation nodes (image, image edit, video, video edit, LLM, video analysis), local tool nodes (slice, collage, resize, watermark, multi-platform export), frames, outputs.
- **Run orchestration** — run a single node, a branch or the whole canvas; batch runs; undo/redo; auto layout.
- **Bring your own models** — pluggable providers. Built in: Gaorui API (one key, many models), any OpenAI-compatible endpoint, Gemini-format endpoints.
- **Cost, not credits** — estimated cost per run from a price table you control, plus usage records.
- **Self-hosted** — one `docker compose up`. Files on local disk by default; S3-compatible storage and Aliyun OSS are supported.
- **Templates, brand kits, share links.**

## Quick start

```bash
git clone <this repo> loomcanvas && cd loomcanvas
cp .env.example .env
# edit .env and set SECRET_KEY to a long random string
docker compose up -d
```

Open http://localhost:3000 and follow the setup page to connect a model provider.

`SECRET_KEY` encrypts your provider API keys in the database. Keep it safe and do not change it afterwards, or the saved keys can no longer be decrypted.

## Development

```bash
# backend
cd server && npm install && npm run dev      # http://localhost:3000
# frontend
cd web && npm install && npm run dev         # http://localhost:5173, proxies /api to :3000
```

Requires Node.js 20+ and MongoDB 7.

## Documentation

- [Architecture and API contract](docs/architecture.md) (Chinese)
- [Writing a provider](server/README.md)

## License

LoomCanvas is dual-licensed:

- **AGPL-3.0** — free to use and modify. If you run a modified version as a network service, you must publish your changes. See [LICENSE](LICENSE).
- **Commercial license** — for closed-source use or embedding in proprietary products. See [COMMERCIAL.md](COMMERCIAL.md).

"LoomCanvas" and its logo are trademarks and are not covered by the code license. See [TRADEMARK.md](TRADEMARK.md).

Contributions are welcome under the [Contributor License Agreement](CLA.md). See [CONTRIBUTING.md](CONTRIBUTING.md).
