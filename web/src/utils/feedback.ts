import { MessagePlugin as TMessage, DialogPlugin as TDialog } from 'tdesign-vue-next'
import { runtime, currentPortal, mountedPortal } from '@/embed/runtime'

/**
 * TDesign 的轻提示和确认弹窗，全站都从这里引，不直接从 tdesign-vue-next 引。
 *
 * 独立应用里和原来完全一样（挂在 body 上）。嵌进别人的页面时，它们得挂在本产品自己的根元素里面：
 * 设计令牌、主题、字体都只在那个根元素里生效，挂到宿主的 body 上会变成一块没有样式的东西，
 * 也会盖到宿主页面上去。挂哪一个根：用户最后操作过的那一个（见 embed/runtime.ts 的 activePortal）。
 *
 * 嵌入时一个挂着的根都没有了（宿主刚把编辑器卸掉，卸载前补存的那一次这时才回来）：这条提示没有地方可放，
 * 不出 —— 绝不退到宿主的 body 上去（「不往 body 里加任何东西」是对集成方的承诺）。
 */
type MessageArg = Parameters<typeof TMessage.success>[0]
type Level = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'question'

function show(level: Level, message: MessageArg, duration?: number) {
  if (!runtime.embedded) return TMessage[level](message, duration)
  if (!mountedPortal()) return Promise.resolve({ close: () => undefined }) as unknown as ReturnType<typeof TMessage.success>
  const opts = typeof message === 'object' && message !== null ? message : { content: message as string }
  return TMessage[level]({ ...opts, attach: () => currentPortal() }, duration)
}

export const MessagePlugin = {
  success: (message: MessageArg, duration?: number) => show('success', message, duration),
  error: (message: MessageArg, duration?: number) => show('error', message, duration),
  warning: (message: MessageArg, duration?: number) => show('warning', message, duration),
  info: (message: MessageArg, duration?: number) => show('info', message, duration),
  loading: (message: MessageArg, duration?: number) => show('loading', message, duration),
  question: (message: MessageArg, duration?: number) => show('question', message, duration),
  close: TMessage.close,
  closeAll: TMessage.closeAll,
}

type ConfirmOptions = Parameters<typeof TDialog.confirm>[0]

export const DialogPlugin = {
  confirm: (options: ConfirmOptions) =>
    TDialog.confirm(runtime.embedded ? { ...options, attach: () => currentPortal() } : options),
}
