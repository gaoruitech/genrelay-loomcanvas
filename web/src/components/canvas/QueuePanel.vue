<template>
  <aside class="qp lc-gb" :aria-label="t('queue.title')" @mousedown.stop @wheel.stop>
    <header class="qp-hd">
      <div class="qp-hd-row">
        <b>{{ t('queue.title') }}</b>
        <span class="lc-sp" />
        <span v-if="running.length" class="lc-chip" :title="t('queue.slotsTip', { max: MAX_CONCURRENT })">
          {{ t('queue.slots', { n: running.length, max: MAX_CONCURRENT }) }}
        </span>
        <button class="lc-tb sm" :title="t('queue.collapse')" :aria-label="t('queue.collapse')" @click="emit('close')">
          <LcIcon name="x" size="s" />
        </button>
      </div>
      <small>{{ t('queue.summary', { running: running.length, queued: queued.length, done: doneCount }) }}<template v-if="failedCount"> · {{ t('queue.failedN', { n: failedCount }) }}</template><template v-if="blocked.length"> · {{ t('queue.blockedN', { n: blocked.length }) }}</template></small>
    </header>

    <div class="qp-bd">
      <!-- 进行中 -->
      <div
        v-for="it in running"
        :key="'r-' + it.nodeId"
        class="qt act"
        role="button"
        tabindex="0"
        :title="t('queue.locate')"
        @click="emit('focus', it.nodeId)"
        @keydown.enter="emit('focus', it.nodeId)"
      >
        <div class="r1">
          <!-- 上游报了进度才画数字；没报就只转圈，不编百分比 -->
          <span v-if="it.progress > 0" class="lc-ring" :style="{ '--p': it.progress, '--s': '48px' }"><span>{{ it.progress }}%</span></span>
          <span v-else class="lc-ring spin" style="--s: 48px" aria-hidden="true" />
          <div class="qt-txt">
            <b>{{ it.title }}</b>
            <small v-if="it.sub">{{ it.sub }}</small>
            <small v-if="it.startedAt" class="lc-mono">{{ t('queue.elapsed', { time: clock(now - it.startedAt) }) }}</small>
          </div>
          <button
            v-if="it.cancelable"
            class="lc-tb sm qt-x"
            :disabled="canceling.has(it.nodeId)"
            :title="t('queue.cancel')"
            :aria-label="t('queue.cancel')"
            @click.stop="cancelOne(it.nodeId)"
          ><LcIcon name="stop" size="s" /></button>
        </div>
        <div class="r2">
          <span class="qt-params">{{ it.params || '—' }}</span>
          <span class="lc-st run">{{ it.local ? t('queue.processing') : t('queue.generating') }}</span>
        </div>
      </div>

      <!-- 排队：等上游节点出结果，或等并发名额 -->
      <div
        v-for="it in queued"
        :key="'q-' + it.nodeId"
        class="qt"
        role="button"
        tabindex="0"
        :title="t('queue.locate')"
        @click="emit('focus', it.nodeId)"
        @keydown.enter="emit('focus', it.nodeId)"
      >
        <div class="r1">
          <span class="lc-ring q" style="--s: 48px"><span>{{ t('queue.ringQueued') }}</span></span>
          <div class="qt-txt">
            <b>{{ it.title }}</b>
            <small v-if="it.sub">{{ it.sub }}</small>
          </div>
        </div>
        <div class="r2">
          <span class="qt-params">{{ it.params || '—' }}</span>
          <span class="lc-st wait">{{ t('queue.waiting') }}</span>
        </div>
      </div>

      <!-- 没能开始：运行前的检查没过（缺提示词、缺参考图、模型不可用…），任务根本没提交。
           原因同时写在节点上；这里也列一份，盯着队列看的人不至于以为点了没反应 -->
      <template v-if="blocked.length">
        <div class="qlab">{{ t('queue.blocked') }}</div>
        <div class="qdone-list">
          <button
            v-for="b in blocked"
            :key="'b-' + b.nodeId"
            type="button"
            class="qdone error"
            :title="t('queue.locate')"
            @click="emit('focus', b.nodeId)"
          >
            <span class="thumb lc-thumb"><LcIcon name="warn" size="s" /></span>
            <span class="qdone-txt">
              <b>{{ b.title }}</b>
              <small class="qdone-err" :title="b.reason">{{ b.reason }}</small>
            </span>
          </button>
        </div>
      </template>

      <p v-if="!running.length && !queued.length && !finished.length && !blocked.length" class="qp-empty">
        <LcIcon name="queue" size="l" />
        <span>{{ t('queue.empty') }}</span>
      </p>
      <p v-else-if="!running.length && !queued.length" class="qp-idle">{{ t('queue.idle') }}</p>

      <!-- 已结束：成功的带真实产物缩略图，失败的带后端给的原因 -->
      <template v-if="finished.length">
        <div class="qlab">{{ t('queue.finished') }}</div>
        <div class="qdone-list">
          <button
            v-for="f in finished"
            :key="f.key"
            type="button"
            class="qdone"
            :class="f.status"
            :disabled="!f.alive"
            :title="f.alive ? t('queue.locate') : t('queue.nodeGone')"
            @click="emit('focus', f.nodeId)"
          >
            <span class="thumb lc-thumb">
              <img v-if="f.thumb && f.media === 'image'" :src="f.thumb" alt="" loading="lazy" />
              <video v-else-if="f.thumb && f.media === 'video'" :src="f.thumb" muted preload="metadata" playsinline />
              <LcIcon v-else :name="f.status === 'error' ? 'warn' : f.status === 'canceled' ? 'stop' : f.icon" size="s" />
            </span>
            <span class="qdone-txt">
              <b>{{ f.title }}</b>
              <small>
                <span class="lc-mono">{{ hhmm(f.at) }}</span>
                <template v-if="f.status === 'done' && f.durationMs != null"> · {{ t('queue.took', { time: span(f.durationMs) }) }}</template>
                <template v-else-if="f.status === 'canceled'"> · {{ t('queue.canceled') }}</template>
                <template v-else-if="f.status === 'error'"> · {{ t('queue.failed') }}</template>
              </small>
              <small v-if="f.status === 'error' && f.error" class="qdone-err" :title="f.error">{{ f.error }}</small>
            </span>
          </button>
        </div>
      </template>
    </div>

    <footer v-if="cancelableIds.length || finished.length" class="qp-ft">
      <ConfirmPop
        v-if="cancelableIds.length"
        class="qp-ft-pop"
        :text="t('queue.cancelAllAsk', { n: cancelableIds.length })"
        :hint="t('queue.cancelAllHint')"
        :ok-text="t('queue.cancelAll')"
        @ok="cancelAll"
      >
        <button class="lc-btn sm block">{{ t('queue.cancelAll') }}</button>
      </ConfirmPop>
      <button v-if="finished.length" class="lc-btn sm" @click="clearFinished">{{ t('queue.clearFinished') }}</button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
