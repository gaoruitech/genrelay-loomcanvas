# Getting started

[简体中文](getting-started.zh-CN.md)

This page takes you from an empty machine to your first generated image.

LoomCanvas does not include any models. You add a provider with your own API key, and the canvas calls its models for you.

> Status: early development. The built-in providers (Gaorui, OpenAI, Google Gemini) are covered by tests against a fake upstream; they have not yet been exercised against the real services as part of this project. If a request shape turns out to be wrong, please open an issue.

## 1. Prerequisites

| You need | Notes |
| --- | --- |
| Docker with Compose v2 (`docker compose`) | The Compose file starts LoomCanvas and MongoDB 7. |
| Git | To fetch the source. The image is built locally. |
| An API key from Gaorui, OpenAI or Google Gemini | See step 4. |

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

## 4. Add a provider

On the setup page, pick a provider, enter your API key and click **Test and save**. The provider is saved, a connection test runs, and you are taken to your canvases. If the test fails, the provider is not kept and the error is shown.

The form lists the **Models supported by this provider**. That list ships with LoomCanvas; it is not read from the upstream.

| Provider | What to enter | Notes |
| --- | --- | --- |
| Gaorui (recommended) | API key | One key for image, video and chat models. Get a key at <https://gaorui.cc>. |
| OpenAI | API key | Through the official OpenAI API. Chat, and image generation and editing. No video. |
| Google Gemini | API key | Through the official Gemini API. Image generation and editing, and chat. No video. |

Each provider uses its official address by default. To use another one, open **Advanced** and change **Base URL**; whatever answers there must speak exactly the same API as the official one.

You can also click **Skip for now** and add a provider later under **Settings → Providers**. A model that is not in a provider's list can be added afterwards as a custom model. Details are in [Providers](providers.md).

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
