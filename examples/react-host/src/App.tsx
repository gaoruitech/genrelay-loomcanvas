// "My React product": a host application that builds the LoomCanvas editor in, three ways.
//
//   memory   <LoomCanvasEditor> (mountEditor in an effect) + createMemoryAdapter: no server at all
//   http     the same component + createHttpAdapter: a stock LoomCanvas server on another origin
//   element  the custom element <loom-canvas-editor> written in JSX (memory adapter)
//   minimal  the short snippet printed in docs/integration.md, as it is (MinimalEditor.tsx)
//
// Everything on this page outside the bordered box is the host's own React UI.
import { useCallback, useMemo, useRef, useState } from 'react'
import { createHttpAdapter, createMemoryAdapter, VERSION } from 'loomcanvas-web/standalone/editor'
import type {
  LoomCanvasEditorOptions, LoomCanvasFeatures, LoomCanvasLocale, LoomCanvasNodeLayout, LoomCanvasTheme,
} from 'loomcanvas-web/standalone/editor'
import { LoomCanvasEditor, type EditorEventHandlers, type LoomCanvasEditorRef } from './LoomCanvasEditor'
import { LoomCanvasElement, type LoomCanvasEditorElement } from './LoomCanvasElement'
import { Canvas } from './MinimalEditor'
import { sample } from './sample'

type Mode = 'memory' | 'http' | 'element' | 'minimal'
const MODES: { id: Mode; label: string }[] = [
  { id: 'memory', label: 'Component · memory adapter' },
  { id: 'http', label: 'Component · HTTP adapter' },
  { id: 'element', label: 'Custom element' },
  { id: 'minimal', label: 'Minimal snippet' },
]

const QUERY = new URLSearchParams(location.search)
// Where the LoomCanvas API lives (HTTP adapter). Another origin: the server must list this page's origin in CORS_ORIGIN.
const API = QUERY.get('api') || import.meta.env.VITE_LC_API || 'http://127.0.0.1:3000/api'
const START = (MODES.find((m) => m.id === QUERY.get('mode')) || MODES[0]).id
// The LoomCanvas space the HTTP adapter works in: 'personal', or the id of a team the account is in (?space=<team id>).
const SPACE = QUERY.get('space') || 'personal'

// One adapter object for the whole life of the page: a new object would mount the editor again.
const memory = createMemoryAdapter({ runMs: 1500 })

/** The switches an editor host can set. The first group is on by default, the second is off. */
const CHROME = ['palette', 'queue', 'minimap', 'titleBar', 'canvasStyle', 'imageEditor', 'search'] as const
const OPT_IN = [
  'cost', 'templates', 'assetLibrary', 'brandKit', 'share', 'batchRun', 'batchDownload', 'canvasSwitch', 'guide',
  'modelManagement', 'nodeLayoutSwitch', 'themeSwitch', 'localeSwitch',
] as const
type Flag = (typeof CHROME)[number] | (typeof OPT_IN)[number]
const DEFAULT_FEATURES = Object.fromEntries([...CHROME.map((k) => [k, true]), ...OPT_IN.map((k) => [k, false])]) as Record<Flag, boolean>

interface CanvasRow { id: string; name: string }
interface Stats { ready: boolean; nodes: number; edges: number; selected: number; saved: string }
const NO_STATS: Stats = { ready: false, nodes: 0, edges: 0, selected: 0, saved: '' }

