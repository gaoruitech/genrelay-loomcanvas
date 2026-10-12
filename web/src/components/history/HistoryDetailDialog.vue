<template>
  <div class="lc-mask" @click.self="emit('close')">
    <div class="lc-dialog hd" role="dialog" aria-modal="true" :aria-label="t('history.detail.title')">
      <div class="lc-dialog-head">
        <span class="hd-title">
          {{ t('history.detail.title') }}
          <span class="lc-bd" :class="record.kind">{{ t('history.kinds.' + record.kind) }}</span>
          <span class="lc-st" :class="statusClass(record.status)">{{ t('history.statuses.' + record.status) }}</span>
        </span>
        <button class="lc-x" type="button" :title="t('common.close')" @click="emit('close')">×</button>
      </div>

      <div class="lc-dialog-body hd-body">
        <div v-if="record.status === 'failed' && record.error" class="lc-alert hd-block">
          <LcIcon name="warn" />
          <div><b>{{ t('history.detail.error') }}</b><div class="hd-err">{{ record.error }}</div></div>
        </div>

        <!-- 还在跑：只有接口给了进度才显示数字 -->
        <div v-if="active" class="hd-running hd-block">
          <span v-if="record.status === 'queued'" class="lc-ring sm q" />
          <span v-else-if="progress > 0" class="lc-ring sm" :style="{ '--p': progress }"><span>{{ progress }}</span></span>
          <span v-else class="lc-ring sm spin" />
          <span>{{ progress > 0 ? t('history.detail.progress', { n: progress }) : t('history.statuses.' + record.status) }}</span>
        </div>

        <section v-if="record.kind !== 'chat' && record.status === 'succeeded'" class="hd-block">
          <h3>{{ t('history.detail.outputs') }}</h3>
          <p v-if="extraError" class="lc-help err">{{ extraError }}</p>
          <p v-else-if="!outputs.length" class="lc-help">{{ extraLoading ? t('common.loading') : t('history.detail.noOutputs') }}</p>
          <div v-else class="hd-outs">
            <div v-for="(o, i) in outputs" :key="o.url" class="hd-out">
              <button class="lc-thumb hd-out-thumb" type="button" :title="t('history.detail.preview')" @click="emit('preview', o)">
                <img v-if="o.type === 'image' || (o.thumbnailUrl && o.thumbnailUrl !== o.url)" :src="ensureHttps(o.thumbnailUrl || o.url)" alt="" loading="lazy" />
                <video v-else :src="ensureHttps(o.url)" muted playsinline preload="metadata" />
                <span v-if="o.type === 'video'" class="play"><LcIcon name="play" /></span>
              </button>
              <button class="lc-tb sm hd-out-dl" type="button" :title="t('common.download')" @click="emit('download', o, i)"><LcIcon name="download" size="s" /></button>
            </div>
          </div>
        </section>

        <section v-if="record.kind === 'chat' && record.status === 'succeeded'" class="hd-block">
          <h3>{{ t('history.detail.reply') }}</h3>
          <p v-if="extraError" class="lc-help err">{{ extraError }}</p>
          <p v-else-if="!replyText" class="lc-help">{{ extraLoading ? t('common.loading') : '—' }}</p>
          <pre v-else class="hd-pre">{{ replyText }}</pre>
        </section>

        <section class="hd-block">
          <h3>
            {{ t('history.detail.prompt') }}
            <button v-if="record.prompt" class="lc-btn sm text" type="button" @click="emit('copy', record)"><LcIcon name="copy" size="s" />{{ t('common.copy') }}</button>
          </h3>
          <pre v-if="record.prompt" class="hd-pre">{{ record.prompt }}</pre>
          <p v-else class="lc-help">{{ t('history.noPrompt') }}</p>
          <p v-if="(record.prompt || '').length >= 200" class="lc-help">{{ t('history.detail.promptCut') }}</p>
        </section>

        <section v-if="paramList.length" class="hd-block">
          <h3>{{ t('history.detail.params') }}</h3>
          <div class="hd-params">
            <span v-for="p in paramList" :key="p.key" class="lc-chip o"><span class="lc-t3" :class="{ 'lc-mono': p.raw }">{{ p.label }}</span>{{ p.value }}</span>
          </div>
        </section>

        <section class="hd-block">
          <h3>{{ t('history.detail.info') }}</h3>
          <dl class="hd-info">
            <div><dt>{{ t('history.detail.model') }}</dt><dd>{{ record.modelLabel || record.model }}<small class="lc-mono">{{ record.model }}</small></dd></div>
            <div v-if="record.providerType"><dt>{{ t('history.detail.provider') }}</dt><dd>{{ vendorLabel({ type: record.providerType, label: record.providerType }) }}</dd></div>
            <div>
              <dt>{{ t('history.detail.canvas') }}</dt>
              <dd>
                <router-link v-if="canvasExists" :to="'/canvas/' + record.workflowId">{{ canvasName }}</router-link>
                <span v-else class="lc-t3">{{ canvasName }}</span>
              </dd>
            </div>
            <div><dt>{{ t('history.detail.count') }}</dt><dd class="lc-mono">{{ record.count || 1 }}</dd></div>
            <div><dt>{{ t('history.detail.created') }}</dt><dd>{{ formatFull(record.createdAt) }}</dd></div>
            <div><dt>{{ t('history.detail.started') }}</dt><dd>{{ formatFull(record.startedAt) }}</dd></div>
            <div><dt>{{ t('history.detail.finished') }}</dt><dd>{{ formatFull(record.finishedAt) }}</dd></div>
            <div><dt>{{ t('history.detail.duration') }}</dt><dd class="lc-mono">{{ formatDuration(durationMs(record)) }}</dd></div>
            <div><dt>{{ t('history.detail.cost') }}</dt><dd :class="{ 'lc-t3': !record.cost || record.cost.unknown }">{{ costText }}</dd></div>
            <div><dt>{{ t('history.detail.runId') }}</dt><dd class="lc-mono hd-id">{{ record.id }}</dd></div>
          </dl>
        </section>
      </div>

      <div class="lc-dialog-foot">
        <router-link v-if="canvasExists" class="lc-btn" :to="'/canvas/' + record.workflowId"><LcIcon name="canvas" />{{ t('history.act.openCanvas') }}</router-link>
        <button class="lc-btn" type="button" @click="emit('close')">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { llmApi, runsApi, unwrap, apiErrorMessage } from '@/utils/api'
