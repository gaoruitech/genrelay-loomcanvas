# Getting started

[简体中文](getting-started.zh-CN.md)

This page takes you from an empty machine to your first generated image.

LoomCanvas does not include any models. You connect an upstream API with your own key, and the canvas calls it for you.

> Status: early development. The built-in providers are covered by tests against a fake upstream; they have not yet been exercised against the real services as part of this project. If a request shape turns out to be wrong, please open an issue.

## 1. Prerequisites

| You need | Notes |
| --- | --- |
| Docker with Compose v2 (`docker compose`) | The Compose file starts LoomCanvas and MongoDB 7. |
| Git | To fetch the source. The image is built locally. |
| An API key for a model provider | See step 4. |

To run without Docker, see [Deployment](deployment.md#running-without-docker).

## 2. Start the stack

```bash
git clone https://gitee.com/jishulin/loomcanvas.git
cd loomcanvas
cp .env.example .env
```

Edit `.env`:

1. Set `SECRET_KEY` to a long random string (at least 16 characters). You can generate one with:

   ```bash
   openssl rand -base64 32
   ```

2. Leave `PUBLIC_URL` empty for local or LAN use. Uploaded and generated files are addressed relative to whatever address the app is opened at, so any host and port works. Set it to the instance's public address (for example `https://canvas.example.com`) when upstream models have to fetch reference media by URL, which video inputs with local storage need. See [Deployment](deployment.md#public_url).

3. Optionally set `ACCESS_PASSWORD` if other people can reach the machine.

Then start it:

```bash
docker compose up -d
```

The first run builds the image, which takes a few minutes. Check that it is up:

```bash
docker compose ps
docker compose logs app
```

The log line `LoomCanvas server listening on :3000` means the server is ready.

## 3. Open the app

Open <http://localhost:3000>. If you changed `PORT`, use that port; from another machine, use the host's address instead of `localhost`.

- If you set `ACCESS_PASSWORD`, you are asked for it first.
- A new instance has no provider, so you land on the setup page.

![Setup page](images/01-setup.png)

## 4. Connect a provider

On the setup page, pick a provider type, fill in the form and click **Test and save**. The provider is saved, a connection test runs, and you are taken to your canvases. If the test fails, the provider is not kept and the error is shown.

| Type | What to enter | Notes |
| --- | --- | --- |
| Gaorui API (recommended) | API key | One key for the built-in image and video models plus chat models. Get a key at <https://gaorui.cc>. The base URL is filled in by default. |
| OpenAI-compatible | Base URL, API key | For OpenAI itself, relays and self-hosted gateways. Chat and text-to-image only. |
| Google Gemini | API key | Image generation and editing, and chat. |

You can also click **Skip for now** and add a provider later under **Settings → Providers**. Details of each type are in [Providers](providers.md).

## 5. Create a canvas from a template

1. On the **My canvases** page, click **New from template**.
2. Choose **Text to image**. A canvas opens with a Text node wired into an Image generation node.

![Canvas editor](images/04-editor.png)

## 6. Run a node

1. Edit the text in the Text node if you want a different prompt.
2. In the Image generation node, open the model dropdown and choose a model. If the dropdown says "No models available yet", go back to **Settings → Providers** and check the provider and its models.
3. Click the node's **Run** button.

The badge on the result frame shows the status: queued, running, done or failed.

"Run all" in the top bar needs at least one Output node on the canvas. The Text to image template has none, so use the node's own Run button here.

## 7. Results and cost

![A finished run](images/06-editor-result.png)

- The result appears in the node's result frame. Running again never overwrites it: earlier results stay in the node's history.
- The file is copied into your own storage (the `app_data` volume by default), so it does not depend on an upstream link that may expire.
- Next to the Run button the node shows the estimated cost of one run. A new install shows **Cost unknown**, because no prices are configured. Enter the rates you pay under **Settings → Models → Set price**; see [Providers](providers.md#pricing).
- **Settings → Usage** lists every run and totals by day or by model.

## Next steps

- [User guide](user-guide.md) for everything the canvas can do.
- [Deployment](deployment.md) before you put an instance on the internet.
- [FAQ](faq.md) if something does not work.
