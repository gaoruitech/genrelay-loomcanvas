// @vitest-environment node
import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import scopeToRoot, { scopeSelector, splitSelectors } from '../build/scope-to-root.mjs'

const run = async (css: string) => (await postcss([scopeToRoot()]).process(css, { from: undefined })).css

describe('scope-to-root', () => {
  it('moves page-level selectors onto the root', () => {
    expect(scopeSelector(':root')).toBe('.lc-root')
    expect(scopeSelector(":root[theme-mode='dark']")).toBe(".lc-root[theme-mode='dark']")
    expect(scopeSelector('html')).toBe('.lc-root')
    expect(scopeSelector('body')).toBe('.lc-root')
    expect(scopeSelector('html body')).toBe('.lc-root')
    expect(scopeSelector('html .t-dialog')).toBe('.lc-root .t-dialog')
    expect(scopeSelector('body.dark .x')).toBe('.lc-root.dark .x')
  })

  it('confines everything else without changing its specificity', () => {
    expect(scopeSelector('.btn:hover')).toBe(':where(.lc-root) .btn:hover')
    expect(scopeSelector('*')).toBe(':where(.lc-root) *')
    expect(scopeSelector('::selection')).toBe(':where(.lc-root) ::selection')
    expect(scopeSelector('.a[data-v-1] > .b')).toBe(':where(.lc-root) .a[data-v-1] > .b')
    // not the element names html / body: words that merely start with them
    expect(scopeSelector('body-cell')).toBe(':where(.lc-root) body-cell')
    expect(scopeSelector('.html')).toBe(':where(.lc-root) .html')
  })

  it('leaves alone what already names the root, and document-wide pseudo-elements', () => {
    expect(scopeSelector('.lc-root.lc-embedded > .lc-app')).toBe('.lc-root.lc-embedded > .lc-app')
    expect(scopeSelector('::view-transition-old(root)')).toBe('::view-transition-old(root)')
  })

  it("scopes inside Vue's :global()", () => {
    expect(scopeSelector(':global(.vue-flow .h-top)')).toBe(':global(:where(.lc-root) .vue-flow .h-top)')
  })

  it('splits selector lists at top-level commas only', () => {
    expect(splitSelectors('a, b:is(.x, .y), [data-x="1,2"] c')).toEqual(['a', 'b:is(.x, .y)', '[data-x="1,2"] c'])
  })

  it('rewrites rules, including those inside @media, but not keyframe steps or @font-face', async () => {
    const out = await run([
      ':root, .lc-theme-dark { --a: 1 }',
      '@media (max-width: 600px) { .x, .y { color: red } }',
      '@keyframes spin { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }',
      "@font-face { font-family: 'F'; src: url(f.woff2) }",
    ].join('\n'))
    expect(out).toContain('.lc-root, :where(.lc-root) .lc-theme-dark { --a: 1 }')
    expect(out).toContain(':where(.lc-root) .x, :where(.lc-root) .y { color: red }')
    expect(out).toContain('@keyframes spin { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }')
    expect(out).toContain("@font-face { font-family: 'F'; src: url(f.woff2) }")
  })

  it('skips a file that opts out', async () => {
    const css = '/* lc-scope: off */\nhtml, body { height: 100% }'
    expect(await run(css)).toBe(css)
  })

  it('no rule of the application stylesheets can match outside the root', async () => {
    const { readFileSync } = await import('node:fs')
    for (const file of ['src/styles/base.css', 'src/styles/design-tokens.css', 'src/styles/vue-flow-theme.css']) {
      const root = postcss.parse(await run(readFileSync(file, 'utf8')))
      const loose: string[] = []
      root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/.test((rule.parent as any).name)) return
        for (const s of splitSelectors(rule.selector)) if (!s.includes('.lc-root')) loose.push(s)
      })
      expect(loose, file).toEqual([])
    }
  })
})