import { formatCost } from '@/utils/cost'
import { ensureHttps } from '@/utils/mediaUrl'
import { vendorLabel } from '@/utils/providerMeta'
import { durationMs, formatDuration, formatFull, isActive, statusClass } from './historyFormat'
import type { Run, RunOutput, UsageRecord } from '@/types'

const props = defineProps<{
  record: UsageRecord
  /** 列表已经拉到的运行（结果文件、进度）；没有就自己拉 */
  run?: Run
  canvasName: string
  canvasExists: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'preview', o: RunOutput): void
  (e: 'download', o: RunOutput, index: number): void
  (e: 'copy', r: UsageRecord): void
}>()

const { t } = useI18n()

const active = computed(() => isActive(props.record.status))
const fetched = ref<Run | null>(null)
const replyText = ref('')
const extraLoading = ref(false)
const extraError = ref('')

const outputs = computed<RunOutput[]>(() => props.run?.outputs || fetched.value?.outputs || [])
const progress = computed(() => {
  const p = Math.round(Number(props.run?.progress) || 0)
  return p > 0 && p < 100 ? p : 0
})
const costText = computed(() => formatCost(props.record.cost) || '—')

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
  if (key === 'duration' && Number(v) > 0) return t('models.seconds', { n: Number(v) })
  if (key === 'imgMode' && v === 'frames') return t('models.imgModeFrames')
  if (key === 'imgMode' && v === 'multi') return t('models.imgModeMulti')
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no')
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}
const paramList = computed(() => Object.entries(props.record.params || {})
  .filter(([, v]) => v !== '' && v !== null && v !== undefined)
  .sort(([a], [b]) => {
    const [ia, ib] = [PARAM_ORDER.indexOf(a), PARAM_ORDER.indexOf(b)]
    return (ia < 0 ? PARAM_ORDER.length : ia) - (ib < 0 ? PARAM_ORDER.length : ib)
  })
  .map(([key, v]) => {
    const label = paramLabel(key)
    return { key, label: label ?? key, raw: label === null, value: paramValue(key, v) }
  }))

/** 结果文件不在记录里：图片 / 视频查运行，对话查它的回复 */
async function loadExtra() {
  if (props.record.status !== 'succeeded') return
  if (props.record.kind !== 'chat' && props.run) return
  extraLoading.value = true
  extraError.value = ''
  try {
    if (props.record.kind === 'chat') replyText.value = unwrap(await llmApi.get(props.record.id))?.text || ''
    else fetched.value = unwrap(await runsApi.get(props.record.id))
  } catch (err) {
    extraError.value = apiErrorMessage(err, t('history.detail.loadFailed'))
  } finally {
    extraLoading.value = false
  }
}
watch(() => [props.record.id, props.record.status], loadExtra, { immediate: true })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.hd { width: 640px; }
.hd-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.hd-title .lc-st { font-family: var(--f-body); font-weight: 400; }
.hd-body { display: flex; flex-direction: column; gap: 20px; }
.hd-block { min-width: 0; }
.hd-block h3 { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; font: 600 13px/1.4 var(--f-body); color: var(--text-2); margin-bottom: 6px; }
.hd-err { margin-top: 2px; word-break: break-word; }
.hd-running { display: flex; align-items: center; gap: 12px; color: var(--text-2); font-size: 13px; }
.hd-pre {
  margin: 0; padding: 10px 12px; max-height: 200px; overflow-y: auto;
  background: var(--well); border: 1px solid var(--line); border-radius: var(--r-sm);
  font: 13px/1.7 var(--f-body); color: var(--text); white-space: pre-wrap; word-break: break-word;
}
.hd-outs { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
.hd-out { position: relative; }
.hd-out-thumb { display: block; width: 100%; aspect-ratio: 4 / 3; padding: 0; border: 1px solid var(--line); border-radius: var(--r-sm); cursor: zoom-in; }
.hd-out-thumb:hover { border-color: var(--line-3); }
.hd-out-thumb:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.hd-out-dl { position: absolute; right: 6px; bottom: 6px; background: rgb(var(--c-scrim) / .72); color: var(--on-media); }
.hd-out-dl:hover:not(:disabled) { background: rgb(var(--c-scrim) / .9); }
.hd-params { display: flex; flex-wrap: wrap; gap: 6px; }
.hd-params .lc-chip { height: auto; min-height: 22px; padding: 3px 8px; gap: 6px; white-space: normal; word-break: break-all; line-height: 1.4; color: var(--text); }
.hd-info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; }
.hd-info > div { min-width: 0; }
.hd-info dt { font-size: 12px; color: var(--text-3); }
.hd-info dd { font-size: 13px; color: var(--text); word-break: break-word; }
.hd-info dd small { display: block; font-size: 11px; color: var(--text-3); word-break: break-all; }
.hd-info dd.lc-mono { font-size: 12px; }
.hd-info dd.lc-t3 { color: var(--text-3); }
.hd-id { word-break: break-all; }
@media (max-width: 600px) {
  .hd-info { grid-template-columns: minmax(0, 1fr); }
}
</style>
