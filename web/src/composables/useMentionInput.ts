import { frameOf } from '@/utils/frame'
import { reactive } from 'vue'
import {
  activeMentionQuery, insertMention, type ImageRef,
} from '@/composables/canvasImageRefs'

/**
 * 提示词框里的 @ 指代输入。
 *
 * 一个节点上可能有两个文本框（收起态的小气泡和展开态的大气泡），共用同一份
 * prompt。所以这里不绑定某个 ref，而是从事件里取当前那个 textarea —— 一个实例
 * 服务两个框，不用各起一套状态。
 *
 * 候选框定位在文本框正下方，而不是光标处：在 textarea 里算光标坐标要造一个
 * 镜像 div 逐字测量，为这点精度不值得，贴着框下沿也够指哪打哪。
 */
export function useMentionInput(opts: {
  refs: () => ImageRef[]
  get: () => string
  set: (v: string) => void
}) {
  const picker = reactive({
    open: false,
    x: 0,
    y: 0,
    width: 220,
    query: '',
    /** @ 在文本里的下标，选中后要把已经敲的那半截名字一起替换掉 */
    start: 0,
    active: 0,
  })
  let el: HTMLTextAreaElement | null = null

  const matches = () => {
    const q = picker.query
    const all = opts.refs()
    if (!q) return all
    return all.filter(r => r.label.includes(q) || String(r.index) === q)
  }

  function close() { picker.open = false; picker.query = ''; picker.active = 0 }

  function place(target: HTMLTextAreaElement) {
    const r = target.getBoundingClientRect()
    // 候选列表是 fixed 的：坐标相对「画框」（utils/frame.ts）
    const fr = frameOf(target)
    picker.x = r.left - fr.x
    picker.y = r.bottom - fr.y + 4
    picker.width = Math.max(200, r.width)
  }

  function onInput(e: Event) {
    const target = e.target as HTMLTextAreaElement
    el = target
    const seg = activeMentionQuery(target.value, target.selectionStart ?? 0)
    if (!seg || !opts.refs().length) { close(); return }
    picker.start = seg.start
    picker.query = seg.query
    picker.active = 0
    picker.open = true
    place(target)
  }

  function onKeydown(e: KeyboardEvent) {
    if (!picker.open) return
    const list = matches()
    if (e.key === 'Escape') { e.stopPropagation(); close(); return }
    if (!list.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); picker.active = (picker.active + 1) % list.length }
    else if (e.key === 'ArrowUp') { e.preventDefault(); picker.active = (picker.active - 1 + list.length) % list.length }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(list[picker.active]) }
  }

  /** 选中候选：把「@已敲的半截」整段换成完整 token */
  function pick(ref: ImageRef) {
    const text = opts.get()
    const head = text.slice(0, picker.start)
    const tail = text.slice(picker.start + 1 + picker.query.length)
    const merged = insertMention(head, head.length, ref.label)
    opts.set(merged.text + tail)
    close()
    if (el) {
      const caret = merged.caret
      const target = el
      requestAnimationFrame(() => { target.focus(); target.setSelectionRange(caret, caret) })
    }
  }

  /** 缩略图条上点一下：没有正在输入的 @，就追加到末尾 */
  function insertAtEnd(ref: ImageRef) {
    const text = opts.get()
    const caret = el && document.activeElement === el ? (el.selectionStart ?? text.length) : text.length
    const merged = insertMention(text, caret, ref.label)
    opts.set(merged.text)
    if (el) {
      const target = el
      requestAnimationFrame(() => { target.focus(); target.setSelectionRange(merged.caret, merged.caret) })
    }
  }

  return { picker, matches, onInput, onKeydown, pick, insertAtEnd, close }
}
