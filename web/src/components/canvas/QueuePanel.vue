<template>
  <div ref="layerRef" class="qf-layer">
    <!-- 悬浮圆钮：默认在画布右下角，可以拖到别处 -->
    <div
      class="qf"
      :class="{
        ready, drag: dragging, open, run: active, wait: !running.length && queued.length > 0,
        left: onLeft, ok: flash === 'ok', bad: flash === 'err',
      }"
      :style="{ transform: `translate3d(${xy.x}px, ${xy.y}px, 0)` }"
    >
      <button
        ref="btnRef"
        type="button"
        class="qf-btn"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-label="t('queue.title') + ' · ' + summary + (unseen.n ? ' · ' + t('queue.unseen', { n: unseen.n }) : '')"
        @pointerdown="onDown"
        @mousedown.prevent
        @pointermove="onMove"
        @pointerup="onUp($event, true)"
        @pointercancel="onUp($event, false)"
        @click="onClick"
        @dblclick="resetPos"
      >
        <!-- 进度环：上游报了进度就画汇总（各运行中任务的平均），没报就转一段弧，不编数字 -->
        <svg class="qf-ring" viewBox="0 0 52 52" aria-hidden="true">
          <defs>
            <!-- 整个环转了 -90°：这里的「右」是屏幕上的 12 点，弧从青色起步 -->
            <linearGradient id="qf-grad" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0" class="s0" /><stop offset=".55" class="s1" /><stop offset="1" class="s2" />
            </linearGradient>
          </defs>
          <circle class="qf-track" cx="26" cy="26" r="24" />
          <circle
            v-if="running.length"
            class="qf-arc"
            :class="{ spin: !hasProgress }"
            cx="26" cy="26" r="24" pathLength="100"
            :stroke-dasharray="(hasProgress ? Math.max(4, progress) : 26) + ' 100'"
          />
        </svg>
        <span class="qf-core">
          <Transition name="qf-swap" mode="out-in">
            <!-- 还有别的任务没完：中间一直是数量（它自己会滚），结束的那一下只在外圈闪一道光 -->
            <span v-if="active" key="num" class="qf-num">
              <Transition :name="rollDir">
                <b :key="pending">{{ pending > 99 ? '99+' : pending }}</b>
              </Transition>
            </span>
            <LcIcon v-else-if="flash === 'ok'" key="ok" name="check" class="qf-tick" />
            <LcIcon v-else-if="flash === 'err'" key="err" name="warn" class="qf-oops" />
            <LcIcon v-else key="ic" name="queue" />
          </Transition>
        </span>
        <!-- 上次打开清单之后结束的：有失败 / 没能开始的就换成报错色 -->
        <Transition name="qf-pop">
          <i v-if="unseen.n" class="qf-badge" :class="{ bad: unseen.bad }" aria-hidden="true">{{ unseen.n > 9 ? '9+' : unseen.n }}</i>
        </Transition>
      </button>
      <span class="qf-tip" role="tooltip">{{ active ? summary : t('queue.title') + ' · ' + summary }}</span>
    </div>

    <!-- 清单：贴着圆钮弹出的一张卡片，朝有地方的那边开 -->
    <Transition name="qp-in">
      <section
        v-if="open"
        ref="popRef"
        class="qp"
        role="dialog"
        :aria-label="t('queue.title')"
        :style="popStyle"
        @wheel.stop
      >
        <header class="qp-hd">
          <b>{{ t('queue.title') }}</b>
          <span class="qp-sum" :class="{ on: active }" :title="t('queue.slotsTip', { max: MAX_CONCURRENT })">{{ active ? summary : t('queue.idle') }}</span>
          <span class="lc-sp" />
          <ConfirmPop
            v-if="cancelableIds.length"
            :text="t('queue.cancelAllAsk', { n: cancelableIds.length })"
            :hint="t('queue.cancelAllHint')"
            :ok-text="t('queue.cancelAll')"
            @ok="cancelAll"
          >
            <button type="button" class="qc-link danger">{{ t('queue.cancelAll') }}</button>
          </ConfirmPop>
          <button v-if="pos" type="button" class="qc-link qp-reset" :title="t('queue.resetTip')" @click="resetPos">{{ t('queue.reset') }}</button>
        </header>

        <div class="qc-bd">
          <p v-if="isIdle" class="qp-empty">{{ t('queue.empty') }}<small>{{ t('queue.dragHint') }}</small></p>

          <div v-if="running.length || queued.length" class="qc-live">
            <!-- 进行中 -->
            <div
              v-for="it in running"
              :key="'r-' + it.nodeId"
              class="qt act"
              role="button"
              tabindex="0"
              :title="t('queue.locate')"
              @click="focus(it.nodeId)"
              @keydown.enter="focus(it.nodeId)"
            >
              <!-- 上游报了进度才画数字；没报就只转圈，不编百分比 -->
              <span v-if="it.progress > 0" class="lc-ring sm" :style="{ '--p': it.progress }"><span>{{ it.progress }}%</span></span>
              <span v-else class="lc-ring sm spin" aria-hidden="true" />
              <div class="qt-txt">
                <b>{{ it.title }}</b>
                <small v-if="it.sub || it.params">{{ [it.sub, it.params].filter(Boolean).join(' · ') }}</small>
                <small>
                  <span class="qt-run">{{ it.local ? t('queue.processing') : t('queue.generating') }}</span>
                  <template v-if="it.startedAt"> · <span class="lc-mono">{{ t('queue.elapsed', { time: clock(now - it.startedAt) }) }}</span></template>
                </small>
              </div>
              <button
                v-if="it.cancelable"
                type="button"
                class="lc-tb sm qt-x"
                :disabled="canceling.has(it.nodeId)"
                :title="t('queue.cancel')"
                :aria-label="t('queue.cancel')"
                @click.stop="cancelOne(it.nodeId)"
              ><LcIcon name="stop" size="s" /></button>
            </div>

            <!-- 排队：等上游节点出结果，或等并发名额 -->
            <div
              v-for="it in queued"
              :key="'q-' + it.nodeId"
              class="qt"
              role="button"
              tabindex="0"
              :title="t('queue.locate')"
              @click="focus(it.nodeId)"
              @keydown.enter="focus(it.nodeId)"
            >
              <!-- 圈里不写字：英文的 Queued 塞不进 40px 的圈，下面那行已经写着「等待中」 -->
              <span class="lc-ring sm q" aria-hidden="true"><span>···</span></span>
              <div class="qt-txt">
                <b>{{ it.title }}</b>
                <small v-if="it.sub || it.params">{{ [it.sub, it.params].filter(Boolean).join(' · ') }}</small>
                <small>{{ t('queue.waiting') }}</small>
              </div>
            </div>
          </div>

          <!-- 没能开始：运行前的检查没过（缺提示词、缺参考图、模型不可用…），任务根本没提交。
               原因同时写在节点上；这里也列一份，盯着队列看的人不至于以为点了没反应 -->
          <section v-if="blocked.length">
            <div class="qlab"><span>{{ t('queue.blocked') }}</span><i>{{ blocked.length }}</i></div>
            <button
              v-for="b in blocked"
              :key="'b-' + b.nodeId"
              type="button"
              class="qdone error"
              :title="t('queue.locate')"
              @click="focus(b.nodeId)"
            >
              <span class="thumb lc-thumb"><LcIcon name="warn" size="s" /></span>
              <span class="qdone-txt">
                <b>{{ b.title }}</b>
                <small class="qdone-err" :title="b.reason">{{ b.reason }}</small>
              </span>
            </button>
          </section>

          <!-- 已结束：成功的带真实产物缩略图，失败的带后端给的原因。只摆最近几条，其余就地展开 -->
          <section v-if="finished.length">
            <div class="qlab">
              <span>{{ t('queue.finished') }}</span><i>{{ finished.length }}</i>
              <span class="lc-sp" />
              <button type="button" class="qc-link" :title="t('queue.clearTip')" @click="clearFinished">{{ t('queue.clear') }}</button>
            </div>
            <button
              v-for="f in shownFinished"
              :key="f.key"
              type="button"
              class="qdone"
              :class="f.status"
              :disabled="!f.alive"
              :title="f.alive ? t('queue.locate') : t('queue.nodeGone')"
              @click="focus(f.nodeId)"
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
            <button v-if="finished.length > FINISHED_CAP" type="button" class="qc-more" :aria-expanded="showAll" @click="showAll = !showAll">
              {{ showAll ? t('queue.less') : t('queue.more', { n: finished.length - FINISHED_CAP }) }}
            </button>
          </section>
        </div>
      </section>
    </Transition>
  </div>
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
 *
 * 形态：一颗浮在画布上的圆钮，默认在右下角，可以拖到别处（松手吸到左 / 右边，位置记在浏览器里）。
 * 圆钮本身就是状态：空闲是一个安静的图标；有任务时边上一圈进度环、中间是未完成的数量；
 * 上次看过清单之后又有任务结束，右上角亮一个角标。点一下才弹出清单卡片 —— 运行开始时
 * 不会自己弹出来，圆钮的动画就是提示。已完成只列「这次打开画布以来」结束的那些：
 * 更早的版本都在各自节点的历史里，不该每次进画布都摆一长列出来。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Node } from '@vue-flow/core'
