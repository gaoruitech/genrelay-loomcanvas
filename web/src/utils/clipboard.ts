/**
 * 写剪贴板。http 自部署时没有 navigator.clipboard（只在安全上下文里可用），退回 execCommand。
 * 写不进去就抛错，由调用方决定怎么提示。
 */
export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  // 开着弹窗时焦点被圈在弹窗里（useDialogFocus）：标一下这是浮在上面的东西，焦点进来不会被拉回去，选区才留得住
  ta.setAttribute('data-lc-popup', '')
  ta.setAttribute('aria-hidden', 'true')
  const back = document.activeElement as HTMLElement | null
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  // 焦点还给原来的元素（复制按钮）：不然键盘焦点就丢了
  if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true })
  if (!ok) throw new Error('copy failed')
}
