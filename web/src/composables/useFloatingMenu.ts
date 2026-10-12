import { frameOf } from '@/utils/frame'
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type CSSProperties, type Ref } from 'vue'

/**
 * 下拉菜单的弹层逻辑：ChipSelect（画布节点上的小下拉）与 LcSelect（表单下拉）共用。
 *
 * 菜单 Teleport 到 body、用 fixed 定位，这里负责：
 *  - 全局同一时刻只展开一个
 *  - 跟随触发按钮定位；下方放不下就翻到上方，横向收进视口
 *  - 点外面关闭；滚动 / 改窗口大小时重新定位（或直接关闭）
 */

// 模块级单例：全局只允许一个菜单同时展开
const activeId = ref<string | null>(null)
let seq = 0

const SAFE = 8

export interface FloatingMenuOptions {
  /** 触发按钮：定位以它为准 */
  trigger: Ref<HTMLElement | null>
  /** 菜单元素（Teleport 出去的那个） */
  menu: Ref<HTMLElement | null>
  /** 触发按钮所在的根元素：点在它里面不算「点外面」 */
  root?: Ref<HTMLElement | null>
  /** 按钮与菜单的间距，默认 6 */
  gap?: number
  /** 菜单至少与按钮同宽 */
  matchWidth?: boolean
  /** 上下都放不下时，把菜单高度压到放得下的那一侧（菜单自己要 overflow-y:auto） */
  fitHeight?: boolean
  /** 祖先滚动时关闭而不是跟着走（表单下拉用；菜单自身的滚动不算） */
  closeOnScroll?: boolean
}

export function useFloatingMenu(opts: FloatingMenuOptions) {
  const id = `fm-${++seq}`
  const gap = opts.gap ?? 6
  const open = computed(() => activeId.value === id)

  const pos = ref<{ top: number; left: number; minWidth?: number; maxHeight?: number }>({ top: 0, left: 0 })
  const menuStyle = computed<CSSProperties>(() => ({
    position: 'fixed',
    top: `${pos.value.top}px`,
    left: `${pos.value.left}px`,
    zIndex: 9999,
    ...(pos.value.minWidth ? { minWidth: `${pos.value.minWidth}px` } : null),
    ...(pos.value.maxHeight ? { maxHeight: `${pos.value.maxHeight}px` } : null),
  }))

  function updatePosition() {
    const b = opts.trigger.value
    if (!b) return
    // 菜单是 fixed 的：坐标要相对「画框」（独立应用里是视口，嵌入时是本产品的根元素，见 utils/frame.ts）
    const fr = frameOf(b)
    const raw = b.getBoundingClientRect()
    const rect = { top: raw.top - fr.y, bottom: raw.bottom - fr.y, left: raw.left - fr.x, right: raw.right - fr.x, width: raw.width }
    const vw = fr.w
    const vh = fr.h
    // 默认放在按钮下方
    let top = rect.bottom + gap
    let left = rect.left
    let maxHeight: number | undefined
    const minWidth = opts.matchWidth ? Math.min(rect.width, vw - SAFE * 2) : undefined
    // 菜单已挂载 → 根据实际尺寸做翻转 / 横向收缩，避免出屏被裁
    const menu = opts.menu.value
    if (menu) {
      // 自然高度：不受上一次 max-height 的影响
      const mh = opts.fitHeight ? menu.scrollHeight + (menu.offsetHeight - menu.clientHeight) : menu.offsetHeight
      const mw = Math.max(menu.offsetWidth, minWidth || 0)
      const below = vh - SAFE - top
      const above = rect.top - gap - SAFE
      if (mh > below) {
        if (mh <= above) {
          // 下方放不下且上方放得下 → 翻到按钮上方
          top = rect.top - mh - gap
        } else if (opts.fitHeight) {
          // 两边都放不下 → 选宽裕的一侧，压高度
          if (above > below) {
            maxHeight = Math.max(above, 80)
            top = rect.top - gap - Math.min(mh, maxHeight)
          } else {
            maxHeight = Math.max(below, 80)
          }
        }
      }
      // 横向溢出右边 → 向左对齐到视口右边
      if (left + mw > vw - SAFE) left = vw - mw - SAFE
      if (left < SAFE) left = SAFE
    }
    pos.value = { top, left, minWidth, maxHeight }
  }

  watch(open, async (v) => {
    if (!v) return
    updatePosition()
    await nextTick()
    updatePosition()
  })

  function show() { activeId.value = id }
  function close() { if (open.value) activeId.value = null }
  function toggle() { activeId.value = open.value ? null : id }

  function inside(t: Node | null): boolean {
    if (!t) return false
    return !!(opts.root?.value?.contains(t) || opts.trigger.value?.contains(t) || opts.menu.value?.contains(t))
  }

  function onDocMousedown(e: MouseEvent) {
    // 菜单已经 Teleport 到 body，单纯判 root.contains 会把「点菜单内部」也算成外面
    if (open.value && !inside(e.target as Node)) close()
  }
  function onScroll(e: Event) {
    if (!open.value) return
    if (opts.closeOnScroll) {
      if (!opts.menu.value?.contains(e.target as Node)) close()
    } else {
      updatePosition()
    }
  }
  function onResize() {
    if (open.value) updatePosition()
  }

  // capture 阶段：先于 Vue Flow 的 pane mousedown 触发，
  // 避免被 stopPropagation 屏蔽导致点外面关不上
  onMounted(() => {
    document.addEventListener('mousedown', onDocMousedown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMousedown, true)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
    close()
  })

  return { id, open, menuStyle, show, close, toggle, updatePosition }
}