import LcIcon from '@/components/LcIcon.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import { runsApi, unwrap } from '@/utils/api'
import { ensureHttps } from '@/utils/mediaUrl'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { getAdapter, listChatModels, listVideoChatModels } from '@/utils/canvasModels'
import { MAX_CONCURRENT, type NodeResultEntry } from '@/composables/useCanvasExecutor'
import { clampNum, isFree, nearestFree, rectsIn, type Rect } from '@/utils/floatSpot'

const props = defineProps<{
  nodes: Node[]
  /** 当前画布 id：换画布时把上一张的记录清掉 */
  workflowId: string | null
  /** 节点类型 → 当前语言下的名字（和添加节点菜单同一份） */
  titleOf: (type: string) => string
  cancelNode: (nodeId: string) => Promise<void>
  /** 画布右缘被别的面板（布局 b 的属性面板）占掉的宽度：贴右边时从它左边算起 */
  rightInset?: number
  /** 工具面板（可以拖到任何地方）眼下占着的矩形，相对编辑区：圆钮找空位时绕开它 */
  avoid?: Rect[]
}>()

const emit = defineEmits<{
  (e: 'focus', nodeId: string): void
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
  return out.join(' · ')
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
/** 只列这个时刻之后结束的：打开这张画布的那一刻，或者上一次点「清空」的那一刻 */
const since = ref(Date.now())
/** 清单里先摆最近这几条，其余点「还有 N 个」就地展开 */
const FINISHED_CAP = 5
const showAll = ref(false)
let lastWorkflow: string | null = null
watch(() => props.workflowId, (id) => {
  // 新画布第一次保存才拿到 id（空 → 有），那不算换画布，已有的记录要留着
  if (id && lastWorkflow && id !== lastWorkflow) {
    since.value = Date.now()
    session.value = []
    showAll.value = false
  }
  if (id) lastWorkflow = id
}, { immediate: true })

function clearFinished() {
  since.value = Date.now()
  session.value = []
  showAll.value = false
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
  return out.filter((f) => f.at > since.value).sort((a, b) => b.at - a.at).slice(0, MAX_FINISHED)
})
const shownFinished = computed(() => (showAll.value ? finished.value : finished.value.slice(0, FINISHED_CAP)))
watch(() => finished.value.length, (n) => { if (n <= FINISHED_CAP) showAll.value = false })

