import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDialogFocus, initialFocusTarget, nextTabStop, tabbables, type DialogFocus } from '../src/composables/useDialogFocus'

/** Dialog focus handling (composables/useDialogFocus.ts): tab cycle, initial focus, focus return, Esc, stacking. */

const open: DialogFocus[] = []
function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}
function dialog(root: HTMLElement, opts: Parameters<typeof createDialogFocus>[1] = {}): DialogFocus {
  const d = createDialogFocus(() => root, opts)
  open.push(d)
  return d
}
function key(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement || document.body) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}
const active = () => (document.activeElement as HTMLElement | null)?.id || document.activeElement?.tagName

afterEach(() => {
  while (open.length) open.pop()!.deactivate()
  document.body.innerHTML = ''
})

describe('tabbables', () => {
  it('lists what Tab can reach, in document order, skipping disabled / hidden / tabindex=-1', () => {
    const host = mount(`
      <div id="d">
        <button id="a">a</button>
        <button id="b" disabled>b</button>
        <input id="c" type="hidden" />
        <input id="e" />
        <span id="f" tabindex="-1">f</span>
        <span id="g" tabindex="0">g</span>
        <div hidden><button id="h">h</button></div>
        <a id="i" href="#x">i</a>
        <a id="j">no href</a>
      </div>`)
    expect(tabbables(host.querySelector('#d')!).map(el => el.id)).toEqual(['a', 'e', 'g', 'i'])
  })
})

describe('nextTabStop', () => {
  const setup = () => {
    const host = mount('<button id="out">out</button><div id="d" tabindex="-1"><input id="one" /><button id="two">2</button><button id="three">3</button></div>')
    const q = (id: string) => host.querySelector<HTMLElement>('#' + id)!
    return { root: q('d'), q }
  }
  it('wraps at both ends and leaves the middle to the browser', () => {
    const { root, q } = setup()
    expect(nextTabStop(root, q('three'), false)?.id).toBe('one')
    expect(nextTabStop(root, q('one'), true)?.id).toBe('three')
    expect(nextTabStop(root, q('two'), false)).toBeNull()
    expect(nextTabStop(root, q('two'), true)).toBeNull()
    // focus on the dialog box itself: Shift+Tab goes to the last stop, Tab is the browser's (first stop)
    expect(nextTabStop(root, root, true)?.id).toBe('three')
    expect(nextTabStop(root, root, false)).toBeNull()
  })
  it('continues from the last position inside when focus sits outside (a teleported menu)', () => {
    const { root, q } = setup()
    expect(nextTabStop(root, q('out'), false, q('two'))?.id).toBe('three')
    expect(nextTabStop(root, q('out'), true, q('two'))?.id).toBe('one')
    expect(nextTabStop(root, q('out'), false, q('three'))?.id).toBe('one')
    expect(nextTabStop(root, q('out'), false)?.id).toBe('one')
    expect(nextTabStop(root, null, true)?.id).toBe('three')
  })
  it('falls back to the dialog itself when nothing inside can take focus', () => {
    const host = mount('<div id="d" tabindex="-1"><p>text</p></div>')
    const root = host.querySelector<HTMLElement>('#d')!
    expect(nextTabStop(root, root, false)).toBe(root)
  })
})

describe('initialFocusTarget', () => {
  it('prefers data-autofocus, then the first field, then the dialog', () => {
    const a = mount('<div id="d"><button id="x">×</button><input id="f" /><button id="ok" data-autofocus>ok</button></div>')
    expect(initialFocusTarget(a.querySelector('#d')!).id).toBe('ok')
    const b = mount('<div id="d2"><button id="x2">×</button><input id="ro" readonly /><input id="f2" /><button>ok</button></div>')
    expect(initialFocusTarget(b.querySelector('#d2')!).id).toBe('f2')
    const c = mount('<div id="d3"><button id="x3">×</button><button>ok</button></div>')
    expect(initialFocusTarget(c.querySelector('#d3')!).id).toBe('d3')
    // a disabled marked element is not a target
    const d = mount('<div id="d4"><button data-autofocus disabled>ok</button><textarea id="t4"></textarea></div>')
    expect(initialFocusTarget(d.querySelector('#d4')!).id).toBe('t4')
  })
})

