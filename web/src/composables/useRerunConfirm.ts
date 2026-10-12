import { lcSession } from '@/utils/storage'
import { h } from 'vue'
import { DialogPlugin } from '@/utils/feedback'
import { t } from '@/locales'

/**
 * 重跑已有结果的生成节点之前问一句。
 *
 * 每跑一次都是向上游新提交一个任务、再计一次费；已经有结果的节点上，运行按钮点一下
 * 就又花一次钱，误点没有任何缓冲。首次运行（还没有结果）不问。
 *
 * 「本次会话不再询问」记在 sessionStorage：刷新页面还算数，关掉浏览器再开就重新问。
 */
const SKIP_KEY = 'loomcanvas-rerun-confirm-skip'

function skipped(): boolean {
  try { return lcSession.getItem(SKIP_KEY) === '1' } catch { return false }
}
function rememberSkip() {
  try { lcSession.setItem(SKIP_KEY, '1') } catch { /* 存不了就下次接着问 */ }
}

export interface RerunInfo {
  /** 这次会被重新提交、且已经有结果的节点数 */
  count: number
  /** 其中输出文字的节点数（大语言模型 / 视频分析）：它们没有历史版本，新结果直接替换现有文字 */
  textCount: number
}

export function confirmRerun(info: RerunInfo): Promise<boolean> {
  if (info.count <= 0 || skipped()) return Promise.resolve(true)
  return new Promise((resolve) => {
    let dontAsk = false
    const lines = [info.count === 1 ? t('canvas.rerun.bodyOne') : t('canvas.rerun.bodyMany', { n: info.count })]
    if (info.textCount > 0) lines.push(t('canvas.rerun.replacesText'))
    const dlg = DialogPlugin.confirm({
      header: t('canvas.rerun.title'),
      body: () => h('div', { class: 'cv-rerun-confirm' }, [
        ...lines.map(line => h('p', { class: 'cv-rerun-line' }, line)),
        // 用全局的 .lc-check（隐藏原生框 + .box），原生复选框在深色弹窗里是一块灰白方块
        h('label', { class: 'lc-check', style: { marginTop: '6px', fontSize: '13px' } }, [
          h('input', {
            type: 'checkbox',
            onChange: (e: Event) => { dontAsk = (e.target as HTMLInputElement).checked },
          }),
          h('span', { class: 'box' }),
          h('span', t('canvas.rerun.dontAsk')),
        ]),
      ]),
      confirmBtn: t('canvas.rerun.confirm'),
      cancelBtn: t('common.cancel'),
      onConfirm: () => {
        if (dontAsk) rememberSkip()
        dlg.destroy()
        resolve(true)
      },
      onClose: () => { dlg.destroy(); resolve(false) },
    })
  })
}