/**
 * 生成队列：这张画布上正在跑、在排队、跑完了的节点。
 *
 * 全部来自画布上的真实运行状态，这里不存任何「另一份」任务数据：
 *   进行中 / 排队   节点 data.status（执行器写的），进度是上游报回来的 data.progress
 *   已完成          节点 data.results（每一版产物带完成时间），加上本次打开页面期间
 *                   亲眼看到结束的那几次（失败、取消、不留版本历史的文字 / 工具节点）
 *   开始时间        本次会话里看到节点转入运行的那一刻；刷新后接回来的任务去问后端
 *                   那次运行的 startedAt，问不到就不显示用时
 * 没有剩余时间：上游不给，前端也不猜。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Node } from '@vue-flow/core'
import LcIcon from '@/components/LcIcon.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import { runsApi, unwrap } from '@/utils/api'
import { ensureHttps } from '@/utils/mediaUrl'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { getAdapter, listChatModels, listVideoChatModels } from '@/utils/canvasModels'
import { MAX_CONCURRENT, type NodeResultEntry } from '@/composables/useCanvasExecutor'

const props = defineProps<{
  nodes: Node[]
  /** 当前画布 id：「清空已完成」按画布记 */
  workflowId: string | null
  /** 节点类型 → 当前语言下的名字（和添加节点菜单同一份） */
  titleOf: (type: string) => string
  cancelNode: (nodeId: string) => Promise<void>
}>()

