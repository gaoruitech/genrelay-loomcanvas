# host-page: the whole app inside your page

Shape 1 of [docs/integration.md](../../docs/integration.md): `mountLoomCanvas(el, options)` in a plain HTML page, no framework and no bundler (it imports `dist-lib/standalone/app.js`, which has Vue inside).

Run it as described in [../README.md](../README.md), then open `http://127.0.0.1:4173/host-page/`.

What to look at in `main.js`:

- `hostSignIn()` is the host's own sign-in. LoomCanvas' sign-in page never appears; `getAuth` hands the host's session to every request, and `onAuthRequired` brings the host's form back when the API answers 401 ("Expire my session" provokes that).
- `shell: 'none'`: the red header and its buttons are the host's; they drive LoomCanvas through `lc.navigate()`, `lc.setTheme()`, `lc.setLocale()`.
- `pages: ['canvases', 'canvas', 'assets', 'brand-kits']`: the "Models" button asks for a page outside the list and nothing happens.
- `features`, `brand`, `messages` (the list is titled "Boards"), `storagePrefix`.
- "Second instance" mounts another view of the same runtime in a second box.
- "Narrow box" shrinks the box to 520 px: the layout follows the box, not the window.
- `?router=hash` puts navigation into the address bar (`#/canvas/<id>`), so deep links and the back button work.

What to look at in `index.html`: the host's stylesheet uses `* { box-sizing: content-box }`, `button { all: revert }`, `a { color: red }` and a 20 px serif base font. Neither side disturbs the other; the limits of that are listed under "Style isolation" in the guide.

The Events box at the bottom prints what the host receives (`ready`, `route`, `canvas:saved`, `run:*`, `result`, `error`).