const active = computed(() => running.value.length > 0 || queued.value.length > 0)
/** 什么都没有：圆钮是空闲的样子，清单里只有一句说明 */
const isIdle = computed(() => !active.value && !blocked.value.length && !finished.value.length)

// ---------------- 圆钮上的数字 / 进度 / 角标 ----------------
/** 还没结束的：进行中 + 排队 */
const pending = computed(() => running.value.length + queued.value.length)
/** 有任务报了真实进度才画汇总环；都没报就转弧 */
const hasProgress = computed(() => running.value.some((i) => i.progress > 0))
const progress = computed(() => {
  const list = running.value
  return list.length ? Math.round(list.reduce((a, i) => a + i.progress, 0) / list.length) : 0
})
/** 数字变化时的滚动方向：变多往上滚，变少往下滚 */
const rollDir = ref<'qf-up' | 'qf-down'>('qf-up')
watch(pending, (n, o) => { rollDir.value = n >= o ? 'qf-up' : 'qf-down' })

/** 悬停提示 / 读屏用的一句话：只报数量，明细在清单里 */
const summary = computed(() => {
  const parts: string[] = []
  if (running.value.length) parts.push(t('queue.nRunning', { n: running.value.length }))
  if (queued.value.length) parts.push(t('queue.nQueued', { n: queued.value.length }))
  if (parts.length) return parts.join(' · ')
  if (blocked.value.length) parts.push(t('queue.nBlocked', { n: blocked.value.length }))
  if (finished.value.length) parts.push(t('queue.nFinished', { n: finished.value.length }))
  return parts.length ? parts.join(' · ') : t('queue.idle')
})

// 刚结束的那一下：外圈扩出一道光（成功绿、失败红）；要是这已经是最后一个任务，
// 中间再闪一下对勾 / 警告，然后回到空闲图标
const flash = ref<'' | 'ok' | 'err'>('')
let flashTimer: number | null = null
function flashNow(kind: 'ok' | 'err') {
  flash.value = kind
  if (flashTimer !== null) clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => { flash.value = ''; flashTimer = null }, 1500)
}
onBeforeUnmount(() => { if (flashTimer !== null) clearTimeout(flashTimer) })
watch(() => session.value[0]?.key, (key, old) => {
  const e = session.value[0]
  if (!key || key === old || !e) return
  if (e.status === 'done') flashNow('ok')
  else if (e.status === 'error') flashNow('err')
})

