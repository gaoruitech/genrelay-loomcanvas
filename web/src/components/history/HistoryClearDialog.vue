<template>
  <!-- 清理确认：删掉就找不回来，必须先说清楚再动手 -->
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @mousedown="downOnMask = $event.target === $event.currentTarget" @click.self="downOnMask && close()">
      <!-- 故意不用 form：在日期框里按回车不该直接触发删除 -->
      <div v-dialog="{ onEscape: close, busy: clearing }" class="lc-dialog hc" role="dialog" aria-modal="true" aria-labelledby="hc-title" data-testid="hi-clear-dialog">
        <div class="lc-dialog-head">
          <span id="hc-title">{{ t('history.clearDialog.title') }}</span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" :disabled="clearing" @click="close">×</button>
        </div>
        <div class="lc-dialog-body">
          <!-- 团队里：本月的记录删不了（每月上限就是按它们算的），先说在前面，免得选了日期才被拒绝 -->
          <div v-if="space.isTeam" class="lc-alert info hc-team" data-testid="hc-team"><LcIcon name="info" /><span>{{ t('history.clearDialog.teamMonth', { team: space.name, date: maxText }) }}</span></div>
          <!-- TDesign 的输入框不接 id，没法用 for 关联；把控件包在 label 里，点文字同样能聚焦 -->
          <label class="lc-field">
            <span class="lc-label">{{ t('history.clearDialog.label') }}</span>
            <t-date-picker
              v-model="before"
              class="lc-date hc-date"
              value-type="YYYY-MM-DD"
              format="YYYY-MM-DD"
              allow-input
              clearable
              :placeholder="t('history.clearDialog.placeholder')"
              :disable-date="{ after: maxText }"
              :popup-props="DATE_POPUP"
            />
          </label>
          <p class="hc-text">{{ hintText }}</p>
          <p v-if="error" class="lc-error-text hc-err" role="alert">{{ error }}</p>
          <div class="lc-alert warn hc-warn"><LcIcon name="warn" /><span>{{ t('history.clearDialog.warn') }}</span></div>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" :disabled="clearing" @click="close">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" type="button" :disabled="!valid || clearing" data-testid="hc-confirm" @click="confirm">{{ t('history.clearDialog.confirm') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'
import { vDialog } from '@/directives/dialog'
import { adminApi, unwrap, apiErrorMessage, apiErrorCode, SPACE_GONE_CODES } from '@/utils/api'
import { useSpaceStore } from '@/stores/space'
import { isoDate } from './historyFormat'

const emit = defineEmits<{ (e: 'close'): void; (e: 'cleared'): void }>()
const { t } = useI18n()
const space = useSpaceStore()

/** 日历弹层挂在 body 上，靠这个类名套用整站的配色（见 base.css） */
const DATE_POPUP = { overlayClassName: 'lc-date-popup' }
const todayText = isoDate(new Date())

/**
 * 团队所在时区里，本月 1 日零点是哪一刻。服务端拿它当界线：before 晚于这一刻就拒绝（usage.current_month）。
 * 时区名不认识时返回 null，那就只按「今天」限制，真越界了由服务端的那句话说明。
 */
function teamMonthStart(zone: string): Date | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    const wall = (ts: number) => {
      const p: Record<string, number> = {}
      for (const x of fmt.formatToParts(new Date(ts))) if (x.type !== 'literal') p[x.type] = Number(x.value)
      return p
    }
    /** 那一刻，这个时区的钟比 UTC 快多少毫秒 */
    const ahead = (ts: number) => { const p = wall(ts); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000 }
    const now = wall(Date.now())
    const guess = Date.UTC(now.year, now.month - 1, 1)
    let start = guess - ahead(guess)
    start = guess - ahead(start)
    return Number.isFinite(start) ? new Date(start) : null
  } catch { return null }
}
/**
 * 最晚能选哪一天。请求里的 before 是「浏览器所在时区那一天的零点」（utils/api 带的是浏览器的时区），
 * 所以团队里取「团队本月开始那一刻」落在浏览器时区的哪一天：那一天的零点一定不晚于界线。
 */
const maxText = (() => {
  if (!space.isTeam) return todayText
  const start = teamMonthStart(space.team?.timezone || 'UTC')
  const day = start ? isoDate(start) : todayText
  return day < todayText ? day : todayText
})()

const before = ref('')
const error = ref('')
/** 日历里点不了的日子，输入框还能手敲：这里再挡一次 */
const valid = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(before.value || '') && before.value <= maxText)
const hintText = computed(() => {
  if (!valid.value) return t(space.isTeam ? 'history.clearDialog.pickTeam' : 'history.clearDialog.pick')
  return t(space.isTeam ? 'history.clearDialog.textTeam' : 'history.clearDialog.text', { date: before.value })
})
watch(before, () => { error.value = '' })
const clearing = ref(false)

function close() {
  if (!clearing.value) emit('close')
}

async function confirm() {
  if (!valid.value || clearing.value) return
  clearing.value = true
  error.value = ''
  try {
    const data = unwrap(await adminApi.clearUsageRecords(before.value))
    MessagePlugin.success(t('history.clearDialog.cleared', { n: Number(data?.deleted) || 0 }))
    emit('cleared')
  } catch (err) {
    const code = apiErrorCode(err)
    // 空间没了（被移出、团队解散）由外壳统一处理，这里不再多报一遍
    if (SPACE_GONE_CODES.includes(code as any)) { emit('close'); return }
    // 伸进了本月、或者不是团长：服务端的话留在弹窗里，人还能改日期
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    clearing.value = false
  }
}

/** 按下和松开都在遮罩上才算「点外面」：在日期框里拖选、松手时滑到外面不算 */
const downOnMask = ref(false)
</script>

<style scoped>
.hc { width: 460px; }
.hc-date { width: 100%; }
.hc-text { color: var(--text-2); font-size: 13px; line-height: 1.7; }
.hc-warn { margin-top: 12px; }
.hc-team { margin-bottom: 16px; }
.hc-err { margin: 12px 0 0; }
</style>