const emit = defineEmits<{
  (e: 'focus', nodeId: string): void
  (e: 'close'): void
}>()

const { t, locale } = useI18n()

const GEN_TYPES = new Set(['image-gen', 'image-edit', 'video-gen', 'video-edit'])
const VIDEO_TYPES = new Set(['video-gen', 'video-edit'])
const TEXT_TYPES = new Set(['llm', 'video-analysis'])
const ICONS: Record<string, string> = {
  'image-gen': 'image', 'image-edit': 'image', 'video-gen': 'video', 'video-edit': 'video',
  'llm': 'chat', 'video-analysis': 'chat',
}

function modelLabel(type: string, model: unknown): string {
  if (typeof model !== 'string' || !model) return ''
  if (GEN_TYPES.has(type)) return getAdapter(model)?.label || ''
  const list = type === 'video-analysis' ? listVideoChatModels() : listChatModels()
  return list.find((m) => m.id === model)?.label || ''
}

/** 节点上真实存着的那几项参数：时长 | 分辨率 | 比例 | 张数。没有的不显示 */
function paramText(type: string, d: Record<string, any>): string {
  if (!GEN_TYPES.has(type)) return ''
  const out: string[] = []
  if (VIDEO_TYPES.has(type) && Number(d.duration) > 0) out.push(t('models.seconds', { n: Number(d.duration) }))
  if (d.resolution) out.push(String(d.resolution))
  if (d.aspectRatio) out.push(String(d.aspectRatio))
  if (Number(d.count) > 1) out.push(t('queue.count', { n: Number(d.count) }))
  return out.join(' | ')
}

function taskIdsOf(d: Record<string, any>): string[] {
  if (Array.isArray(d.taskIds) && d.taskIds.length) return d.taskIds
  return d.taskId ? [d.taskId] : []
}

// ---------------- 进行中 / 排队：直接从节点状态算 ----------------
interface LiveItem {
  nodeId: string
  title: string
  sub: string
  params: string
  progress: number
  startedAt: number | null
  cancelable: boolean
  local: boolean
}
/** 节点 → 这次运行的开始时间（毫秒）。known=false：刷新后接回来的，还没问到后端 */
const starts = reactive(new Map<string, { at: number; known: boolean }>())

function liveItem(n: Node): LiveItem {
  const d = (n.data || {}) as Record<string, any>
  const type = String(n.type || '')
  const s = starts.get(n.id)
  const local = !GEN_TYPES.has(type) && !TEXT_TYPES.has(type)
  return {
    nodeId: n.id,
    title: props.titleOf(type),
    sub: local ? t('queue.local') : modelLabel(type, d.model),
    params: paramText(type, d),
    progress: Math.max(0, Math.min(99, Math.round(Number(d.progress) || 0))),
    startedAt: s && s.known ? s.at : null,
    // 取消只对已经提交到后端的运行有意义（执行器里也是这么判的）
    cancelable: d.runPending === true && taskIdsOf(d).length > 0,
    local,
  }
}
const running = computed(() => props.nodes.filter((n) => n.data?.status === 'running').map(liveItem))
const queued = computed(() => props.nodes.filter((n) => n.data?.status === 'queued').map(liveItem))
/** 运行前检查没过的节点：输入补齐后执行器会把 validationError 清掉，这里跟着消失 */
const blocked = computed(() => props.nodes
  .filter((n) => typeof n.data?.validationError === 'string' && n.data.validationError && n.data?.status !== 'running' && n.data?.status !== 'queued')
  .map((n) => ({ nodeId: n.id, title: props.titleOf(String(n.type || '')), reason: String(n.data.validationError) })))
const cancelableIds = computed(() => running.value.filter((i) => i.cancelable).map((i) => i.nodeId))