describe('createDialogFocus', () => {
  const page = () => {
    const host = mount(`
      <button id="trigger">open</button>
      <button id="other">other</button>
      <div id="d" role="dialog"><button id="x">×</button><input id="name" /><button id="ok">ok</button></div>`)
    const q = (id: string) => host.querySelector<HTMLElement>('#' + id)!
    return { q, root: q('d') }
  }

  it('moves focus in, traps Tab, and gives focus back on close', () => {
    const { q, root } = page()
    q('trigger').focus()
    const d = dialog(root)
    d.activate()
    expect(d.active).toBe(true)
    expect(active()).toBe('name')
    expect(root.getAttribute('tabindex')).toBe('-1')

    q('ok').focus()
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(active()).toBe('x')
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true)
    expect(active()).toBe('ok')
    q('name').focus()
    expect(key('Tab').defaultPrevented).toBe(false)

    d.deactivate()
    expect(d.active).toBe(false)
    expect(active()).toBe('trigger')
    // released: Tab is the browser's again
    q('other').focus()
    expect(key('Tab').defaultPrevented).toBe(false)
  })

  it('pulls focus back when it lands outside, but leaves floating layers alone', () => {
    const { q, root } = page()
    q('trigger').focus()
    dialog(root).activate()
    q('ok').focus()
    q('other').focus()
    expect(active()).toBe('ok')

    const menu = mount('<div class="lc-menu" role="menu"><button id="item" role="menuitem">item</button></div>')
    menu.querySelector<HTMLElement>('#item')!.focus()
    expect(active()).toBe('item')
    // Tab from the teleported menu continues after the last position inside the dialog (ok → wraps to ×)
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(active()).toBe('x')
  })

  it('Esc closes the top dialog only, not while busy, and not while one of its popups is open', () => {
    const { q, root } = page()
    const onEscape = vi.fn()
    let busy = false
    q('trigger').focus()
    dialog(root, { onEscape, busy: () => busy }).activate()
    const seenByWindow = vi.fn()
    window.addEventListener('keydown', seenByWindow)

    busy = true
    key('Escape')
    expect(onEscape).not.toHaveBeenCalled()
    busy = false

    // an open popup that belongs to the dialog: this Esc is the popup's
    const pop = mount('<div class="lc-menu" role="listbox"><div role="option">a</div></div>')
    key('Escape')
    expect(onEscape).not.toHaveBeenCalled()
    pop.remove()

    // an Esc something else already handled
    const handled = (e: Event) => e.preventDefault()
    q('name').addEventListener('keydown', handled)
    key('Escape', {}, q('name'))
    expect(onEscape).not.toHaveBeenCalled()
    q('name').removeEventListener('keydown', handled)

    seenByWindow.mockClear()
    const e = key('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(e.defaultPrevented).toBe(true)
    // page-level listeners on window do not get the same Esc
    expect(seenByWindow).not.toHaveBeenCalled()
    window.removeEventListener('keydown', seenByWindow)
  })

  it('stacked dialogs: the top one owns the keyboard; closing it hands back to the one below', () => {
    const { q, root } = page()
    const escA = vi.fn()
    const escB = vi.fn()
    q('trigger').focus()
    const a = dialog(root, { onEscape: escA })
    a.activate()
    q('ok').focus()
    const second = mount('<div id="d2" role="dialog"><button id="yes" data-autofocus>yes</button><button id="no">no</button></div>')
    const b = dialog(second.querySelector<HTMLElement>('#d2')!, { onEscape: escB })
    b.activate()
    expect(active()).toBe('yes')

    key('Escape')
    expect(escB).toHaveBeenCalledTimes(1)
    expect(escA).not.toHaveBeenCalled()
    // Tab cycles inside the top dialog
    second.querySelector<HTMLElement>('#no')!.focus()
    key('Tab')
    expect(active()).toBe('yes')

    b.deactivate()
    expect(active()).toBe('ok')
    key('Escape')
    expect(escA).toHaveBeenCalledTimes(1)
    a.deactivate()
    expect(active()).toBe('trigger')
  })

  it('a dialog replaced by another (confirm → result) returns focus to the original opener', () => {
    const { q, root } = page()
    q('trigger').focus()
    const confirm = dialog(root)
    confirm.activate()
    // the result dialog mounts first, then the confirm one unmounts
    const second = mount('<div id="d2" role="dialog"><button id="done" data-autofocus>done</button></div>')
    const result = dialog(second.querySelector<HTMLElement>('#d2')!)
    result.activate()
    confirm.deactivate()
    root.remove()
    expect(active()).toBe('done')
    result.deactivate()
    expect(active()).toBe('trigger')
  })

  it('uses the fallback when the opener is gone', () => {
    const { q, root } = page()
    q('trigger').focus()
    const d = dialog(root, { fallbackFocus: () => q('other') })
    d.activate()
    q('trigger').remove()
    d.deactivate()
    expect(active()).toBe('other')
  })

  // 弹窗常常是在一轮界面更新的半路上被卸掉的：下面三种情况焦点都不能掉回 <body>
  const settled = () => new Promise<void>((r) => setTimeout(r, 5))

  it('the opener is still disabled when the dialog closes (saving): focus arrives once it is enabled again', async () => {
    const { q, root } = page()
    const trigger = q('trigger') as HTMLButtonElement
    trigger.focus()
    const d = dialog(root)
    d.activate()
    trigger.disabled = true
    d.deactivate()
    // 真的浏览器不会让灰着的按钮拿到焦点；测试用的 DOM 会，这里手动放掉
    trigger.blur()
    expect(active()).not.toBe('trigger')
    trigger.disabled = false
    await settled()
    expect(active()).toBe('trigger')
  })

  it('the opener is removed right after the dialog closed: the fallback takes the focus', async () => {
    const { q, root } = page()
    q('trigger').focus()
    const d = dialog(root, { fallbackFocus: () => q('other') })
    d.activate()
    d.deactivate()
    expect(active()).toBe('trigger')
    q('trigger').remove()
    await settled()
    expect(active()).toBe('other')
  })

  it('the fallback itself is disabled at that moment: it gets the focus once the update has settled', async () => {
    const { q, root } = page()
    q('trigger').focus()
    const other = q('other') as HTMLButtonElement
    const d = dialog(root, { fallbackFocus: () => other })
    d.activate()
    q('trigger').remove()
    other.disabled = true
    d.deactivate()
    // 真的浏览器不会让灰着的按钮拿到焦点；测试用的 DOM 会，这里手动放掉
    other.blur()
    expect(active()).not.toBe('other')
    other.disabled = false
    await settled()
    expect(active()).toBe('other')
  })

  it('does not take the focus back from where the person put it, nor from a dialog opened in the meantime', async () => {
    const { q, root } = page()
    q('trigger').focus()
    const d = dialog(root, { fallbackFocus: () => q('other') })
    d.activate()
    d.deactivate()
    q('other').focus()
    await settled()
    expect(active()).toBe('other')

    // a second dialog opens right after the first one closed and its opener went away
    q('trigger').focus()
    const first = dialog(root, { fallbackFocus: () => q('other') })
    first.activate()
    first.deactivate()
    const second = mount('<div id="d2" role="dialog"><button id="done" data-autofocus>done</button></div>')
    const next = dialog(second.querySelector<HTMLElement>('#d2')!)
    next.activate()
    q('trigger').remove()
    await settled()
    expect(active()).toBe('done')
  })
})