export function App() {
  const [mode, setMode] = useState<Mode>(START)
  const [shown, setShown] = useState(true)
  const [theme, setTheme] = useState<LoomCanvasTheme>('dark')
  const [locale, setLocale] = useState<LoomCanvasLocale>('en')
  const [nodeLayout, setNodeLayout] = useState<LoomCanvasNodeLayout>('a')
  const [readOnly, setReadOnly] = useState(false)
  const [features, setFeatures] = useState(DEFAULT_FEATURES)
  const [stats, setStats] = useState<Stats>(NO_STATS)
  const [lines, setLines] = useState<string[]>([])

  // The host's own session with its backend (HTTP mode).
  const [token, setToken] = useState('')
  const [account, setAccount] = useState('admin')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [canvases, setCanvases] = useState<CanvasRow[]>([])
  const [canvasId, setCanvasId] = useState('')

  const editorRef = useRef<LoomCanvasEditorRef>(null)
  const elementRef = useRef<LoomCanvasEditorElement>(null)
  /** The imperative methods, whichever way the editor was mounted. */
  const editor = () => (mode === 'element' ? elementRef.current?.editor : editorRef.current) || null

  const log = useCallback((line: string) => setLines((prev) => [...prev.slice(-80), line]), [])
  const remount = (change: () => void) => { setStats(NO_STATS); change() }

  // Editor events become React state.
  const on: EditorEventHandlers = {
    ready: (p) => {
      const doc = editor()?.getDocument()
      setStats((s) => ({ ...s, ready: true, nodes: doc?.nodes.length ?? 0, edges: doc?.edges.length ?? 0 }))
      log(`ready ${JSON.stringify(p)}`)
    },
    change: ({ document }) => {
      setStats((s) => ({ ...s, nodes: document.nodes.length, edges: document.edges.length }))
      log(`change: ${document.nodes.length} nodes, ${document.edges.length} edges`)
    },
    selection: ({ nodeIds }) => setStats((s) => ({ ...s, selected: nodeIds.length })),
    saved: ({ updatedAt }) => { setStats((s) => ({ ...s, saved: updatedAt })); log(`saved ${updatedAt}`) },
    created: (p) => { log(`created ${JSON.stringify(p)}`); void listCanvases().then(setCanvases) },
    'run:started': (p) => log(`run:started ${p.nodeId}`),
    'run:finished': (p) => log(`run:finished ${p.nodeId}`),
    'run:failed': (p) => log(`run:failed ${p.nodeId}: ${p.error}`),
    result: (p) => log(`result ${p.nodeId}: ${p.outputs.length} output(s)${p.text ? ', text' : ''}`),
    error: (p) => log(`error [${p.scope}] ${p.message}`),
  }

  /* ---------- HTTP mode: the host talks to its backend itself ---------- */

  const tokenRef = useRef(token)
  tokenRef.current = token
  const call = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(API + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}),
        // The host's own calls name the space the same way the adapter does.
        ...(SPACE !== 'personal' ? { 'X-Space': SPACE } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const out = await res.json()
    if (out.result !== 0) throw new Error(out.message || `HTTP ${res.status}`)
    return out.data as T
  }
  const listCanvases = () => call<CanvasRow[]>('GET', '/workflow/list')

  // One adapter per session, and it keeps the token of ITS session: when the user signs out the editor
  // is unmounted, and the save it sends on the way out must still be authenticated. (`getAuth` is asked
  // before every request: a host that refreshes its token keeps one adapter and returns the newest one.)
  // An adapter belongs to one space; in a team space it also takes the edit lock and sends revision-checked saves.
  const http = useMemo(() => (token ? createHttpAdapter({
    apiBase: API,
    space: SPACE,
    getAuth: () => ({ Authorization: `Bearer ${token}` }),
    onAuthRequired: () => { setMessage('Session expired'); setToken('') },
  }) : null), [token])

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setMessage('')
    try {
      // In a real product your backend does this exchange (docs/integration.md, "Authentication").
      const { token: t } = await call<{ token: string }>('POST', '/auth/login', { account, password, remember: false })
      tokenRef.current = t
      // Which canvases exist is the host's business: the editor edits one.
      let rows = await listCanvases()
      if (!rows.length) rows = [await call<CanvasRow>('POST', '/workflow', { name: 'From the React host' })]
      setCanvases(rows)
      setCanvasId((rows.find((r) => r.id === QUERY.get('canvas')) || rows[0]).id)
      setToken(t)
    } catch (err) {
      setMessage((err as Error).message)
    }
  }
  async function newCanvas() {
    const created = await call<CanvasRow>('POST', '/workflow', { name: `Canvas ${canvases.length + 1}` })
    setCanvases([created, ...canvases])
    setStats(NO_STATS)
    setCanvasId(created.id)
  }

  /* ---------- the custom element: everything read at mount, in one stable object ---------- */

  const featuresKey = JSON.stringify(features)
  const elementOptions = useMemo<LoomCanvasEditorOptions>(() => ({
    adapter: memory,
    document: sample,
    features: JSON.parse(featuresKey) as Partial<LoomCanvasFeatures>,
    changeDebounceMs: 600,
    storagePrefix: 'react-host-',
  }), [featuresKey])

  /* ---------- the host's toolbar ---------- */

  const act = (name: string, fn: () => unknown) => () => {
    try {
      const out = fn()
      if (typeof out === 'string') log(`${name} -> ${out}`)
    } catch (err) {
      log(`${name} failed: ${(err as Error).message}`)
    }
  }
  // `position` is in canvas coordinates; without it the editor picks a free spot in view.
  const addText = () => editor()?.addNode('text', { text: 'Added by the React host' }, { x: 40 + stats.nodes * 24, y: 460 + stats.nodes * 24 })
  const mounted = shown && (mode !== 'http' || (!!http && !!canvasId))
  // The minimal snippet passes nothing but the document: theme, language and the switches do not reach it.
  const fixed = mode === 'minimal'

  return (
    <div className="host">
      <header className="host-head">
        <b>My React product</b>
        <nav className="host-tabs" aria-label="Integration">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={m.id === mode ? 'on' : ''} data-testid={`mode-${m.id}`} onClick={() => remount(() => setMode(m.id))}>
              {m.label}
            </button>
          ))}
        </nav>
        <span className="host-version">loomcanvas-web {VERSION}</span>
        {mode === 'http' && token && <button type="button" className="host-out" data-testid="signout" onClick={() => remount(() => setToken(''))}>Sign out</button>}
      </header>

      <div className="host-bar">
        <label>Theme
          <select data-testid="theme" disabled={fixed} value={theme} onChange={(e) => setTheme(e.target.value as LoomCanvasTheme)}>
            <option value="dark">dark</option><option value="light">light</option><option value="system">system</option>
          </select>
        </label>
        <label>Language
          <select data-testid="locale" disabled={fixed} value={locale} onChange={(e) => setLocale(e.target.value as LoomCanvasLocale)}>
            <option value="en">en</option><option value="zh-CN">zh-CN</option>
          </select>
        </label>
        <label>Node layout
          <select data-testid="layout" disabled={fixed} value={nodeLayout} onChange={(e) => setNodeLayout(e.target.value as LoomCanvasNodeLayout)}>
            <option value="a">a</option><option value="b">b</option><option value="c">c</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" data-testid="readonly" disabled={fixed} checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> read-only</label>
        <label className="check"><input type="checkbox" data-testid="shown" checked={shown} onChange={(e) => remount(() => setShown(e.target.checked))} /> mounted</label>
        <span className="host-sep" />
        <button type="button" data-testid="add" disabled={!stats.ready} onClick={act('addNode', addText)}>addNode</button>
        <button type="button" data-testid="run" disabled={!stats.ready} onClick={act('runAll', () => { void editor()?.runAll() })}>runAll</button>
        <button type="button" data-testid="undo" disabled={!stats.ready} onClick={act('undo', () => editor()?.undo())}>undo</button>
        <button type="button" data-testid="redo" disabled={!stats.ready} onClick={act('redo', () => editor()?.redo())}>redo</button>
        <button type="button" data-testid="fit" disabled={!stats.ready} onClick={act('fitView', () => editor()?.fitView())}>fitView</button>
        {mode === 'http' && token && (
          <>
            <span className="host-sep" />
            <label>Canvas
              <select data-testid="canvas" value={canvasId} onChange={(e) => { setStats(NO_STATS); setCanvasId(e.target.value) }}>
                {canvases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button type="button" data-testid="new" onClick={() => void newCanvas().catch((err) => log(`new canvas failed: ${err.message}`))}>New canvas</button>
          </>
        )}
      </div>

      <main className="host-main">
        {/* The editor fills its parent: this box decides the size. */}
        <section className="host-box" data-testid="box">
          {mode === 'http' && !token && (
            <form className="host-sign" onSubmit={signIn}>
              <h2>Sign in to my product</h2>
              <p>The host signs in its own way, then hands the session to the editor's adapter. API: <code>{API}</code>{SPACE !== 'personal' && <> · space <code>{SPACE}</code></>}</p>
              <p>
                <input data-testid="account" value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="username" aria-label="Account" />
                <input data-testid="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="Password" />
                <button data-testid="signin">Sign in</button>
              </p>
              <p className="host-error" role="alert">{message}</p>
            </form>
          )}
          {mounted && mode === 'memory' && (
            <LoomCanvasEditor
              ref={editorRef}
              adapter={memory}
              document={sample}
              theme={theme}
              locale={locale}
              nodeLayout={nodeLayout}
              readOnly={readOnly}
              features={features}
              changeDebounceMs={600}
              storagePrefix="react-host-"
              on={on}
            />
          )}
          {mounted && mode === 'http' && http && (
            // `canvasId` is a live prop too (the component calls `setCanvasId`), but the editor announces
            // `ready` once per mount. This host wants a "loaded" signal for every canvas, so it gives each
            // canvas its own editor instance with `key`.
            <LoomCanvasEditor
              key={canvasId}
              ref={editorRef}
              adapter={http}
              canvasId={canvasId}
              theme={theme}
              locale={locale}
              nodeLayout={nodeLayout}
              readOnly={readOnly}
              features={features}
              changeDebounceMs={600}
              storagePrefix="react-host-"
              on={on}
            />
          )}
          {mounted && mode === 'element' && (
            <LoomCanvasElement
              elementRef={elementRef}
              options={elementOptions}
              theme={theme}
              locale={locale}
              nodeLayout={nodeLayout}
              readOnly={readOnly}
              on={on}
            />
          )}
          {mounted && mode === 'minimal' && (
            // No handle, no events: the document comes back through onChange only (the toolbar above stays off).
            <Canvas
              document={sample}
              onChange={(doc) => {
                setStats((s) => ({ ...s, nodes: doc.nodes.length, edges: doc.edges.length }))
                log(`onChange: ${doc.nodes.length} nodes, ${doc.edges.length} edges`)
              }}
            />
          )}
          {!shown && <p className="host-empty">The editor is unmounted. Tick "mounted" to mount it again.</p>}
        </section>

        <aside className="host-side">
          <h3>React state fed by editor events</h3>
          <dl className="host-state" data-testid="state">
            <dt>ready</dt><dd data-testid="s-ready">{String(stats.ready)}</dd>
            <dt>nodes</dt><dd data-testid="s-nodes">{stats.nodes}</dd>
            <dt>edges</dt><dd data-testid="s-edges">{stats.edges}</dd>
            <dt>selected</dt><dd data-testid="s-selected">{stats.selected}</dd>
            {mode === 'http' && <><dt>saved</dt><dd data-testid="s-saved">{stats.saved ? new Date(stats.saved).toLocaleTimeString() : '-'}</dd></>}
          </dl>

          <h3>Feature switches <small>(changing one mounts the editor again)</small></h3>
          <div className="host-flags">
            {[CHROME, OPT_IN].map((group, i) => (
              <fieldset key={i}>
                <legend>{i === 0 ? 'Editor chrome (on by default)' : 'Opt-in (need the adapter to support them)'}</legend>
                {group.map((k) => (
                  <label key={k} className="check">
                    <input type="checkbox" data-testid={`flag-${k}`} disabled={fixed} checked={features[k]} onChange={(e) => remount(() => setFeatures({ ...features, [k]: e.target.checked }))} /> {k}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>

          <h3>Events</h3>
          <pre className="host-log" data-testid="log">{lines.join('\n')}</pre>
        </aside>
      </main>
    </div>
  )
}
