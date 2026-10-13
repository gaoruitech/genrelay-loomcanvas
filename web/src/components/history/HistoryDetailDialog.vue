<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @mousedown="downOnMask = $event.target === $event.currentTarget" @click.self="downOnMask && emit('close')">
      <div v-dialog="() => emit('close')" class="lc-dialog hd" role="dialog" aria-modal="true" aria-labelledby="hd-title" data-testid="hi-detail">
        <div class="lc-dialog-head">
          <span id="hd-title" class="hd-title">
            {{ t('history.detail.title') }}
            <span class="lc-bd" :class="rec.kind">{{ t('history.kinds.' + rec.kind) }}</span>
            <span class="lc-st" :class="statusClass(rec.status)" data-testid="hd-status">{{ t('history.statuses.' + rec.status) }}</span>
          </span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </div>

        <div class="lc-dialog-body hd-body">
          <!-- 记录已经不在了（开着弹窗时被清理、被移出团队）：留着列表里那一份，说清楚 -->
          <div v-if="gone" class="lc-alert warn hd-block" role="status" data-testid="hd-gone"><LcIcon name="warn" /><span>{{ t('history.detail.gone') }}</span></div>

          <div v-if="rec.status === 'failed'" class="lc-alert hd-block" role="status" data-testid="hd-error">
            <LcIcon name="warn" />
            <div class="hd-why">
              <b>{{ t('history.detail.error') }}</b>
              <div class="hd-err">{{ rec.error || '—' }}</div>
              <div v-if="rec.errorCode" class="hd-code">{{ t('history.detail.errorCode') }}<code data-testid="hd-error-code">{{ rec.errorCode }}</code></div>
            </div>
          </div>
          <!-- 不是人点的取消：服务端给了原因 -->
          <div v-else-if="rec.status === 'canceled' && rec.error && rec.errorCode && rec.errorCode !== 'run.canceled'" class="lc-alert info hd-block" role="status" data-testid="hd-canceled">
            <LcIcon name="info" />
            <div class="hd-why">
              <b>{{ t('history.detail.canceledWhy') }}</b>
              <div class="hd-err">{{ rec.error }}</div>
              <div class="hd-code">{{ t('history.detail.errorCode') }}<code data-testid="hd-error-code">{{ rec.errorCode }}</code></div>
            </div>
          </div>

          <!-- 还在跑：只有接口给了进度才显示数字 -->
          <div v-if="active" class="hd-running hd-block" role="status">
            <span v-if="rec.status === 'queued'" class="lc-ring sm q" />
            <span v-else-if="progress > 0" class="lc-ring sm" :style="{ '--p': progress }"><span>{{ progress }}</span></span>
            <span v-else class="lc-ring sm spin" />
            <span>{{ progress > 0 ? t('history.detail.progress', { n: progress }) : t('history.statuses.' + rec.status) }}</span>
          </div>

          <section v-if="rec.kind !== 'chat' && rec.status === 'succeeded'" class="hd-block" data-block="outputs">
            <h3>
              <span>{{ outputs.length > 1 ? t('history.detail.outputsN', { n: outputs.length }, outputs.length) : t('history.detail.outputs') }}</span>
              <!-- 「全部下载（ZIP）」：集成方关了打包下载（features.batchDownload）就不出，每个文件自己的下载钮还在 -->
              <button v-if="outputs.length > 1 && $feat.batchDownload" class="lc-btn sm text" type="button" :disabled="zipping" :aria-busy="zipping" data-act="download-all" @click="emit('download-all')">
                <LcIcon :name="zipping ? 'refresh' : 'download'" size="s" :class="{ spinning: zipping }" />{{ t('history.detail.downloadAll') }}
              </button>
            </h3>
            <p v-if="rec.filesPurged" class="hd-note" data-testid="hd-purged"><LcIcon name="trash" size="s" />{{ t('history.detail.purged') }}</p>
            <p v-else-if="!outputs.length" class="lc-help">{{ t('history.detail.noOutputs') }}</p>
            <div v-else class="hd-outs">
              <div v-for="(o, i) in outputs" :key="o.url" class="hd-out">
                <button class="lc-thumb hd-out-thumb" type="button" v-tip="t('history.detail.preview')" :aria-label="t('history.detail.preview')" @click="emit('preview', o)">
                  <img v-if="o.type === 'image' || (o.thumbnailUrl && o.thumbnailUrl !== o.url)" :src="ensureHttps(o.thumbnailUrl || o.url)" alt="" loading="lazy" />
                  <video v-else :src="ensureHttps(o.url)" muted playsinline preload="metadata" />
                  <span v-if="o.type === 'video'" class="play"><LcIcon name="play" /></span>
                </button>
                <button class="lc-tb sm hd-out-dl" type="button" v-tip="t('common.download')" :aria-label="t('common.download')" @click="emit('download', o, i)"><LcIcon name="download" size="s" /></button>
              </div>
            </div>
          </section>

          <section v-if="rec.kind === 'chat' && rec.status === 'succeeded'" class="hd-block" data-block="reply">
            <h3>
              <span>{{ t('history.detail.reply') }}<small v-if="rec.textLength" class="hd-len">{{ t('history.detail.chars', { n: formatInt(rec.textLength) }, rec.textLength) }}</small></span>
              <button v-if="rec.text" class="lc-btn sm text" type="button" :disabled="loading && !!rec.textTruncated" data-act="copy-reply" @click="copy(rec.text || '', 'history.replyCopied')"><LcIcon name="copy" size="s" />{{ t('common.copy') }}</button>
            </h3>
            <pre v-if="rec.text" class="hd-pre tall" data-testid="hd-reply" tabindex="0">{{ rec.text }}<span v-if="rec.textTruncated" class="hd-cut">…</span></pre>
            <p v-else class="lc-help">{{ t('history.detail.noReply') }}</p>
          </section>

          <section class="hd-block" data-block="prompt">
            <h3>
              <span>{{ t('history.detail.prompt') }}<small v-if="(rec.promptLength || 0) > 200" class="hd-len">{{ t('history.detail.chars', { n: formatInt(rec.promptLength || 0) }, rec.promptLength || 0) }}</small></span>
              <button v-if="rec.prompt" class="lc-btn sm text" type="button" :disabled="loading && !!rec.promptTruncated" data-act="copy-prompt" @click="copy(rec.prompt || '', 'history.promptCopied')"><LcIcon name="copy" size="s" />{{ t('common.copy') }}</button>
            </h3>
            <pre v-if="rec.prompt" class="hd-pre" data-testid="hd-prompt" tabindex="0">{{ rec.prompt }}<span v-if="rec.promptTruncated" class="hd-cut">…</span></pre>
            <p v-else class="lc-help">{{ t('history.noPrompt') }}</p>
            <!-- 列表里只有前一段：全文正在取 / 没取到 -->
            <p v-if="loading && (rec.promptTruncated || rec.textTruncated)" class="lc-help" role="status">{{ t('history.detail.loading') }}</p>
            <p v-else-if="loadError && (rec.promptTruncated || rec.textTruncated)" class="lc-help err" role="alert" data-testid="hd-load-failed">
              {{ t('history.detail.loadFailed') }}
              <button class="lc-btn sm text" type="button" @click="load">{{ t('common.retry') }}</button>
            </p>
          </section>

          <section v-if="rec.systemPrompt" class="hd-block" data-block="system">
            <h3>
              <span>{{ t('history.detail.systemPrompt') }}</span>
              <button class="lc-btn sm text" type="button" data-act="copy-system" @click="copy(rec.systemPrompt || '', 'history.copied')"><LcIcon name="copy" size="s" />{{ t('common.copy') }}</button>
            </h3>
            <pre class="hd-pre" data-testid="hd-system" tabindex="0">{{ rec.systemPrompt }}</pre>
          </section>

          <section v-if="inputImages + inputVideos > 0" class="hd-block" data-block="inputs">
            <h3><span>{{ t('history.detail.inputs') }}<small class="hd-len">{{ inputsText }}</small></span></h3>
            <div v-if="imageUrls.length" class="hd-ins">
              <button
                v-for="u in imageUrls" :key="u" class="lc-thumb hd-in" type="button"
                v-tip="t('history.detail.preview')" :aria-label="t('history.detail.preview')" @click="emit('preview', { type: 'image', url: u })"
              ><img :src="ensureHttps(u)" alt="" loading="lazy" /></button>
            </div>
          </section>

          <section v-if="paramList.length" class="hd-block" data-block="params">
            <h3><span>{{ t('history.detail.params') }}</span></h3>
            <div class="hd-params">
              <span v-for="p in paramList" :key="p.key" class="lc-chip o"><span class="lc-t3" :class="{ 'lc-mono': p.raw }">{{ p.label }}</span>{{ p.value }}</span>
            </div>
          </section>

          <section class="hd-block" data-block="info">
            <h3><span>{{ t('history.detail.info') }}</span></h3>
            <dl class="hd-info">
              <div><dt>{{ t('history.detail.model') }}</dt><dd>{{ rec.modelLabel || rec.model }}<small class="lc-mono">{{ rec.model }}</small></dd></div>
              <div v-if="showMember">
                <dt>{{ t('history.detail.startedBy') }}</dt>
                <dd class="hd-who" data-testid="hd-who"><PersonName :person="rec.createdBy" :avatar="22" /><small v-if="whoSub">{{ whoSub }}</small></dd>
              </div>
              <div v-if="rec.providerType"><dt>{{ t('history.detail.provider') }}</dt><dd>{{ vendorLabel({ type: rec.providerType, label: rec.providerType }) }}</dd></div>
              <div>
                <dt>{{ t('history.detail.canvas') }}</dt>
                <dd>
                  <router-link v-if="canvasExists" :to="'/canvas/' + rec.workflowId">{{ canvasName }}</router-link>
                  <span v-else class="lc-t3">{{ canvasName }}</span>
                </dd>
              </div>
              <div v-if="rec.kind === 'chat'" data-row="tokens">
                <dt>{{ t('history.detail.tokens') }}</dt>
                <dd v-if="rec.usage" class="hd-tok">
                  <span data-testid="hd-tokens-in">{{ t('history.detail.tokensIn', { n: formatInt(rec.usage.inputTokens) }) }}</span>
                  <span data-testid="hd-tokens-out">{{ t('history.detail.tokensOut', { n: formatInt(rec.usage.outputTokens) }) }}</span>
                  <span class="lc-t3">{{ t('history.detail.tokensTotal', { n: formatInt(rec.usage.totalTokens) }) }}</span>
                </dd>
                <dd v-else class="lc-t3">{{ rec.status === 'succeeded' ? t('history.detail.tokensNone') : '—' }}</dd>
              </div>
              <div v-else><dt>{{ t('history.detail.count') }}</dt><dd class="lc-mono">{{ rec.count || 1 }}</dd></div>
              <div v-if="$feat.cost" data-row="cost">
                <dt>{{ t('history.detail.cost') }}</dt>
                <dd class="hd-cost" :class="'k-' + cost.kind" data-testid="hd-cost">
                  <span>{{ cost.kind === 'estimate' && cost.text !== '—' ? t('history.cost.estimate') + ' ' + cost.text : cost.text }}</span>
                  <small>{{ cost.note }}</small>
                </dd>
              </div>
              <div><dt>{{ t('history.detail.created') }}</dt><dd>{{ formatFull(rec.createdAt) }}</dd></div>
              <div data-row="queued"><dt>{{ t('history.detail.queued') }}</dt><dd class="lc-mono">{{ formatDuration(queuedMs) }}</dd></div>
              <div><dt>{{ t('history.detail.started') }}</dt><dd>{{ formatFull(rec.startedAt) }}</dd></div>
              <div><dt>{{ t('history.detail.finished') }}</dt><dd>{{ formatFull(rec.finishedAt) }}</dd></div>
              <div data-row="duration"><dt>{{ t('history.detail.duration') }}</dt><dd class="lc-mono">{{ formatDuration(durationMs(rec)) }}</dd></div>
              <div>
                <dt>{{ t('history.detail.runId') }}</dt>
                <dd class="hd-idrow">
                  <span class="lc-mono hd-id">{{ rec.id }}</span>
                  <button class="lc-tb sm" type="button" v-tip="t('history.detail.copyId')" :aria-label="t('history.detail.copyId')" data-act="copy-id" @click="copy(rec.id, 'history.copied')"><LcIcon name="copy" size="s" /></button>
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <div class="lc-dialog-foot">
          <router-link v-if="canvasExists" class="lc-btn" :to="'/canvas/' + rec.workflowId"><LcIcon name="canvas" />{{ t('history.act.openCanvas') }}</router-link>
          <button class="lc-btn" type="button" data-autofocus @click="emit('close')">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 一条生成记录的详情。打开时先用列表里那一份画出来（提示词、回复可能只是前一段），同时按 id 读全文
 * （完整的提示词和回复、系统提示词、随提示词发出去的文件），读到就换上；读不到就留着前一段并说明。
 * 图片 / 视频运行的结果文件就在记录里；文件已按保留期清理的（filesPurged）说清楚，而不是「没有结果」。
 * 「成本」和列表是同一个口径（historyFormat 的 costOf）：失败、取消的不计费。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'
