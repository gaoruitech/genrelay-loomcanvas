# Getting started

[简体中文](getting-started.zh-CN.md)

This page takes you from an empty machine to your first generated image.

LoomCanvas does not include any models. You add a provider with your own API key, and the canvas calls its models for you.

> Status: early development. The built-in Gaorui models have been run against the real service; the OpenAI and Google Gemini integrations follow the official documentation but have not been run by the project. If a request shape turns out to be wrong, please open an issue.

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

2. Leave `PUBLIC_URL` empty for local or LAN use. Uploaded and generated files are addressed relative to whatever address the app is opened at, so any host and port works. Set it to the instance's public address (for example `https://canvas.example.com`) when upstream models have to fetch reference media by URL, which video inputs and reference images for the Gaorui image models need with local storage. See [Deployment](deployment.md#public_url).

There is nothing to set for signing in. Accounts are created in the app, in the next step.

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

You see the landing page.

![Landing page](images/12-landing.png)

1. Click **Start creating** (or **Sign up** at the top right). On a new instance the form is titled **Create the owner account**: choose a username, enter an email address and a password of at least 8 characters, and repeat the password. **This first account is the owner of the instance**, so register before anyone else can reach it. No email is sent. See [Accounts](#accounts).
2. You are signed in at once. A new account has no provider, so the next page asks you to add one (step 4).

Later you come back through **Sign in**, with the username or the email and the password. Tick **Remember me** to stay signed in for 30 days instead of 12 hours.

![Sign-in page](images/13-login.png)

## 4. Add a provider

![Add a provider](images/01-setup.png)

On the **Add a provider** page, pick a provider, enter your API key and click **Test and save**. The provider is saved, a connection test runs, and you are taken to the workbench. If the test fails, the provider is not kept and the error is shown.

The form lists the **Models supported by this provider**. That list ships with LoomCanvas; it is not read from the upstream.

| Provider | What to enter | Notes |
| --- | --- | --- |
| Gaorui (recommended) | API key | One key for image, video and chat models. Get a key at <https://gaorui.cc>. |
| OpenAI | API key | Through the official OpenAI API. Chat, and image generation and editing. No video. |
| Google Gemini | API key | Through the official Gemini API. Image generation and editing, and chat. No video. |

Each provider uses its official address by default. To use another one, open **Advanced** and change **Base URL**; whatever answers there must speak exactly the same API as the official one.

You can also click **Skip for now** and add a provider later on the **Models** page (**Add provider**). Until the account has a provider, the page comes back the next time you open the app. A model that is not in a provider's list can be added afterwards as a custom model. Details are in [Providers](providers.md).

## 5. Create a canvas from a template

The workbench is the start page of the app. The sidebar on the left leads to everything else: **Workbench**, **Canvases**, **Assets**, **Models**, **History** and **Settings**.

![Workbench](images/14-workbench.png)

1. On the workbench, under **Start from a template**, click **Text to image**. (The **Canvases** page has the same thing behind **New from template**.)
2. A new canvas, named after the template, opens in the editor with a Text node wired into an Image generation node.

![Canvas editor](images/04-editor.png)

## 6. Run a node

1. Edit the text in the Text node if you want a different prompt.
2. In the Image generation node, open the model dropdown and choose a model. If the dropdown says "No models available yet", open the **Models** page and check that the provider and its models are enabled.
3. Click the node's **Run** button.

The badge on the result frame shows the status: queued, running, done or failed.

"Run all" in the bottom toolbar needs at least one Output node on the canvas. The Text to image template has none, so use the node's own Run button here.

## 7. Results and cost

![A finished run](images/06-editor-result.png)

- The result appears in the node's result frame. Running again never overwrites it: earlier results stay in the node's history.
- The file is copied into your own storage (the `app_data` volume by default), so it does not depend on an upstream link that may expire.
- Next to the Run button the node shows the estimated cost of one run. A new install shows **Cost unknown**, because no prices are configured. Enter the rates you pay on the **Models** page with **Set price** in the row of the model; see [Providers](providers.md#pricing).
- The **History** page lists every run and totals the runs and the estimated cost of the period you pick. The workbench shows this month's totals.

## Accounts

Signing in is always required. Accounts are created by registering in the app; nothing about them is set in `.env`.

**The first account you register is the owner.** There is exactly one owner. Besides working on its own canvases like everybody else, the owner manages the site: whether registration is open, storage, run limits, the site's name, logo and default language, and the list of accounts. These are the sections of **Settings** that only the owner sees. Until the owner exists, whoever opens the instance first can become it, so register right after the first start.

**Other people register themselves.** Each account gets its own private space: its own canvases, assets, brand kits, runs and usage, and its own providers, API keys, models and prices. Nothing is shared between accounts, and there are no teams. To hand a canvas to someone else, publish a share link; the other account can copy it.

| Field | Rules |
| --- | --- |
| Username | 3 to 32 characters from letters, digits, `_` and `-`. Unique without regard to case. |
| Email | Must look like an address and be unused. It is never verified and nothing is sent to it. |
| Password | 8 to 128 characters. |

You sign in with the username or the email. A session lasts 12 hours, or 30 days if you choose to be remembered.

**Closing registration.** Registration is open by default, also after the owner has registered. If the instance is reachable by people who should not have an account, the owner switches **Open sign-up** off under **Settings → Site** (or calls `PUT /api/admin/site`, see [Deployment](deployment.md#accounts)). Existing accounts keep signing in; nobody new can register.

**What the owner can and cannot do.**

- Can, under **Settings → Users**: disable or enable an account, delete an account with everything it owns, reset an account's password. Under **Settings → Site**: close and open registration. And change the other site settings.
- Cannot: read another account's canvases, files or API keys. The list of accounts shows how many canvases and runs each account has, never their content.

**Your own account.** **Settings → Account & security** (also in the menu behind your name in the top bar) is where you change your username, email and password, and where you see your sign-in sessions and sign any of them out. Changing the password signs the account out on every other device.

**Forgotten password.** There is no "forgot password" mail. The owner can reset any other account's password under **Settings → Users** and gets a temporary password to pass on; the owner's own password is reset from the command line by whoever runs the server, with `node server/src/cli/reset-password.js <username-or-email>`. See [Deployment](deployment.md#forgotten-password).

**Coming from an earlier version?** `ACCESS_PASSWORD` is no longer used; remove it from `.env`. The first account you register takes over the data that is already there. See [Deployment](deployment.md#upgrading-from-a-version-without-accounts) before you start the new version.

More on what accounts do and do not protect: [Security](security.md#accounts).

## Next steps

- [User guide](user-guide.md) for everything the canvas can do.
- [Deployment](deployment.md) before you put an instance on the internet.
- [FAQ](faq.md) if something does not work.
