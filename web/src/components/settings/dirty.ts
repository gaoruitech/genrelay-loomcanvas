import { inject, onBeforeUnmount, provide, type InjectionKey } from 'vue'

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