import PersonName from '@/components/PersonName.vue'
import { vDialog } from '@/directives/dialog'
import { adminApi, unwrap, apiErrorCode } from '@/utils/api'
import { ensureHttps } from '@/utils/mediaUrl'
import { personState } from '@/utils/person'
import { vendorLabel } from '@/utils/providerMeta'
import { writeClipboard } from '@/utils/clipboard'
import { costOf, durationMs, formatDuration, formatFull, formatInt, isActive, statusClass } from './historyFormat'
import { clipLength } from '@/utils/duration'
import type { RunOutput, UsageRecord } from '@/types'

const props = defineProps<{
  /** 列表里的那一行（会跟着轮询更新：状态、进度） */
  record: UsageRecord
  canvasName: string
  canvasExists: boolean
  /** 团队里：显示这次运行是谁发起的 */
  showMember?: boolean
  /** 这条记录的压缩包正在打 */
  zipping?: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'preview', o: RunOutput): void
  (e: 'download', o: RunOutput, index: number): void
  (e: 'download-all'): void
  /** 读到了全文：页面留一份，复制提示词时不用再取 */
  (e: 'loaded', r: UsageRecord): void
}>()

const { t } = useI18n()

const full = ref<UsageRecord | null>(null)
const loading = ref(false)
const loadError = ref(false)
const gone = ref(false)
/**
 * 画的是哪一份：全文读到了、并且还是列表上的那个状态，用全文；
 * 列表上的状态往前走了（跑完了）而全文还没重取到，先用列表上的。
 */
