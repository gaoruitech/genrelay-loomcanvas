import { describe, expect, it } from 'vitest'
import { libraryGroupLabelKey, shareButtonLabelKey } from '../src/utils/canvasLabels'
import { resolveFeatures } from '../src/embed/options'
import { i18n, setLocale } from '../src/locales'

/**
 * 功能开关（embed 的 features）关掉一部分之后，画布工具面板上的按钮不能还叫全开时的名字。
 * （options.test.ts 管的是开关本身和教程；这里是编辑器里按开关改名字的那两颗按钮。）
 */
const t = (key: string) => i18n.global.t(key)

/** 素材那一组真会出现哪几项：和 Canvas.vue 的 libraryMenuItems 同一个规则 */
function libraryKeys(f: { assetLibrary: boolean; templates: boolean; share: boolean }, readOnly = false): string[] {
  return ['library', 'templates', 'my-shares'].filter((k) => (k === 'library' ? f.assetLibrary : k === 'templates' ? f.templates && !readOnly : f.share))
}

describe('the assets button of the tool palette', () => {
  it('everything on: "Assets and templates"', () => {
    setLocale('en', false)
    expect(t(libraryGroupLabelKey(libraryKeys({ assetLibrary: true, templates: true, share: true })))).toBe('Assets and templates')
    setLocale('zh-CN', false)
    expect(t(libraryGroupLabelKey(libraryKeys({ assetLibrary: true, templates: true, share: true })))).toBe('素材与模板')
    setLocale('en', false)
  })

  it('templates off: it does not say "templates"', () => {
    const key = libraryGroupLabelKey(libraryKeys({ assetLibrary: true, templates: false, share: true }))
    expect(t(key)).toBe('Asset library')
    expect(t(key)).not.toMatch(/template/i)
  })

  it('read-only hides "apply a template", so the name loses "templates" too', () => {
    expect(libraryGroupLabelKey(libraryKeys({ assetLibrary: true, templates: true, share: true }, true))).toBe('canvas.rail.library')
  })

  it('the asset library off: no "assets" in the name; the single remaining entry names itself', () => {
    expect(libraryGroupLabelKey(libraryKeys({ assetLibrary: false, templates: true, share: false }))).toBe('')
    expect(libraryGroupLabelKey(libraryKeys({ assetLibrary: false, templates: false, share: true }))).toBe('')
    expect(libraryGroupLabelKey([])).toBe('')
  })

  it('the editor entry with its defaults (no product features) offers no such group at all', () => {
    const f = resolveFeatures(undefined, { mode: 'editor' })
    expect(libraryKeys(f)).toEqual([])
  })
})

describe('the share button of the tool palette', () => {
  it('a personal canvas: "Create share link"', () => {
    expect(t(shareButtonLabelKey({ share: true, team: false, readOnly: false }))).toBe('Create share link')
  })

  it('a team canvas with public links on: both tabs, "Sharing and access"', () => {
    expect(t(shareButtonLabelKey({ share: true, team: true, readOnly: false }))).toBe('Sharing and access')
  })

  it('a team canvas with public links off (features.share: false): it is only about team access, and says so', () => {
    const label = t(shareButtonLabelKey({ share: false, team: true, readOnly: false }))
    expect(label).toBe('Team access')
    expect(label).not.toMatch(/share|link/i)
    setLocale('zh-CN', false)
    expect(t(shareButtonLabelKey({ share: false, team: true, readOnly: false }))).toBe('团队权限')
    setLocale('en', false)
  })

  it('read-only says read-only, with or without public links', () => {
    expect(t(shareButtonLabelKey({ share: true, team: true, readOnly: true }))).toBe('Sharing and access (read-only)')
    const off = t(shareButtonLabelKey({ share: false, team: true, readOnly: true }))
    expect(off).toBe('Team access (read-only)')
    expect(off).not.toMatch(/shar/i)
  })
})