// ---------------- 清单的开合、没看过的结果 ----------------
const open = ref(false)
/** 上一次看清单的时刻：之后结束的算「没看过」，在圆钮右上角亮角标 */
const seenAt = ref(Date.now())
const seenBlocked = reactive(new Set<string>())
function markSeen() {
  seenAt.value = Date.now()
  for (const b of blocked.value) seenBlocked.add(b.nodeId)
}
// 打开和关上各记一次：开着的那段时间里结束的，都算看过了
watch(open, (v) => { markSeen(); if (v) layout() })
// 输入补齐后节点不再「没能开始」；下次又没过，要重新提醒
watch(blocked, (list) => {
  const ids = new Set(list.map((b) => b.nodeId))
  for (const id of [...seenBlocked]) if (!ids.has(id)) seenBlocked.delete(id)
})
const unseen = computed(() => {
  if (open.value) return { n: 0, bad: false }
  // 自己点的取消不用提醒
  const fin = finished.value.filter((f) => f.at > seenAt.value && f.status !== 'canceled')
  const blk = blocked.value.filter((b) => !seenBlocked.has(b.nodeId))
  return { n: fin.length + blk.length, bad: blk.length > 0 || fin.some((f) => f.status === 'error') }
})

function focus(nodeId: string) {
  emit('focus', nodeId)
  // 定位之后收起清单：要看的是那个节点，不该还被清单挡着
  open.value = false
}
/** 清单开着时点到别处：收起。确认气泡挂在 body 上，点它不算「别处」 */
function onOutside(e: PointerEvent) {
  if (!open.value) return
  const el = e.target as HTMLElement
  if (popRef.value?.contains(el) || btnRef.value?.contains(el) || el.closest?.('.cp-pop')) return
  open.value = false
}
/** Esc：收起清单；焦点原本在清单里的话还给圆钮。确认气泡开着时 Esc 先归它 */
function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value || document.querySelector('.cp-pop')) return
  const a = document.activeElement
  const within = !!a && (!!popRef.value?.contains(a) || btnRef.value === a)
  open.value = false
  if (within) btnRef.value?.focus()
}

// ---------------- 位置：默认右下角，可拖动，松手吸到左 / 右边 ----------------
/**
 * 记的是「贴哪条边 + 竖直方向的比例」，不是像素 —— 窗口变大变小、侧栏收起展开之后
 * 还在同一个相对位置上。null = 默认的右下角。只存在这个浏览器里。
 */
type Pos = { e: 'l' | 'r'; r: number }
const POS_KEY = 'lc-queue-pos'
function loadPos(): Pos | null {
  try {
    // 以前几版记过面板的开合和「清空」时间，现在都不用了，顺手清掉
    localStorage.removeItem('lc-queue-open'); localStorage.removeItem('lc-queue-cleared')
    const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    if (v && (v.e === 'l' || v.e === 'r') && Number.isFinite(v.r)) return { e: v.e, r: Math.max(0, Math.min(1, Number(v.r))) }
  } catch { /* 读不到就用默认位置 */ }
  return null
}
function savePos() {
  try {
    if (pos.value) localStorage.setItem(POS_KEY, JSON.stringify(pos.value))
    else localStorage.removeItem(POS_KEY)
  } catch { /* 存不上就只在这次有效 */ }
}

const layerRef = ref<HTMLElement | null>(null)
const btnRef = ref<HTMLButtonElement | null>(null)
const popRef = ref<HTMLElement | null>(null)
const pos = ref<Pos | null>(loadPos())
const box = reactive({ w: 0, h: 0 })
const xy = reactive({ x: -200, y: -200 })
const ready = ref(false)
const dragging = ref(false)

/** 圆钮直径（和样式里的 --qf 是同一个数） */
const SIZE = 52
/** 手机上边距收一点 */
const margin = () => (box.w <= 640 ? 12 : 20)
const clamp = clampNum
const onLeft = computed(() => xy.x + SIZE / 2 < box.w / 2)

