// The host product's own script. It signs the user in ITS way, then mounts LoomCanvas with the
// headers of that session. Nothing here is LoomCanvas code except the one import.
//
// `standalone/app.js` has Vue inside, so a page without a bundler can import it as it is.
// With a bundler, import 'loomcanvas-web/app' instead (Vue is then a peer dependency).
import { mountLoomCanvas } from '/lib/standalone/app.js'

// Where the LoomCanvas-compatible API lives. Another origin here: the server must list this page's
// origin in CORS_ORIGIN. Override with ?api=https://canvas.example.com/api
const QUERY = new URLSearchParams(location.search)
const API = QUERY.get('api') || 'http://127.0.0.1:3000/api'
// How in-app navigation shows in the address bar: 'memory' (not at all, the default when embedded),
// 'hash' (#/canvases) or 'history' (real paths under basePath; your server must then serve this page for them).
const ROUTER = QUERY.get('router') || 'memory'

const $ = (id) => document.getElementById(id)
const log = (line) => { const el = $('acme-log'); el.textContent += line + '\n'; el.scrollTop = el.scrollHeight }

/** The host's session. In memory only: LoomCanvas stores no token of its own in this mode. */
let session = null
let lc = null
let lc2 = null
let theme = 'dark'
let locale = 'en'
let currentPage = ''
/** The LoomCanvas space the embedded app is pinned to: 'personal' or the id of a team the user is in. */
let space = QUERY.get('space') || 'personal'

/**
 * The host's sign-in.
 *
 * In a real product this happens on YOUR server: your backend authenticates your user and obtains
 * whatever the canvas API in front of it expects (with the stock LoomCanvas server: a session token
 * for the LoomCanvas account you mapped that user to, e.g. from POST /api/auth/login made
 * server-side, or a gateway that injects the header). The page only ever sees the result.
 * To keep the example self-contained, the exchange is done here in the browser.
 */
async function hostSignIn(user, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: user, password, remember: false }),
  })
  const body = await res.json()
  if (body.result !== 0) throw new Error(body.message || 'Sign-in failed')
  return { token: body.data.token, name: body.data.user.username }
}

/**
 * The teams the signed-in account is a member of. In a real product you would map YOUR organisations /
 * workspaces to LoomCanvas teams on your server; the page only needs the id of the one to work in.
 */
async function hostTeams() {
  const res = await fetch(`${API}/teams`, { headers: { Authorization: `Bearer ${session.token}` } })
  const body = await res.json()
  return body.result === 0 ? body.data.teams.filter((t) => t.status === 'active') : []
}

const options = () => ({
  apiBase: API,
  // Your authentication: called before every request, may be async (refresh a token here).
  getAuth: () => ({ Authorization: `Bearer ${session.token}` }),
  // The API said 401: your session is gone. Do what your product does; here, back to the form.
  onAuthRequired: () => { log('onAuthRequired'); signOut('Your session expired. Sign in again.') },
  user: { name: `${session.name} @ Acme` },
  routerMode: ROUTER,
  basePath: location.pathname,
  // The host provides the header and the navigation.
  shell: 'none',
  // Only these pages exist for the user of this product.
  pages: ['canvases', 'canvas', 'assets', 'brand-kits'],
  // Pin the app to one space: canvases, assets, models and keys are that space's. Without `space`
  // (and with LoomCanvas' own shell) the user would switch spaces in the top bar.
  space,
  // Membership is managed elsewhere in this product: no Team page inside the embedded app.
  features: { share: false, guide: false, themeSwitch: false, localeSwitch: false, nodeLayoutSwitch: false, teamAdmin: false },
  theme,
  locale,
  brand: { name: 'Acme Boards' },
  messages: { en: { views: { list: { title: 'Boards' } } } },
  // Keep LoomCanvas' browser storage apart from anything else on this origin.
  storagePrefix: 'acme-canvas-',
  onNavigate: (route) => { currentPage = route.name; log(`onNavigate ${route.name} ${route.path}`) },
})

function mount() {
  $('acme-login').hidden = true
  $('acme-nav').hidden = false
  $('acme-canvas').hidden = false
  lc = mountLoomCanvas($('acme-canvas'), options())
  for (const name of ['ready', 'space', 'canvas:saved', 'run:started', 'run:finished', 'run:failed', 'result', 'error']) {
    lc.on(name, (payload) => log(`${name} ${JSON.stringify(payload).slice(0, 160)}`))
  }
  // For the test script and for poking around in the console.
  window.acme = { lc, get lc2() { return lc2 } }
}

function signOut(message = '') {
  lc?.unmount(); lc = null
  lc2?.unmount(); lc2 = null
  session = null
  $('acme-canvas').hidden = true
  $('acme-canvas-2').hidden = true
  $('acme-nav').hidden = true
  $('acme-login').hidden = false
  $('acme-login-msg').textContent = message
}

$('acme-login').addEventListener('submit', async (e) => {
  e.preventDefault()
  $('acme-login-msg').textContent = ''
  try {
    session = await hostSignIn($('acme-user').value, $('acme-pass').value)
    // Offer the user's teams in the host's own navigation.
    const teams = await hostTeams().catch(() => [])
    $('acme-space').replaceChildren(new Option('Personal', 'personal'), ...teams.map((t) => new Option(`Team: ${t.name}`, t.id)))
    if (space !== 'personal' && !teams.some((t) => t.id === space)) space = 'personal'
    $('acme-space').value = space
    mount()
  } catch (err) {
    $('acme-login-msg').textContent = err.message
  }
})

$('acme-nav').addEventListener('click', (e) => {
  const page = e.target.dataset?.go
  // navigate() to a page outside `pages` is cancelled: the user stays where they are.
  if (page) lc.navigate(page).catch((err) => log(`navigate failed: ${err.message}`))
})
$('acme-space').addEventListener('change', (e) => {
  // The space is fixed per mount: to work in another one, mount again.
  space = e.target.value
  log(`space -> ${space}`)
  lc?.unmount(); lc2?.unmount(); lc2 = null
  $('acme-canvas-2').hidden = true
  mount()
})
$('acme-theme').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark'
  lc.setTheme(theme)
  $('acme-theme').textContent = `Theme: ${theme}`
})
$('acme-locale').addEventListener('click', () => {
  locale = locale === 'en' ? 'zh-CN' : 'en'
  lc.setLocale(locale)
  $('acme-locale').textContent = `Language: ${locale}`
})
$('acme-narrow').addEventListener('click', () => $('acme-canvas').classList.toggle('narrow'))
$('acme-second').addEventListener('click', () => {
  // A second view of the same runtime (same API, same session) on one page: its own navigation and state.
  if (lc2) { lc2.unmount(); lc2 = null; $('acme-canvas-2').hidden = true; return }
  $('acme-canvas-2').hidden = false
  // (The second one keeps the address bar out of it: two views cannot both own the URL.)
  lc2 = mountLoomCanvas($('acme-canvas-2'), { ...options(), routerMode: 'memory', initialPage: 'assets', onNavigate: (r) => log(`#2 onNavigate ${r.name}`) })
})
$('acme-expire').addEventListener('click', () => {
  session.token = 'expired'
  log('token replaced with garbage; the next API call answers 401')
  // Any page that loads data will do.
  lc.navigate(currentPage === 'assets' ? 'canvases' : 'assets')
})
$('acme-logout').addEventListener('click', () => signOut())