const rec = computed<UsageRecord>(() => (full.value && full.value.id === props.record.id && full.value.status === props.record.status
  ? { ...props.record, ...full.value, progress: props.record.progress }
  : props.record))

let seq = 0
async function load() {
  const mine = ++seq
  loading.value = true
  loadError.value = false
  try {
    const data = unwrap(await adminApi.usageRecord(props.record.id))
    if (mine !== seq) return
    full.value = data
    gone.value = false
    emit('loaded', data)
  } catch (err) {
    if (mine !== seq) return
    if (apiErrorCode(err) === 'run.not_found') gone.value = true
    else loadError.value = true
  } finally {
    if (mine === seq) loading.value = false
  }
}
// 打开时读一次；开着的时候这条记录跑完了（状态变了）再读一次
watch(() => [props.record.id, props.record.status], load, { immediate: true })

const active = computed(() => isActive(rec.value.status))
const outputs = computed<RunOutput[]>(() => (rec.value.status === 'succeeded' ? rec.value.outputs || [] : []))
const progress = computed(() => {
  const p = Math.round(Number(props.record.progress) || 0)
  return p > 0 && p < 100 ? p : 0
})
const cost = computed(() => costOf(rec.value))
const queuedMs = computed(() => {
  const r = rec.value
  if (typeof r.queuedMs === 'number') return r.queuedMs
  if (!r.startedAt) return null
  const ms = new Date(r.startedAt).getTime() - new Date(r.createdAt).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms : null
})
/** 名字后面的小字：还在的人写 @用户名（去向由 PersonName 的标签说） */
const whoSub = computed(() => {
  const p = rec.value.createdBy
  return p?.username && personState(p) === 'active' && p.name !== p.username ? '@' + p.username : ''
})