/** 画布上别的固定悬浮块（标题、底部工具条、属性面板、小地图）相对这一层的位置；工具面板的位置由父级给 */
function obstacles(): Rect[] {
  return [...rectsIn(layerRef.value?.parentElement, '.ed-title, .ed-tools, .ed-insp, .vue-flow__minimap'), ...(props.avoid || [])]
}
/** 贴着某条边、想放在 wantY：要是压着别的悬浮块，就挪到离得最近的那块空地 */
function settle(edge: 'l' | 'r', wantY: number): { x: number; y: number } {
  const m = margin()
  // 贴右边时，从属性面板（开着的话）的左边算起，不钻到面板底下
  const obs = obstacles(), size = { w: SIZE, h: SIZE }
  const at = (e: 'l' | 'r') => {
    const x = e === 'l' ? m : box.w - SIZE - m - (props.rightInset || 0)
    return nearestFree({ x, y: wantY }, size, { minX: x, maxX: x, minY: m, maxY: box.h - SIZE - m }, obs, { lockX: true })
  }
  const here = at(edge)
  if (isFree(here.x, here.y, size, obs)) return here
  // 这条边从上到下都被占满了（窗口很矮、工具面板竖着贴在这边）：到对面那条边去找
  const there = at(edge === 'l' ? 'r' : 'l')
  return isFree(there.x, there.y, size, obs) ? there : here
}
function layout() {
  const el = layerRef.value
  if (!el || dragging.value) return
  box.w = el.clientWidth; box.h = el.clientHeight
  if (!box.w || !box.h) return
  const m = margin()
  const minY = m, maxY = box.h - SIZE - m
  const p = pos.value
  const at = p ? settle(p.e, minY + p.r * Math.max(0, maxY - minY)) : settle('r', maxY)
  xy.x = at.x; xy.y = at.y
}

// 拖动：按下后挪过一小段才算拖，否则是点击。鼠标、触屏、手写笔都走 pointer 事件。
// 模板里的 @mousedown.prevent 不能去掉：圆钮跟着指针走开之后，浏览器会回到按下的那个点上找
// 「可拖的东西」，把底下节点里的图片当成拖拽源拖走（松手就往画布上多加一个图片节点）。
// 拦掉 mousedown 的默认行为就不会起原生拖拽；事件照常冒泡，画布「点别处收菜单」不受影响。
const DRAG_START = 6
let grab: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null
function onDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  grab = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: xy.x, oy: xy.y, moved: false }
  try { btnRef.value?.setPointerCapture(e.pointerId) } catch { /* 抓不住指针也能拖，只是出了圆钮就断 */ }
}
function onMove(e: PointerEvent) {
  if (!grab || e.pointerId !== grab.id) return
  const dx = e.clientX - grab.sx, dy = e.clientY - grab.sy
  if (!grab.moved) {
    if (Math.hypot(dx, dy) < DRAG_START) return
    grab.moved = true
    dragging.value = true
    // 开着清单拖：先收起，放下之后要看再点开（它会朝新位置有地方的那边开）
    open.value = false
  }
  xy.x = clamp(grab.ox + dx, 8, box.w - SIZE - 8)
  xy.y = clamp(grab.oy + dy, 8, box.h - SIZE - 8)
}
function onUp(e: PointerEvent, released: boolean) {
  if (!grab || e.pointerId !== grab.id) return
  const moved = grab.moved
  grab = null
  try { btnRef.value?.releasePointerCapture(e.pointerId) } catch { /* 已经放开了 */ }
  if (!moved) {
    // 没挪动 = 点了一下。开合在这里做，不等 click：手指点的时候稍微一抖，有的浏览器就不发 click 了
    if (released) open.value = !open.value
    return
  }
  dragging.value = false
  const m = margin()
  const minY = m, maxY = box.h - SIZE - m
  const edge = xy.x + SIZE / 2 < box.w / 2 ? 'l' : 'r'
  const y = clamp(xy.y, minY, maxY)
  // 拖回右下角 = 回到默认位置（以后默认位置怎么让开工具条，它都跟着）
  pos.value = edge === 'r' && y >= maxY - 8 ? null : { e: edge, r: maxY > minY ? (y - minY) / (maxY - minY) : 1 }
  savePos()
  layout()
}
/** 键盘（回车 / 空格）和读屏触发的 click 没有指针按下，detail 是 0；指针点的已经在 onUp 里处理过了 */
function onClick(e: MouseEvent) {
  if (e.detail === 0) open.value = !open.value
}
/** 回到默认的右下角（双击圆钮，或清单表头里的「复位」） */
function resetPos() {
  // 本来就在默认位置：没什么可复位的。这时的双击只是连点两下（开了又关），不去动它
  if (!pos.value) return
  open.value = false
  pos.value = null
  savePos()
  layout()
}