// ---------------- 状态变化：记开始时间、记结束 ----------------
interface SessionEnd {
  key: string
  nodeId: string
  type: string
  status: 'done' | 'error' | 'canceled'
  at: number
  durationMs: number | null
  error: string
  /** 成功且留了版本历史时，对应 data.results 里那一条的 id —— 用来把用时挂上去，避免重复列一遍 */
  resultId: string
  thumb: string
  media: 'image' | 'video' | ''
}
const session = ref<SessionEnd[]>([])
const prevStatus = new Map<string, string>()
let seq = 0

const statusSig = computed(() =>
  props.nodes.map((n) => `${n.id}:${n.data?.status || ''}:${n.data?.runPending === true ? taskIdsOf(n.data).join(',') : ''}`).join('|'))

async function askStart(nodeId: string, ids: string[]) {
  try {
    const runs = unwrap(await runsApi.status(ids))
    const times = (Array.isArray(runs) ? runs : [])
      .map((r) => Date.parse(r.startedAt || r.createdAt || ''))
      .filter((x) => Number.isFinite(x))
    const cur = starts.get(nodeId)
    if (times.length && cur && !cur.known) starts.set(nodeId, { at: Math.min(...times), known: true })
  } catch { /* 问不到就不显示用时，不影响别的 */ }
}

function sync() {
  const seen = new Set<string>()
  for (const n of props.nodes) {
    seen.add(n.id)
    const d = (n.data || {}) as Record<string, any>
    const type = String(n.type || '')
    const cur = String(d.status || '')
    const prev = prevStatus.get(n.id) || ''
    prevStatus.set(n.id, cur)

    if (cur === 'running') {
      if (prev !== 'running') {
        // 转入运行的这一刻已经带着在途任务号 = 刷新后接回来的，真正的开始时间在后端
        const resumed = d.runPending === true && taskIdsOf(d).length > 0
        starts.set(n.id, { at: Date.now(), known: !resumed })
      }
      const s = starts.get(n.id)
      if (s && !s.known && GEN_TYPES.has(type) && !asked.has(n.id)) {
        const ids = taskIdsOf(d)
        if (ids.length) { asked.add(n.id); void askStart(n.id, ids) }
      }
      continue
    }
    if (prev !== 'running') continue
    asked.delete(n.id)

    // 刚结束
    const s = starts.get(n.id)
    starts.delete(n.id)
    const now = Date.now()
    const status: SessionEnd['status'] | '' = cur === 'error' ? 'error' : cur === 'canceled' ? 'canceled' : cur === 'done' ? 'done' : ''
    if (!status) continue
    const top: NodeResultEntry | undefined = Array.isArray(d.results) ? d.results[0] : undefined
    // 这一版是不是刚压进历史的：完成时间就在刚才
    const fresh = status === 'done' && top && now - top.at < 15000
    const isVideo = VIDEO_TYPES.has(type)
    const url = status === 'done'
      ? String(isVideo ? (d.videoUrl || '') : (d.imageUrl || (Array.isArray(d.imageUrls) ? d.imageUrls[0] : '') || ''))
      : ''
    session.value = [{
      key: 's' + (seq++),
      nodeId: n.id,
      type,
      status,
      at: fresh ? top!.at : now,
      durationMs: s && s.known ? Math.max(0, now - s.at) : null,
      error: status === 'error' ? String(d.errorMsg || '') : '',
      resultId: fresh ? top!.id : '',
      thumb: url,
      media: (url ? (isVideo ? 'video' : 'image') : '') as SessionEnd['media'],
    }, ...session.value].slice(0, 60)
  }
  for (const id of [...prevStatus.keys()]) if (!seen.has(id)) { prevStatus.delete(id); starts.delete(id); asked.delete(id) }
}
const asked = new Set<string>()
watch(statusSig, sync, { immediate: true })

// 切换语言：失败原因是后端按当时语言给的，执行器会重取并写回节点，这里跟着换
watch(locale, () => {
  setTimeout(() => {
    for (const e of session.value) {
      if (e.status !== 'error') continue
      const n = props.nodes.find((x) => x.id === e.nodeId)
      const msg = n?.data?.status === 'error' ? String(n.data.errorMsg || '') : ''
      if (msg) e.error = msg
    }
  }, 1500)
})