const imageUrls = computed(() => (rec.value.imageUrls || []).slice(0, 12))
const inputImages = computed(() => rec.value.inputs?.images ?? rec.value.imageUrls?.length ?? 0)
const inputVideos = computed(() => rec.value.inputs?.videos ?? rec.value.videoUrls?.length ?? 0)
const inputsText = computed(() => [
  inputImages.value ? t('history.detail.inputImages', { n: inputImages.value }, inputImages.value) : '',
  inputVideos.value ? t('history.detail.inputVideos', { n: inputVideos.value }, inputVideos.value) : '',
].filter(Boolean).join(' · '))

/**
 * 运行参数：键是接口字段名（aspectRatio、imgMode…），值是接口里的写法（auto、frames、5）。
 * 认得的换成界面上同一个选项的叫法；不认得的（以后新加的参数）原样显示，键用等宽字标出来是原始名。
 */
const PARAM_ORDER = ['aspectRatio', 'resolution', 'duration', 'imgMode', 'count']
function paramLabel(key: string): string | null {
  if (key === 'aspectRatio' || key === 'resolution' || key === 'duration' || key === 'count') return t('nodes.field.' + key)
  if (key === 'imgMode') return t('history.detail.imgMode')
  return null
}
function paramValue(key: string, v: unknown): string {
  if (key === 'aspectRatio' && v === 'auto') return t('models.auto')
  if (key === 'duration' && Number(v) > 0) return clipLength(Number(v))
  if (key === 'imgMode' && v === 'frames') return t('models.imgModeFrames')
  if (key === 'imgMode' && v === 'multi') return t('models.imgModeMulti')
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no')
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}
const paramList = computed(() => Object.entries(rec.value.params || {})
  .filter(([, v]) => v !== '' && v !== null && v !== undefined)
  .sort(([a], [b]) => {
    const [ia, ib] = [PARAM_ORDER.indexOf(a), PARAM_ORDER.indexOf(b)]
    return (ia < 0 ? PARAM_ORDER.length : ia) - (ib < 0 ? PARAM_ORDER.length : ib)
  })
  .map(([key, v]) => {
    const label = paramLabel(key)
    return { key, label: label ?? key, raw: label === null, value: paramValue(key, v) }
  }))