/** 清单卡片放哪：贴着圆钮，上下哪边地方大朝哪边开；上下都局促就开在圆钮旁边 */
const popStyle = computed<Record<string, string>>(() => {
  const W = box.w, H = box.h, GAP = 10, EDGE = 8
  const width = Math.min(328, W - EDGE * 2)
  const above = xy.y - GAP - EDGE, below = H - (xy.y + SIZE) - GAP - EDGE
  const cap = Math.min(480, Math.max(260, Math.round(H * 0.64)))
  const up = above >= below
  const st: Record<string, string> = { width: width + 'px' }
  const sideRoom = onLeft.value ? W - (xy.x + SIZE) - GAP - EDGE : xy.x - GAP - EDGE
  if (Math.max(above, below) < cap && sideRoom >= width) {
    // 圆钮在边的中段：上下都放不下一张完整的清单，开在它旁边（也就不会盖住它上下的控件）
    st.left = (onLeft.value ? xy.x + SIZE + GAP : xy.x - GAP - width) + 'px'
    const maxH = Math.min(cap, H - EDGE * 2)
    if (xy.y + SIZE / 2 < H / 2) st.top = clamp(xy.y - 12, EDGE, H - EDGE - 200) + 'px'
    else st.bottom = clamp(H - (xy.y + SIZE) - 12, EDGE, H - EDGE - 200) + 'px'
    st.maxHeight = maxH + 'px'
    st.transformOrigin = (onLeft.value ? 'left' : 'right') + ' center'
    return st
  }
  st.left = clamp(onLeft.value ? xy.x : xy.x + SIZE - width, EDGE, W - EDGE - width) + 'px'
  st.maxHeight = Math.max(120, Math.min(cap, up ? above : below)) + 'px'
  if (up) st.bottom = (H - xy.y + GAP) + 'px'
  else st.top = (xy.y + SIZE + GAP) + 'px'
  st.transformOrigin = (onLeft.value ? 'left ' : 'right ') + (up ? 'bottom' : 'top')
  return st
})

let ro: ResizeObserver | null = null
let settleTimer: number | null = null
onMounted(() => {
  layout()
  // 窗口大小、侧栏收起展开都会改这一层的尺寸
  if (layerRef.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => layout())
    ro.observe(layerRef.value)
  }
  window.addEventListener('resize', layout)
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('keydown', onEsc)
  // 工具条的宽度要等字体和文案就位才定；定下来之后再摆一次，然后才开过渡动画
  settleTimer = window.setTimeout(() => { layout(); ready.value = true; settleTimer = null }, 350)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', layout)
  window.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('keydown', onEsc)
  if (settleTimer !== null) clearTimeout(settleTimer)
})
// 换语言会改工具条的宽度
watch(locale, () => { void nextTick(layout) })
// 属性面板开合：重新找位置
watch(() => props.rightInset, () => { void nextTick(layout) })
// 工具面板挪了位置 / 换了方向：重新找位置
watch(() => (props.avoid || []).map((r) => `${r.l},${r.t},${r.r},${r.b}`).join('|'), () => { void nextTick(layout) })

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
/* 这一层铺满编辑区但自己不吃事件：只有圆钮和清单卡片能点，节点照样可以从它们旁边拖过去 */
.qf-layer { position: absolute; inset: 0; z-index: 7; pointer-events: none; overflow: hidden; }

/* ---------- 悬浮圆钮 ---------- */
.qf {
  --qf: 52px;
  position: absolute; left: 0; top: 0; width: var(--qf); height: var(--qf);
  pointer-events: auto; will-change: transform;
}
/* 松手吸边、窗口变化时滑过去；拖着的时候必须跟手，不能有过渡 */
.qf.ready { transition: transform .24s cubic-bezier(.2, .8, .2, 1); }
.qf.drag { transition: none; }

.qf-btn {
  position: relative; width: 100%; height: 100%; padding: 0; border-radius: 50%;
  display: grid; place-items: center;
  border: 0; background: rgba(12, 21, 52, .78); color: var(--text-3);
  box-shadow: var(--sh-1);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: background .15s, color .15s, transform .15s, box-shadow .15s;
}
.qf-btn:hover, .qf.open .qf-btn { background: rgba(21, 34, 78, .94); color: var(--text); }
.qf-btn:focus-visible { outline: none; box-shadow: var(--sh-1), var(--ring); }
.qf.drag .qf-btn { cursor: grabbing; transform: scale(1.06); box-shadow: var(--sh-2); }
.qf.run .qf-btn { color: var(--text); background: rgba(12, 21, 52, .92); }

/* 运行时外面那圈柔光：平时就是静止的一圈，动画只是让它呼吸 */
.qf-btn::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  box-shadow: 0 0 0 1px rgba(63, 216, 255, .22), 0 0 18px rgba(63, 216, 255, .42);
  opacity: 0; transition: opacity .3s;
}
.qf.run .qf-btn::after { opacity: .75; animation: qf-breathe 2.4s ease-in-out infinite; }
@keyframes qf-breathe { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }

/* 环：平时是一圈细边；运行时上面叠进度弧 */
.qf-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); pointer-events: none; overflow: visible; }
.qf-ring .s0 { stop-color: var(--cyan); }
.qf-ring .s1 { stop-color: var(--blue); }
.qf-ring .s2 { stop-color: var(--violet); }
.qf-track { fill: none; stroke: var(--line-2); stroke-width: 1; transition: stroke .2s, stroke-width .2s; }
.qf-btn:hover .qf-track, .qf.open .qf-track { stroke: var(--line-3); }
.qf.run .qf-track { stroke: rgba(124, 160, 255, .2); stroke-width: 3; }
/* 只有排队、还没有任务开跑：虚线环（和清单里排队那一行同一个意思） */
.qf.wait .qf-track { stroke: var(--line-3); stroke-width: 2; stroke-dasharray: 3 4; }
.qf-arc {
  fill: none; stroke: url(#qf-grad); stroke-width: 3; stroke-linecap: round;
  transform-origin: 26px 26px;
  transition: stroke-dasharray .6s cubic-bezier(.3, .7, .2, 1);
}
.qf-arc.spin { animation: qf-spin 1.3s linear infinite; transition: none; }
@keyframes qf-spin { to { transform: rotate(360deg); } }

/* 中间：空闲是队列图标，有任务是未完成数量，刚结束的那一下闪对勾 / 警告 */
/* 里面的图标和数字不接事件：按下、松开、双击的目标永远是圆钮自己 */
.qf-core { position: relative; display: grid; place-items: center; width: 30px; height: 30px; pointer-events: none; }
.qf-core :deep(.lc-ic) { width: 22px; height: 22px; }
.qf-num { position: relative; display: block; width: 30px; height: 22px; overflow: hidden; }
.qf-num b {
  position: absolute; inset: 0; display: grid; place-items: center;
  font: 600 17px/1 var(--f-disp); font-variant-numeric: tabular-nums; color: var(--text);
}
.qf-tick { color: var(--ok); filter: drop-shadow(0 0 6px rgba(62, 230, 168, .7)); }
.qf-oops { color: var(--err); filter: drop-shadow(0 0 6px rgba(255, 107, 139, .6)); }
/* 数字滚动：变多时旧的往上走、新的从下面上来；变少反过来 */
.qf-up-enter-active, .qf-up-leave-active, .qf-down-enter-active, .qf-down-leave-active { transition: transform .32s cubic-bezier(.3, .8, .3, 1), opacity .32s; }
.qf-up-enter-from, .qf-down-leave-to { transform: translateY(70%); opacity: 0; }
.qf-up-leave-to, .qf-down-enter-from { transform: translateY(-70%); opacity: 0; }
.qf-swap-enter-active, .qf-swap-leave-active { transition: transform .16s, opacity .16s; }
.qf-swap-enter-from, .qf-swap-leave-to { transform: scale(.6); opacity: 0; }

/* 完成的那一下：一圈光从圆钮上扩出去 */
.qf.ok::before, .qf.bad::before {
  content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  border: 2px solid var(--ok); opacity: 0; animation: qf-burst .9s ease-out 1;
}
.qf.bad::before { border-color: var(--err); }
@keyframes qf-burst { 0% { transform: scale(1); opacity: .9; } 100% { transform: scale(1.55); opacity: 0; } }

/* 角标：上次打开清单之后结束了几个 */
.qf-badge {
  position: absolute; right: -3px; top: -3px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
  display: grid; place-items: center; font: 600 11px/1 var(--f-body); font-style: normal; font-variant-numeric: tabular-nums;
  pointer-events: none;
  background: var(--cyan); color: var(--text-inv);
  box-shadow: 0 0 0 2px var(--bg-1), 0 0 12px rgba(63, 216, 255, .55);
}
.qf-badge.bad { background: var(--err); box-shadow: 0 0 0 2px var(--bg-1), 0 0 12px rgba(255, 107, 139, .6); }
.qf-pop-enter-active { transition: transform .22s cubic-bezier(.3, 1.5, .5, 1), opacity .15s; }
.qf-pop-leave-active { transition: transform .12s, opacity .12s; }
.qf-pop-enter-from, .qf-pop-leave-to { transform: scale(.3); opacity: 0; }

/* 悬停提示：只报数量 */
.qf-tip {
  position: absolute; top: 50%; right: calc(100% + 10px); transform: translateY(-50%) translateX(4px);
  padding: 6px 10px; border-radius: 8px; white-space: nowrap; pointer-events: none;
  font-size: 12px; line-height: 1.4; color: var(--text); font-variant-numeric: tabular-nums;
  background: #131f4a; border: 1px solid var(--line-2); box-shadow: var(--sh-1);
  opacity: 0; visibility: hidden; transition: opacity .12s, transform .12s, visibility 0s .12s;
}
.qf.left .qf-tip { right: auto; left: calc(100% + 10px); transform: translateY(-50%) translateX(-4px); }
@media (hover: hover) {
  .qf:not(.open):not(.drag) .qf-btn:hover + .qf-tip { opacity: 1; visibility: visible; transform: translateY(-50%); transition-delay: .25s, .25s, .25s; }
}
.qf:not(.open):not(.drag) .qf-btn:focus-visible + .qf-tip { opacity: 1; visibility: visible; transform: translateY(-50%); }

/* ---------- 清单卡片 ---------- */
.qp {
  position: absolute; pointer-events: auto;
  display: flex; flex-direction: column; min-height: 0;
  border-radius: 14px; border: 1px solid var(--line-2);
  background: rgba(12, 21, 52, .95); box-shadow: var(--sh-2);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.qp-in-enter-active { transition: transform .16s cubic-bezier(.2, .8, .2, 1), opacity .14s; }
.qp-in-leave-active { transition: transform .1s, opacity .1s; }
.qp-in-enter-from, .qp-in-leave-to { transform: scale(.94); opacity: 0; }

.qp-hd { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 8px 0 14px; flex: none; min-width: 0; }
.qp-hd b { font: 600 13px/1.4 var(--f-disp); color: var(--text); white-space: nowrap; }
.qp-hd .lc-sp { min-width: 0; }
.qp-sum { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-variant-numeric: tabular-nums; }
.qp-sum.on { color: var(--cyan); }
.qc-link:focus-visible, .qc-more:focus-visible { outline: none; box-shadow: var(--ring); }
.qc-link {
  border: 0; background: none; height: 24px; padding: 0 6px; border-radius: 6px; font-size: 12px; flex: none;
  color: var(--text-3); white-space: nowrap; transition: background .12s, color .12s;
}
.qc-link:hover { background: rgba(124, 160, 255, .12); color: var(--text); }
.qc-link.danger:hover { background: rgba(255, 107, 139, .14); color: var(--err-soft); }

.qc-bd {
  display: grid; gap: 8px; align-content: start; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  padding: 8px; border-top: 1px solid var(--line); border-radius: 0 0 13px 13px;
  scrollbar-width: thin; scrollbar-color: var(--line-3) transparent;
}
.qc-bd > section { display: grid; min-width: 0; }
.qc-live { display: grid; gap: 6px; min-width: 0; }
.qp-empty { margin: 0; padding: 14px 8px 12px; font-size: 13px; line-height: 1.6; color: var(--text-2); text-align: center; }
.qp-empty small { display: block; margin-top: 4px; font-size: 12px; color: var(--text-3); }

.qt {
  display: flex; gap: 10px; align-items: center; min-width: 0;
  padding: 8px 6px 8px 8px; border-radius: 10px; border: 1px solid var(--line); background: rgba(4, 9, 28, .45);
  cursor: pointer; transition: border-color .15s, background .15s;
}
.qt:hover { border-color: var(--line-3); background: rgba(4, 9, 28, .6); }
.qt:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
.qt.act { border-color: rgba(63, 216, 255, .4); }
.qt .lc-ring { flex: none; }
.qt .lc-ring.q { font-size: 14px; letter-spacing: 1px; }
.qt-txt { min-width: 0; flex: 1; }
.qt b { display: block; font-size: 13px; font-weight: 600; line-height: 1.4; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qt small { display: block; font-size: 11px; line-height: 1.5; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qt-run { color: var(--cyan); }
.qt-x { flex: none; }
.qt-x:hover:not(:disabled) { background: rgba(255, 107, 139, .14); color: var(--err-soft); }

.qlab { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 0 0 6px; font-size: 12px; color: var(--text-3); }
.qlab i { font: 500 11px var(--f-mono); font-style: normal; color: var(--text-3); opacity: .8; }
.qdone {
  display: flex; gap: 10px; align-items: center; padding: 5px 6px; border: 0; border-radius: 8px;
  background: none; text-align: left; min-width: 0; width: 100%; color: inherit;
}
.qdone:hover:not(:disabled) { background: rgba(124, 160, 255, .08); }
.qdone:disabled { cursor: default; }
.qdone:focus-visible { outline: none; box-shadow: var(--ring); }
.qdone .thumb {
  width: 40px; height: 30px; border-radius: 6px; flex: none; display: grid; place-items: center;
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
.qc-more {
  height: 26px; margin-top: 2px; border: 0; border-radius: 8px; background: none;
  font-size: 12px; color: var(--text-3); text-align: center; transition: background .12s, color .12s;
}
.qc-more:hover { background: rgba(124, 160, 255, .08); color: var(--text); }

/* 系统开了「减少动态效果」：环不转、光不呼吸、数字直接换。全局规则已经把时长压到近零，
   这里再把会循环的动画彻底关掉，免得停在半截的样子 */
@media (prefers-reduced-motion: reduce) {
  .qf-arc.spin, .qf.run .qf-btn::after, .qf.ok::before, .qf.bad::before { animation: none; }
  .qf.ready { transition: none; }
}
</style>