// ---------------- 已结束列表 ----------------
const CLEAR_KEY = 'lc-queue-cleared'
function readCleared(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(CLEAR_KEY) || '{}') || {} } catch { return {} }
}
const clearedAt = ref(0)
watch(() => props.workflowId, (id) => {
  clearedAt.value = id ? Number(readCleared()[id]) || 0 : 0
  // 换画布：上一张画布的会话记录不该留着
  session.value = []
}, { immediate: true })

function clearFinished() {
  clearedAt.value = Date.now()
  session.value = []
  if (!props.workflowId) return
  try {
    const all = readCleared()
    all[props.workflowId] = clearedAt.value
    localStorage.setItem(CLEAR_KEY, JSON.stringify(all))
  } catch { /* 存不了就只清本次 */ }
}

interface FinishedItem {
  key: string
  nodeId: string
  title: string
  status: 'done' | 'error' | 'canceled'
  at: number
  durationMs: number | null
  error: string
  thumb: string
  media: 'image' | 'video' | ''
  icon: string
  alive: boolean
}
const MAX_FINISHED = 30

function thumbSrc(url: string, media: string): string {
  if (!url) return ''
  const u = ensureHttps(url)
  // 视频取第一帧当缩略图
  return media === 'video' ? (u.includes('#') ? u : u + '#t=0.1') : canvasImageThumb(u)
}

const finished = computed<FinishedItem[]>(() => {
  const out: FinishedItem[] = []
  const alive = new Set(props.nodes.map((n) => n.id))
  const durByResult = new Map<string, number | null>()
  const typeOf = new Map(props.nodes.map((n) => [n.id, String(n.type || '')]))
  for (const e of session.value) {
    if (e.resultId) { durByResult.set(e.resultId, e.durationMs); continue }
    out.push({
      key: e.key, nodeId: e.nodeId, title: props.titleOf(e.type), status: e.status, at: e.at,
      durationMs: e.durationMs, error: e.error, thumb: thumbSrc(e.thumb, e.media), media: e.media,
      icon: ICONS[e.type] || 'tool', alive: alive.has(e.nodeId),
    })
  }
  // 节点自己的版本历史：每一版都是一次真实完成的运行
  for (const n of props.nodes) {
    const list: NodeResultEntry[] = Array.isArray(n.data?.results) ? n.data.results : []
    const type = typeOf.get(n.id) || ''
    const media = VIDEO_TYPES.has(type) ? 'video' : 'image'
    for (const r of list) {
      if (!r || !r.at) continue
      out.push({
        key: n.id + ':' + r.id, nodeId: n.id, title: props.titleOf(type), status: 'done', at: r.at,
        durationMs: durByResult.has(r.id) ? durByResult.get(r.id)! : null,
        error: '', thumb: thumbSrc(r.urls?.[0] || '', media), media,
        icon: ICONS[type] || 'tool', alive: true,
      })
    }
  }
  return out.filter((f) => f.at > clearedAt.value).sort((a, b) => b.at - a.at).slice(0, MAX_FINISHED)
})
const doneCount = computed(() => finished.value.filter((f) => f.status === 'done').length)
const failedCount = computed(() => finished.value.filter((f) => f.status === 'error').length)

// ---------------- 取消 ----------------
const canceling = reactive(new Set<string>())
async function cancelOne(nodeId: string) {
  if (canceling.has(nodeId)) return
  canceling.add(nodeId)
  try { await props.cancelNode(nodeId) } finally { canceling.delete(nodeId) }
}
function cancelAll() {
  for (const id of cancelableIds.value) void cancelOne(id)
}

// ---------------- 用时：每秒走一下，只在有任务在跑时开表 ----------------
const now = ref(Date.now())
let timer: number | null = null
watch(() => running.value.length > 0, (on) => {
  if (on && timer === null) {
    now.value = Date.now()
    timer = window.setInterval(() => { now.value = Date.now() }, 1000)
  } else if (!on && timer !== null) {
    clearInterval(timer)
    timer = null
  }
}, { immediate: true })
onBeforeUnmount(() => { if (timer !== null) clearInterval(timer) })