describe('non-modal panels (modal: false)', () => {
  const page = () => {
    const host = mount(`
      <button id="trigger">open</button>
      <input id="elsewhere" />
      <div id="pop" role="dialog"><button id="a">a</button><button id="b">b</button></div>`)
    const q = (id: string) => host.querySelector<HTMLElement>('#' + id)!
    return { q, root: q('pop') }
  }

  it('cycles Tab inside and closes on Esc, but lets focus leave and stay where the person put it', () => {
    const { q, root } = page()
    const onEscape = vi.fn()
    q('trigger').focus()
    const d = dialog(root, { modal: false, onEscape })
    d.activate()
    q('b').focus()
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(active()).toBe('a')
    key('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)

    // clicking into something else: not pulled back, Tab there is the browser's, and closing leaves focus there
    q('elsewhere').focus()
    expect(active()).toBe('elsewhere')
    expect(key('Tab').defaultPrevented).toBe(false)
    d.deactivate()
    expect(active()).toBe('elsewhere')
  })

  it('gives focus back to the opener when it was still inside', () => {
    const { q, root } = page()
    q('trigger').focus()
    const d = dialog(root, { modal: false })
    d.activate()
    q('b').focus()
    d.deactivate()
    expect(active()).toBe('trigger')
  })
})

describe('v-dialog', () => {
  it('activates with the element, reads the latest binding, and releases on unmount', async () => {
    const { createApp, h, nextTick, ref, withDirectives } = await import('vue')
    const { vDialog } = await import('../src/directives/dialog')
    const host = mount('<button id="trigger">open</button><div id="app"></div>')
    host.querySelector<HTMLElement>('#trigger')!.focus()
    const open = ref(true)
    const busy = ref(true)
    const closed = vi.fn()
    const app = createApp({
      render: () => (open.value
        ? withDirectives(h('div', { id: 'dlg', role: 'dialog' }, [h('input', { id: 'field' }), h('button', { id: 'ok' }, 'ok')]), [[vDialog, { onEscape: closed, busy: busy.value }]])
        : null),
    })
    app.mount(host.querySelector('#app')!)
    await nextTick()
    expect(active()).toBe('field')
    key('Escape')
    expect(closed).not.toHaveBeenCalled()
    busy.value = false
    await nextTick()
    key('Escape')
    expect(closed).toHaveBeenCalledTimes(1)
    open.value = false
    await nextTick()
    expect(active()).toBe('trigger')
    app.unmount()
  })
})
