/**
 * PostCSS plugin: confine every rule of every stylesheet (ours, TDesign's, Vue Flow's, scoped SFC
 * styles) to the LoomCanvas root element.
 *
 *   :root                 ->  .lc-root                    (same specificity: 0,1,0)
 *   html / body (leading) ->  .lc-root
 *   anything else         ->  :where(.lc-root) <selector> (specificity unchanged)
 *
 * In the stand-alone app `.lc-root` is <html>, so nothing changes there. When LoomCanvas is mounted
 * inside a host page, `.lc-root` is the mount root: no rule can match a host element, and the design
 * tokens / TDesign tokens live on the mount root instead of on the host's <html>.
 *
 * Not touched: selectors that already mention `.lc-root`, keyframe steps, `::view-transition-*`
 * (document-wide by nature), and files whose first comment contains `lc-scope: off`
 * (src/styles/standalone.css). `@font-face` and `@keyframes` NAMES stay global: CSS has no scope
 * for them (see docs/integration.md, "Style isolation").
 *
 * Option `containerTwins` (library build only): every `@media (max-width: Npx)` block gets a twin
 * `@container lc-root (max-width: Npx)` that applies when LoomCanvas is embedded. The responsive
 * layouts then follow the size of the mount root instead of the size of the browser window: a
 * 480px-wide box in a wide page gets the phone layout. The stand-alone build leaves it off, so its
 * stylesheet is byte-for-byte what the media queries say.
 */
export const ROOT = '.lc-root'

/** Split a selector list at top-level commas (commas inside (), [] and strings do not count). */
export function splitSelectors(list) {
  const out = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]
    if (quote) {
      cur += ch
      if (ch === '\\') { cur += list[++i] ?? ''; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

export function scopeSelector(selector, root = ROOT) {
  let s = selector.trim()
  if (!s) return s
  if (s.startsWith('::view-transition')) return s
  // Vue's `:global(x)` (scoped SFC styles) is unwrapped after this plugin ran: scope what is inside.
  const global = /^:global\(([\s\S]*)\)$/.exec(s)
  if (global) return `:global(${scopeSelector(global[1], root)})`
  s = s.replace(/:root(?![-\w])/g, root)
  // `html` / `body` as the leading type selector stand for "the page": that is the root now.
  if (/^html\s+body(?![-\w])/.test(s)) s = s.replace(/^html\s+body/, root)
  else if (/^(html|body)(?![-\w])/.test(s)) s = s.replace(/^(html|body)/, root)
  if (s.includes(root)) return s
  return `:where(${root}) ${s}`
}

/** Name of the size container the embedded root establishes (src/styles/base.css). */
export const CONTAINER = 'lc-root'
const EMBEDDED = '.lc-embedded'
const WIDTH_QUERY = /^\(\s*max-width\s*:\s*[\d.]+px\s*\)$/

/** A scoped selector, narrowed to "only when embedded". */
export function embeddedSelector(selector, root = ROOT) {
  const where = `:where(${root})`
  if (selector.startsWith(where)) return `:where(${root}${EMBEDDED})${selector.slice(where.length)}`
  // The selector names the root itself: the first mention becomes the embedded root.
  return selector.replace(root, `${root}${EMBEDDED}`)
}

export default function scopeToRoot(options = {}) {
  const root = options.root || ROOT
  return {
    postcssPlugin: 'loomcanvas-scope-to-root',
    Once(css) {
      const first = css.first
      if (first && first.type === 'comment' && /lc-scope:\s*off/.test(first.text)) return
      css.walkRules((rule) => {
        const parent = rule.parent
        if (parent && parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return
        rule.selector = splitSelectors(rule.selector).map((s) => scopeSelector(s, root)).join(', ')
      })
      if (!options.containerTwins) return
      const medias = []
      css.walkAtRules('media', (at) => { if (WIDTH_QUERY.test(at.params.trim())) medias.push(at) })
      for (const at of medias) {
        const twin = at.clone({ name: 'container', params: `${CONTAINER} ${at.params.trim()}` })
        twin.walkRules((rule) => {
          rule.selector = splitSelectors(rule.selector).map((s) => embeddedSelector(s, root)).join(', ')
        })
        at.after(twin)
      }
    },
  }
}
scopeToRoot.postcss = true
