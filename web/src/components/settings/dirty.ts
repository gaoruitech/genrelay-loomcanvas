import { inject, onBeforeUnmount, provide, ref, type InjectionKey, type Ref } from 'vue'

type Probe = () => boolean
const KEY: InjectionKey<(probe: Probe) => () => void> = Symbol('settings-dirty')

/** 设置页：收集当前分区「有没有没保存的修改」，切换分区 / 离开页面前问一句 */
export function provideSectionDirty() {
  const probes = new Set<Probe>()
  provide(KEY, (probe) => {
    probes.add(probe)
    return () => { probes.delete(probe) }
  })
  return { isDirty: () => [...probes].some(p => p()) }
}

/** 有明确「保存」的分区：告诉设置页自己此刻有没有改了没存的东西 */
export function useSectionDirty(probe: Probe) {
  const register = inject(KEY, null)
  if (!register) return
  onBeforeUnmount(register(probe))
}

const BAR_KEY: InjectionKey<(px: number) => void> = Symbol('settings-savebar-space')

/**
 * 设置页：贴在视口底部的那条保存栏（SaveBar）此刻挡住多高。设置页把它写成滚动容器的 scroll-padding-bottom，
 * 这样用 Tab 走到视口最底下的那一格时，浏览器会把它滚到保存栏上面，而不是停在保存栏后面。
 */
export function provideSaveBarSpace(): Ref<number> {
  const space = ref(0)
  provide(BAR_KEY, (px) => { space.value = px })
  return space
}

/** 保存栏：把自己占的高度（连同它离底边的那一段）报给设置页；不在设置页里时什么也不做 */
export function useSaveBarSpace(): (px: number) => void {
  return inject(BAR_KEY, null) || (() => undefined)
}
