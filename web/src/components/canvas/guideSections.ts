/**
 * 教程抽屉里出哪些章节、每章出哪几条 —— 按这次挂载开着的功能筛。
 *
 * 教程写的是整个产品；集成方关掉一项功能（embed/types.ts 的 LoomCanvasFeatures）之后，
 * 讲那项功能的章节和条目也得跟着收起来，不然教程会教人去点一个不存在的按钮。
 * 文案在 locales/modules/library.ts 的 guide.sections 下，两种语言是同一棵键树、条目一一对应，
 * 所以这里按「章节 id + 第几条」写要求。一条只讲一件事（改文案时别把两项功能揉进同一条）。
 *
 * 纯函数、不碰 DOM：test/options.test.ts 里有一组测试守着它（条目数两种语言一致、表里的下标都存在、
 * 关掉某项功能之后剩下的英文里不再出现它的名字）。
 */
import type { LoomCanvasFeatures } from '@/embed/types'

export type GuideFeature = keyof LoomCanvasFeatures

/** 章节顺序 */
export const GUIDE_SECTION_IDS = [
  'start', 'models', 'ui', 'basic', 'nodes', 'source', 'gen', 'cost', 'run', 'tools',
  'link', 'brand', 'group', 'layout', 'lib', 'share', 'team', 'view', 'keys', 'faq',
] as const
export type GuideSectionId = typeof GUIDE_SECTION_IDS[number]

/** 整章只讲一项功能：那项功能关了，整章不出 */
export const GUIDE_SECTION_NEEDS: Partial<Record<GuideSectionId, GuideFeature[]>> = {
  models: ['modelManagement'],
  cost: ['cost'],
  brand: ['brandKit'],
  share: ['share'],
}

/** 这一章讲的是几项功能里的任意一项：全都关了才不出 */
export const GUIDE_SECTION_ANY: Partial<Record<GuideSectionId, GuideFeature[]>> = {
  lib: ['assetLibrary', 'templates', 'share'],
  // 团队空间（可见范围、编辑锁、接管、保存冲突）和回收站：只有画布、没有空间也没有团队页的挂载（编辑器入口）里不出
  team: ['spaceSwitch', 'teamAdmin'],
}

/** 某一条要哪些功能都开着才出（下标从 0 起，对着 library.ts 里的 items） */
export const GUIDE_ITEM_NEEDS: Partial<Record<GuideSectionId, Record<number, GuideFeature[]>>> = {
  start: { 0: ['modelManagement'], 1: ['templates'], 4: ['assetLibrary'] },
  models: { 3: ['cost'] },
  ui: {
    0: ['titleBar'], 1: ['titleBar', 'brandKit'], 2: ['palette'], 3: ['palette', 'assetLibrary', 'templates', 'share'],
    4: ['palette'], 6: ['minimap'], 7: ['queue'],
  },
  source: { 1: ['templates'], 3: ['assetLibrary'], 4: ['imageEditor'] },
  gen: { 8: ['nodeLayoutSwitch'] },
  run: { 1: ['batchDownload'], 4: ['batchRun'] },
  brand: { 3: ['cost'], 6: ['share'] },
  lib: { 1: ['assetLibrary'], 2: ['templates'], 3: ['share'], 4: ['assetLibrary'] },
  team: { 0: ['spaceSwitch'] },
  view: { 0: ['canvasStyle'], 1: ['canvasStyle', 'share'], 3: ['immersive'], 4: ['batchDownload'] },
  keys: { 3: ['search'] },
  faq: { 0: ['modelManagement'], 1: ['cost'], 2: ['cost', 'modelManagement'], 5: ['cost'] },
}

type Flags = Partial<Record<GuideFeature, boolean>>
const on = (features: Flags, needs: GuideFeature[] | undefined) => !needs || needs.every((k) => !!features[k])

/** 这一章出不出 */
export function guideSectionVisible(id: GuideSectionId, features: Flags): boolean {
  if (!on(features, GUIDE_SECTION_NEEDS[id])) return false
  const any = GUIDE_SECTION_ANY[id]
  return !any || any.some((k) => !!features[k])
}

/** 这一章里留下哪几条（返回原来的下标，顺序不变） */
export function guideItemIndexes(id: GuideSectionId, count: number, features: Flags): number[] {
  const needs = GUIDE_ITEM_NEEDS[id] || {}
  const out: number[] = []
  for (let i = 0; i < count; i++) if (on(features, needs[i])) out.push(i)
  return out
}
