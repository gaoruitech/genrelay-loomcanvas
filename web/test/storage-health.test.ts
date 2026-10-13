import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiErrorMessage } from '../src/utils/api'
import { storageHealth, noteProviders, noteStorageAnswer, setWritable } from '../src/utils/storageHealth'
import { installMediaGuard } from '../src/directives/mediaGuard'
import { setLocale } from '../src/locales'

/**
 * 存储出问题时界面靠的三样东西：
 *  - 「现在存不存得了新文件」「哪些服务商的 Key 解不开」是怎么记下、怎么清掉的（画布在运行之前按它说明）；
 *  - 后端没给话的时候，axios 自己的英文句子不给用户看；
 *  - 加载不出来的站内图片：服务端回 503 换成「存储暂时连不上」（带重试），回 404 换成「文件已不存在」，别的不动。
 */
describe('what the page learns about storage after the bootstrap', () => {
  beforeEach(() => { storageHealth.writable = null; storageHealth.deadProviders = {}; storageHealth.said.storage = ''; storageHealth.said.provider = '' })

  it('nothing is known at first: the bootstrap answer stands', () => {
    expect(storageHealth.writable).toBe(null)
    noteStorageAnswer('/workflow/list', 'get', '')
    noteStorageAnswer('/llm/tasks', 'post', '')
    expect(storageHealth.writable).toBe(null)
  })

  it('a refusal with storage.secret_unreadable is remembered with its sentence; a successful upload or run says the opposite', () => {
    noteStorageAnswer('/files/upload', 'post', 'storage.secret_unreadable', 'Files cannot be stored right now')
    expect([storageHealth.writable, storageHealth.said.storage]).toEqual([false, 'Files cannot be stored right now'])
    noteStorageAnswer('/runs', 'POST', '')
    expect(storageHealth.writable).toBe(true)
    noteStorageAnswer('/runs', 'post', 'storage.secret_unreadable', 'x')
    noteStorageAnswer('/files/upload', 'post', '')
    expect(storageHealth.writable).toBe(true)
  })

  it('a fresh bootstrap replaces what the page had found out itself', () => {
    setWritable(false)
    noteStorageAnswer('/bootstrap', 'get', '')
    expect(storageHealth.writable).toBe(null)
    setWritable(true)
    noteStorageAnswer('/app/bootstrap', 'GET', '')
    expect(storageHealth.writable).toBe(null)
  })

  it('other storage errors say nothing about whether files can be stored', () => {
    noteStorageAnswer('/files/upload', 'post', 'storage.write_failed', 'x')
    noteStorageAnswer('/canvas/tool/slice', 'post', 'storage.unreachable', 'x')
    expect([storageHealth.writable, storageHealth.said.storage]).toEqual([null, ''])
  })

  it('a refused provider key keeps its sentence, so the node does not say the same thing twice', () => {
    noteStorageAnswer('/runs', 'post', 'provider.key_undecryptable', 'The API key of this provider cannot be decrypted')
    expect(storageHealth.said.provider).toBe('The API key of this provider cannot be decrypted')
    expect(storageHealth.writable).toBe(null)
  })

  it('providers whose key cannot be read are kept per provider, other spaces are left alone', () => {
    noteProviders([{ id: 'a', name: 'Team A', keyUnreadable: true }, { id: 'b', name: 'B' }])
    expect(storageHealth.deadProviders).toEqual({ a: 'Team A' })
    // 另一个空间的列表：a 不在里面，照旧
    noteProviders([{ id: 'c', name: 'Mine', keyUnreadable: true }])
    expect(storageHealth.deadProviders).toEqual({ a: 'Team A', c: 'Mine' })
    // a 的 Key 重新填上了
    noteProviders([{ id: 'a', name: 'Team A', keyUnreadable: false }])
    expect(storageHealth.deadProviders).toEqual({ c: 'Mine' })
  })
})

describe('apiErrorMessage', () => {
  it('uses the sentence of the server when there is one', () => {
    expect(apiErrorMessage({ isAxiosError: true, message: 'Request failed with status code 503', response: { data: { message: 'said by the server' } } }, 'fallback')).toBe('said by the server')
  })
  it('never shows the sentence axios made up', () => {
    expect(apiErrorMessage({ isAxiosError: true, message: 'Network Error' }, 'Upload failed')).toBe('Upload failed')
    expect(apiErrorMessage({ isAxiosError: true, message: 'Request failed with status code 503', response: { data: '<html>' } }, 'Upload failed')).toBe('Upload failed')
  })
  it('keeps the message of an error raised locally or by a hand-written adapter', () => {
    expect(apiErrorMessage(new Error('File is larger than the 50 MB upload limit'), 'Upload failed')).toBe('File is larger than the 50 MB upload limit')
    expect(apiErrorMessage(null, 'Upload failed')).toBe('Upload failed')
  })
})