async function copy(text: string, doneKey: string) {
  try {
    await writeClipboard(text)
    MessagePlugin.success(t(doneKey))
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}

/** 按下和松开都在遮罩上才算「点外面」：在文字上拖选、松手时滑到外面不算 */
const downOnMask = ref(false)
</script>

<style scoped>
.hd { width: 680px; }
.hd-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.hd-title .lc-st { font-family: var(--f-body); font-weight: 400; }
.hd-body { display: flex; flex-direction: column; gap: 20px; }
.hd-block { min-width: 0; }
.hd-block h3 { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; font: 600 13px/1.4 var(--f-body); color: var(--text-2); margin-bottom: 6px; }
.hd-block h3 > span { min-width: 0; }
.hd-len { margin-left: 8px; font: 400 12px var(--f-body); color: var(--text-3); font-variant-numeric: tabular-nums; }
.hd-why { min-width: 0; }
.hd-err { margin-top: 2px; overflow-wrap: anywhere; }
.hd-code { margin-top: 6px; font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hd-code code { font: 12px var(--f-mono); color: var(--text-2); padding: 1px 6px; border-radius: 5px; background: rgb(var(--c-film) / .1); user-select: all; overflow-wrap: anywhere; }
.hd-running { display: flex; align-items: center; gap: 12px; color: var(--text-2); font-size: 13px; }
.hd-note { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.6; color: var(--text-2); padding: 10px 12px; border: 1px dashed var(--line-2); border-radius: var(--r-sm); }
.hd-note svg { flex: none; margin-top: 3px; color: var(--text-3); }
.hd-pre {
  margin: 0; padding: 10px 12px; max-height: 200px; overflow-y: auto;
  background: var(--well); border: 1px solid var(--line); border-radius: var(--r-sm);
  font: 13px/1.7 var(--f-body); color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere;
}
.hd-pre.tall { max-height: 320px; }
.hd-pre:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
.hd-cut { color: var(--text-3); }
.hd-outs { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
.hd-out { position: relative; }
.hd-out-thumb { display: block; width: 100%; aspect-ratio: 4 / 3; padding: 0; border: 1px solid var(--line); border-radius: var(--r-sm); cursor: zoom-in; }
.hd-out-thumb:hover, .hd-in:hover { border-color: var(--line-3); }
.hd-out-thumb:focus-visible, .hd-in:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.hd-out-thumb .play { position: absolute; inset: 0; display: grid; place-items: center; color: var(--on-media); pointer-events: none; }
.hd-out-dl { position: absolute; right: 6px; bottom: 6px; background: rgb(var(--c-scrim) / .72); color: var(--on-media); }
.hd-out-dl:hover:not(:disabled) { background: rgb(var(--c-scrim) / .9); }
.hd-ins { display: flex; flex-wrap: wrap; gap: 8px; }
.hd-in { width: 56px; height: 56px; padding: 0; border: 1px solid var(--line); border-radius: 8px; cursor: zoom-in; }
.hd-params { display: flex; flex-wrap: wrap; gap: 6px; }
.hd-params .lc-chip { height: auto; min-height: 22px; padding: 3px 8px; gap: 6px; white-space: normal; word-break: break-all; line-height: 1.4; color: var(--text); }
.hd-info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; margin: 0; }
.hd-info > div { min-width: 0; }
.hd-info dt { font-size: 12px; color: var(--text-3); }
.hd-info dd { margin: 0; font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
.hd-info dd small { display: block; font-size: 11px; line-height: 1.5; color: var(--text-3); overflow-wrap: anywhere; }
.hd-info dd.lc-mono { font-size: 12px; }
.hd-info dd.lc-t3 { color: var(--text-3); }
.hd-info dd.hd-who { margin-top: 2px; }
.hd-info dd.hd-who :deep(.pn-tag) { height: 18px; padding: 0 6px; font-size: 11px; }
.hd-tok { display: flex; flex-wrap: wrap; gap: 2px 12px; font-variant-numeric: tabular-nums; }
.hd-cost > span { font-variant-numeric: tabular-nums; }
.hd-cost.k-none > span, .hd-cost.k-unknown > span { color: var(--text-2); }
.hd-idrow { display: flex; align-items: center; gap: 6px; }
.hd-id { font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
.spinning { animation: spin 1s linear infinite; }
@media (max-width: 600px) {
  .hd-info { grid-template-columns: minmax(0, 1fr); }
}
</style>