const pad = (n: number) => String(n).padStart(2, '0')
/** 0:42 / 12:05 / 1:02:03 */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
/** 24 秒 / 1 分 52 秒 */
function span(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m ? t('queue.minSec', { m, s: s % 60 }) : t('queue.sec', { s })
}
function hhmm(at: number): string {
  const d = new Date(at)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return time
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
}
</script>

<style scoped>
.qp {
  position: absolute; z-index: 5; right: 16px; top: 16px; bottom: 16px; width: 264px;
  display: flex; flex-direction: column; min-height: 0;
  border-radius: 16px; border: 1px solid transparent;
  background: rgba(12, 21, 52, .88); box-shadow: var(--sh-1);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.qp-hd { padding: 12px 10px 12px 16px; border-bottom: 1px solid var(--line); flex: none; }
.qp-hd-row { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.qp-hd b { font: 600 14px/1.4 var(--f-disp); color: var(--text); white-space: nowrap; }
.qp-hd small { display: block; color: var(--text-3); font-size: 12px; margin-top: 2px; padding-right: 6px; }

.qp-bd { padding: 12px; display: grid; gap: 10px; align-content: start; flex: 1; min-height: 0; overflow-y: auto; }

.qt {
  padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: rgba(4, 9, 28, .45);
  cursor: pointer; min-width: 0; transition: border-color .15s, background .15s;
}
.qt:hover { border-color: var(--line-3); background: rgba(4, 9, 28, .6); }
.qt:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
.qt.act { border-color: rgba(63, 216, 255, .4); }
.qt .r1 { display: flex; gap: 12px; align-items: center; min-width: 0; }
.qt-txt { min-width: 0; flex: 1; }
.qt b { display: block; font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qt small { display: block; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qt-x { align-self: flex-start; margin: -4px -4px 0 0; }
.qt-x:hover:not(:disabled) { background: rgba(255, 107, 139, .14); color: var(--err-soft); }
.qt .r2 {
  display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; padding-top: 8px;
  border-top: 1px solid var(--line); font-size: 12px; color: var(--text-2);
}
.qt-params { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qt .lc-st { font-size: 12px; flex: none; }
.qt .lc-ring { font-size: 12px; }
.qt .lc-ring.q { font-size: 11px; }

.qp-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
  padding: 32px 12px; color: var(--text-3); font-size: 13px; line-height: 1.6;
}
.qp-idle { font-size: 12px; color: var(--text-3); padding: 2px 4px; }

.qlab { font-size: 12px; color: var(--text-3); padding: 4px 4px 0; }
.qdone-list { display: grid; }
.qdone {
  display: flex; gap: 10px; align-items: center; padding: 6px 4px; border: 0; border-radius: 8px;
  background: none; text-align: left; min-width: 0; width: 100%; color: inherit;
}
.qdone:hover:not(:disabled) { background: rgba(124, 160, 255, .08); }
.qdone:disabled { cursor: default; }
.qdone:focus-visible { outline: none; box-shadow: var(--ring); }
.qdone .thumb {
  width: 44px; height: 32px; border-radius: 6px; flex: none; display: grid; place-items: center;
  border: 1px solid var(--line); color: var(--text-3);
}
.qdone.error .thumb { color: var(--err); border-color: rgba(255, 107, 139, .35); background: rgba(255, 107, 139, .08); }
.qdone-txt { min-width: 0; flex: 1; }
.qdone b { font-size: 12px; font-weight: 500; display: block; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qdone small { font-size: 11px; color: var(--text-3); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qdone small.qdone-err {
  color: var(--err-soft); white-space: normal; line-height: 1.5;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2;
}

.qp-ft { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--line); flex: none; }
.qp-ft > * { flex: 1 1 0; min-width: 0; }
.qp-ft-pop :deep(.cp-trigger) { width: 100%; }

/* 手机：从底部升起的一张抽屉 */
@media (max-width: 640px) {
  .qp { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: min(70%, 520px); z-index: 41; box-shadow: var(--sh-2); background: rgba(12, 21, 52, .97); }
}
</style>