describe('media that does not load', () => {
  let root: HTMLElement
  let layer: HTMLElement
  let uninstall: () => void
  let status = 503
  const tick = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    setLocale('en', false)
    status = 503
    vi.stubGlobal('fetch', vi.fn(async () => ({ status })))
    // 根里面是页面本身，和传送过去的弹层（灯箱、各种弹窗）
    root = document.createElement('div')
    layer = document.createElement('div')
    layer.className = 'lc-portal'
    root.appendChild(layer)
    document.body.appendChild(root)
    uninstall = installMediaGuard(root)
  })
  afterEach(() => {
    uninstall()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function failing(src: string, into: HTMLElement = root, tag: 'img' | 'video' = 'img'): HTMLImageElement {
    const wrap = document.createElement('div')
    const el = document.createElement(tag) as HTMLImageElement
    el.setAttribute('src', src)
    wrap.appendChild(el)
    into.appendChild(wrap)
    el.dispatchEvent(new Event('error'))
    return el
  }

  it('503: the image is replaced by the calm state, with a way to try again', async () => {
    const img = failing('/files/uploads/a/2026/10/x.png')
    await tick()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/files/uploads/a/2026/10/x.png'), expect.objectContaining({ method: 'HEAD' }))
    expect(img.getAttribute('data-lc-media-down')).toBe('down')
    const ph = img.nextElementSibling as HTMLElement
    expect(ph.getAttribute('data-testid')).toBe('media-down')
    expect(ph.textContent).toContain('cannot be reached right now')
    expect(ph.querySelector('button')?.textContent).toBe('Retry')

    // 还连不上：占位留着
    ph.querySelector('button')!.click()
    await tick()
    expect(img.nextElementSibling).toBe(ph)
    // 连上了：占位撤掉，图片重新露出来
    status = 200
    ph.querySelector('button')!.click()
    await tick()
    expect(img.hasAttribute('data-lc-media-down')).toBe(false)
    expect(root.querySelector('[data-testid=media-down]')).toBeNull()
  })

  it('404: a tidy "no longer exists", in the same family, with nothing to retry', async () => {
    status = 404
    const img = failing('/files/uploads/a/2026/10/gone.png')
    await tick()
    expect(img.getAttribute('data-lc-media-down')).toBe('gone')
    const ph = img.nextElementSibling as HTMLElement
    expect(ph.getAttribute('data-testid')).toBe('media-gone')
    expect(ph.classList.contains('lc-media-down')).toBe(true)
    expect(ph.textContent).toBe('This file no longer exists')
    expect(ph.querySelector('button')).toBeNull()
  })

  it('a store that was down and is then dropped from the list: the placeholder turns into "no longer exists"', async () => {
    const img = failing('/files/uploads/a/2026/10/x.png')
    await tick()
    status = 404
    ;(img.nextElementSibling as HTMLElement).querySelector('button')!.click()
    await tick()
    await tick()
    expect(img.getAttribute('data-lc-media-down')).toBe('gone')
    expect(root.querySelectorAll('.lc-media-down').length).toBe(1)
    expect(root.querySelector('[data-testid=media-gone]')).not.toBeNull()
  })

  it('media in a teleported layer and videos are covered too; foreign addresses and other answers are left alone', async () => {
    const inLightbox = failing('/files/outputs/a/2026/10/big.png', layer)
    const video = failing('/files/outputs/a/2026/10/clip.mp4', layer, 'video')
    const foreign = failing('https://cdn.example.com/picture.png')
    await tick()
    expect(inLightbox.getAttribute('data-lc-media-down')).toBe('down')
    expect(video.getAttribute('data-lc-media-down')).toBe('down')
    expect(foreign.hasAttribute('data-lc-media-down')).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
    status = 500
    const odd = failing('/files/uploads/a/2026/10/odd.png')
    await tick()
    expect(odd.hasAttribute('data-lc-media-down')).toBe(false)
  })

  it('a component that swaps the image out itself on error is not second-guessed', async () => {
    const img = failing('/files/uploads/a/2026/10/cover.png')
    // 它自己的处理：出错就把这张图拿掉，换成别的
    img.parentElement!.removeChild(img)
    await tick()
    expect(root.querySelector('.lc-media-down')).toBeNull()
  })

  it('inside a button there is no second button: just the sentence (a tile of the asset library)', async () => {
    const btn = document.createElement('button')
    const img = document.createElement('img')
    img.setAttribute('src', '/files/outputs/a/2026/10/thumb.png')
    btn.appendChild(img)
    root.appendChild(btn)
    img.dispatchEvent(new Event('error'))
    await tick()
    const ph = img.nextElementSibling as HTMLElement
    expect(ph.querySelector('button')).toBeNull()
    expect(ph.textContent).toBe('The storage that holds this file cannot be reached right now')
    expect(ph.getAttribute('aria-label')).toContain('cannot be reached right now')
  })

  it('the placeholder goes away with the image, when the node shows another file, and when the app is unmounted', async () => {
    const a = failing('/files/uploads/a/2026/10/one.png')
    const b = failing('/files/uploads/a/2026/10/two.png')
    const c = failing('/files/uploads/a/2026/10/three.png')
    await tick()
    expect(root.querySelectorAll('[data-testid=media-down]').length).toBe(3)
    a.parentElement!.removeChild(a)
    b.setAttribute('src', '/files/uploads/a/2026/10/other.png')
    // MutationObserver 的回调是微任务之后才到
    await tick()
    await tick()
    expect(root.querySelectorAll('[data-testid=media-down]').length).toBe(1)
    expect(b.hasAttribute('data-lc-media-down')).toBe(false)
    uninstall()
    expect(root.querySelector('.lc-media-down')).toBeNull()
    expect(c.hasAttribute('data-lc-media-down')).toBe(false)
  })
})
