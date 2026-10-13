<template>
  <div class="lc-page"><div class="lc-page-inner wb">
    <!-- 团队空间：团队是谁、四个数字、新团队的三步引导 -->
    <TeamOverview
      v-if="space.isTeam"
      ref="overview"
      :running="runningCount"
      :queued="queuedCount"
      :queue-state="recState"
      @create="nameOpen = true"
    />
    <header v-else class="lc-page-head wb-head">
      <div class="wb-hello">
        <h1 class="lc-ph1">{{ greeting }}</h1>
        <p class="lc-ph-sub">{{ subLine }}</p>
      </div>
      <span class="lc-sp" />
      <button class="lc-btn primary wb-new" @click="nameOpen = true">
        <LcIcon name="plus" />{{ t('workbench.newCanvas') }}
      </button>
    </header>

    <div class="wb-grid">
      <div class="wb-main">
        <!-- 最近的画布 -->
        <div v-if="space.isTeam" class="lc-sec-h wb-first">
          <h2>{{ t('workbench.team.canvases') }}</h2>
          <router-link v-if="canvases.length" :to="teamTo('canvas-list')" class="more wb-all">{{ t('workbench.team.allCanvases', { n: canvases.length }) }}<LcIcon name="chev" size="s" /></router-link>
        </div>
        <div v-else class="lc-sec-h wb-first">
          <h2>{{ t('workbench.canvases.title') }}</h2>
          <span v-if="canvases.length" class="lc-chip">{{ t('workbench.canvases.total', { n: canvases.length }) }}</span>
          <router-link to="/canvases" class="more">{{ t('workbench.canvases.viewAll') }}</router-link>
        </div>
        <div v-if="canvasState === 'loading'" class="wb-cvs" aria-hidden="true">
          <div v-for="n in 3" :key="n" class="lc-card wb-cv"><div class="wb-skel wb-cv-thumb" /><div class="wb-cv-meta"><i class="wb-skel line w60" /><i class="wb-skel line w40" /></div></div>
        </div>
        <div v-else-if="canvasState === 'error'" class="lc-card wb-state">
          <p>{{ t('workbench.canvases.loadFailed') }}</p>
          <button class="lc-btn sm" @click="loadCanvases()">{{ t('common.retry') }}</button>
        </div>
        <div v-else-if="!canvases.length" class="lc-card wb-state">
          <span class="wb-state-ic"><LcIcon name="canvas" size="l" /></span>
          <b>{{ space.isTeam ? t('workbench.team.canvasesEmpty') : t('workbench.canvases.empty') }}</b>
          <p>{{ $feat.templates ? t('workbench.canvases.emptyHint') : t('workbench.canvases.emptyHintBlank') }}</p>
          <button class="lc-btn" @click="nameOpen = true"><LcIcon name="plus" />{{ t('workbench.newCanvas') }}</button>
        </div>
        <!-- 团队空间：和画布列表是同一张卡片（可见范围、创建人、谁正在编辑、右下角的操作） -->
        <div v-else-if="space.isTeam" class="wb-cvs team">
          <CanvasCard
            v-for="w in recentCanvases"
            :key="w.id"
            :canvas="w"
            team
            :menu-items="acts?.itemsOf(w)"
            :now="now.getTime()"
            @open="openCanvas(w.id)"
            @action="acts?.run($event, w)"
          />
        </div>
        <div v-else class="wb-cvs">
          <router-link
            v-for="(w, i) in recentCanvases"
            :key="w.id"
            :to="`/canvas/${w.id}`"
            class="lc-card wb-cv"
            :class="{ on: i === 0 }"
          >
            <div class="lc-thumb wb-cv-thumb">
              <img v-if="w.thumbnailType === 'image' && hasCover(w)" loading="lazy" :src="canvasImageThumb(ensureHttps(w.thumbnail))" alt="" @error="onCoverError(w.id)" />
              <template v-else-if="w.thumbnailType === 'video' && hasCover(w)">
                <video :src="ensureHttps(w.thumbnail)" preload="metadata" muted @error="onCoverError(w.id)" />
                <span class="play"><LcIcon name="play" /></span>
              </template>
              <span v-else class="wb-ph"><LcIcon name="canvas" size="xl" /></span>
              <span v-if="w.thumbnailType === 'image' || w.thumbnailType === 'video'" class="lc-bd tag" :class="w.thumbnailType">{{ t(`workbench.kind.${w.thumbnailType}`) }}</span>
            </div>
            <div class="wb-cv-meta">
              <h3 v-tip="{ text: w.name, clipped: true }">{{ w.name }}</h3>
              <small>{{ updatedText(w.updatedAt || w.createdAt) }}</small>
            </div>
          </router-link>
        </div>

        <!-- 从模板开始（集成方关了模板 features.templates：整块不出，也不去取） -->
        <template v-if="$feat.templates">
        <div class="lc-sec-h">
          <h2>{{ t('workbench.templates.title') }}</h2>
          <button class="more wb-linkbtn" @click="libraryOpen = true">{{ t('workbench.templates.all') }}</button>
        </div>
        <div v-if="tplState === 'loading'" class="wb-tpls" aria-hidden="true">
          <div v-for="n in 4" :key="n" class="lc-card wb-tpl"><div class="wb-skel wb-tpl-thumb" /><i class="wb-skel line w60" /><i class="wb-skel line w80" /></div>
        </div>
        <div v-else-if="tplState === 'error'" class="lc-card wb-state sm">
          <p>{{ t('workbench.templates.loadFailed') }}</p>
          <button class="lc-btn sm" @click="loadTemplates">{{ t('common.retry') }}</button>
        </div>
        <div v-else-if="!templates.length" class="lc-card wb-state sm"><p>{{ t('workbench.templates.empty') }}</p></div>
        <div v-else class="wb-tpls">
          <button
            v-for="tpl in templates.slice(0, 4)"
            :key="tpl.key"
            class="lc-card wb-tpl"
            :disabled="creating"
            v-tip="t('workbench.templates.use', { name: tpl.title })"
            @click="useTemplate(tpl)"
          >
            <div class="lc-thumb wb-tpl-thumb">
              <img v-if="tpl.cover" loading="lazy" :src="ensureHttps(tpl.cover)" alt="" />
              <GraphMini v-else :graph="tpl.graph" />
            </div>
            <b>{{ tpl.title }}</b>
            <small v-if="tpl.description">{{ tpl.description }}</small>
          </button>
        </div>
        </template>

        <!-- 最近生成 -->
        <div class="lc-sec-h">
          <h2>{{ t('workbench.recent.title') }}</h2>
          <span v-if="todayRuns > 0" class="lc-chip">{{ t('workbench.recent.today', { n: todayRuns }) }}</span>
          <router-link to="/history" class="more">{{ t('workbench.recent.history') }}</router-link>
        </div>
        <div v-if="recState === 'loading'" class="wb-gens" aria-hidden="true">
          <div v-for="n in 6" :key="n" class="wb-gen"><div class="wb-skel wb-gen-thumb" /><i class="wb-skel line w80" /><i class="wb-skel line w40" /></div>
        </div>
        <div v-else-if="recState === 'error'" class="lc-card wb-state sm">
          <p>{{ t('workbench.recent.loadFailed') }}</p>
          <button class="lc-btn sm" @click="loadRecords()">{{ t('common.retry') }}</button>
        </div>
        <div v-else-if="!recent.length" class="lc-card wb-state sm"><p>{{ t('workbench.recent.empty') }}</p></div>
        <div v-else class="wb-gens">
          <router-link v-for="r in recent" :key="r.id" :to="genLink(r)" class="wb-gen">
            <div v-if="isActive(r)" class="lc-thumb wb-gen-thumb busy">
              <span v-if="r.status === 'queued'" class="lc-ring sm q"><LcIcon name="history" size="s" /></span>
              <span v-else-if="progressOf(r) > 0" class="lc-ring sm" :style="{ '--p': progressOf(r) }"><span>{{ progressOf(r) }}%</span></span>
              <span v-else class="lc-ring sm spin" />
            </div>
            <div v-else-if="r.status === 'failed'" class="lc-thumb wb-gen-thumb fail" v-tip="r.error || ''">
              <LcIcon name="warn" size="s" />
              <span v-if="r.error" class="wb-gen-err">{{ r.error }}</span>
            </div>
            <div v-else class="lc-thumb wb-gen-thumb">
              <template v-if="previewOf(r)">
                <img v-if="previewOf(r)!.img" loading="lazy" :src="previewOf(r)!.img" alt="" @error="onPreviewError(r.id)" />
                <video v-else :src="previewOf(r)!.video" preload="metadata" muted @error="onPreviewError(r.id)" />
                <span v-if="previewOf(r)!.isVideo" class="play"><LcIcon name="play" /></span>
              </template>
              <span v-else class="wb-ph" v-tip="r.kind === 'chat' ? t('workbench.recent.textResult') : t('workbench.recent.noPreview')">
                <LcIcon :name="r.kind === 'chat' ? 'chat' : r.kind === 'video' ? 'video' : 'image'" size="l" />
              </span>
            </div>
            <div class="wb-gen-cap">
              <span v-tip="{ text: r.modelLabel || r.model, clipped: true }">{{ r.modelLabel || r.model }}</span>
              <span class="lc-st" :class="stClass(r.status)">{{ t(`workbench.status.${r.status}`) }}</span>
            </div>
          </router-link>
        </div>
      </div>

      <!-- 右侧窄栏 -->
      <aside class="wb-rail">
        <!-- 团队空间里用量在上面那一排数字里 -->
        <section v-if="!space.isTeam" class="lc-card lc-glass wb-rc">
          <div class="lc-row"><h2>{{ t('workbench.usage.title') }}</h2><span class="lc-sp" /><span class="lc-chip">{{ t('workbench.usage.thisMonth') }}</span></div>
          <div v-if="usageState === 'loading'" class="wb-rc-body" aria-hidden="true">
            <i class="wb-skel line w60 tall" /><i class="wb-skel wb-bars-skel" /><i class="wb-skel line w80 tall" /><i class="wb-skel line w60 tall" />
          </div>
          <div v-else-if="usageState === 'error'" class="wb-rc-state">
            <p>{{ t('workbench.usage.loadFailed') }}</p>
            <button class="lc-btn sm" @click="loadUsage()">{{ t('common.retry') }}</button>
          </div>
          <template v-else>
            <div class="wb-rc-body">
              <div class="wb-ustat"><span>{{ t('workbench.usage.runs') }}</span><b>{{ month.runs }}<small v-if="runsUnit">{{ runsUnit }}</small></b></div>
              <div class="wb-bars" role="img" :aria-label="t('workbench.usage.bars')">
                <i v-for="d in bars" :key="d.key" :class="{ zero: !d.runs }" :style="{ height: d.h + '%' }" v-tip="t('workbench.usage.barTip', { date: d.label, n: d.runs })" />
              </div>
              <div class="lc-help wb-bars-cap">{{ t('workbench.usage.bars') }}</div>
              <div class="wb-ustat"><span>{{ t('workbench.usage.successRate') }}</span><b v-if="month.rate !== null">{{ month.rate }}<small>%</small></b><span v-else class="wb-dash">—</span></div>
              <div v-if="$feat.cost" class="wb-ustat mid">
                <span>{{ t('workbench.usage.cost') }}</span>
                <span v-if="!month.cost" class="wb-dash">—</span>
                <span v-else-if="month.cost.unknown" class="lc-unk wb-unk">{{ t('cost.unknown') }}</span>
                <b v-else class="wb-money">{{ formatCost(month.cost) }}</b>
              </div>
            </div>
            <div v-if="$feat.cost && $feat.modelManagement && unpriced > 0" class="lc-alert info wb-unpriced">
              <LcIcon name="key" />
              <span>{{ t('workbench.usage.unpriced', { n: unpriced }) }} <router-link to="/models">{{ t('workbench.usage.setPrices') }}</router-link></span>
            </div>
          </template>
        </section>

        <!-- 团队空间没有上面那张用量卡片；「还有模型没填价格」这句提醒留给能填价格的人 -->
        <div v-if="$feat.cost && $feat.modelManagement && space.isTeam && space.can('provider:manage') && unpriced > 0" class="lc-alert info wb-unpriced" data-testid="team-unpriced">
          <LcIcon name="key" />
          <span>{{ t('workbench.usage.unpriced', { n: unpriced }) }} <router-link :to="{ name: 'models' }">{{ t('workbench.usage.setPrices') }}</router-link></span>
        </div>

        <section class="lc-card lc-glass wb-rc">
          <div v-if="space.isTeam" class="lc-row"><h2>{{ t('workbench.team.running') }}</h2><span class="lc-sp" /><span v-if="queueScope" class="lc-chip">{{ t(`workbench.team.scope.${queueScope}`) }}</span></div>
          <div v-else class="lc-row"><h2>{{ t('workbench.queue.title') }}</h2><span class="lc-sp" /><span v-if="active.length" class="lc-chip">{{ t('workbench.queue.active', { n: active.length }) }}</span></div>
          <div v-if="recState === 'loading'" class="wb-rc-body" aria-hidden="true"><i class="wb-skel line w80 tall" /><i class="wb-skel line w60 tall" /></div>
          <div v-else-if="recState === 'error'" class="wb-rc-state">
            <p>{{ t('workbench.recent.loadFailed') }}</p>
            <button class="lc-btn sm" @click="loadRecords()">{{ t('common.retry') }}</button>
          </div>
          <p v-else-if="!active.length" class="wb-rc-empty">{{ t('workbench.queue.empty') }}</p>
          <!-- 团队空间：谁发起的、哪个模型、在哪张画布上、进度。名字只在接口给了的时候才有 -->
          <div v-else-if="space.isTeam" class="wb-rc-body">
            <router-link v-for="r in active.slice(0, 5)" :key="r.id" :to="genLink(r)" class="wb-trow">
              <div class="wb-trow-top">
                <template v-if="r.createdBy">
                  <b class="wb-trow-who"><PersonName :person="r.createdBy" :avatar="22" /></b>
                </template>
                <span class="wb-trow-model" v-tip="{ text: r.modelLabel || r.model, clipped: true }">{{ r.modelLabel || r.model }}</span>
                <span class="wb-trow-st" :class="r.status === 'queued' ? 'wait' : 'run'">{{ t(`workbench.status.${r.status}`) }}</span>
              </div>
              <div class="wb-trow-sub">
                <small v-tip="{ text: canvasName(r), clipped: true }">{{ canvasName(r) || queueSpec(r) || t(`workbench.kind.${r.kind}`) }}</small>
                <i class="wb-pbar" :class="{ idle: r.status === 'queued', busy: r.status !== 'queued' && !progressOf(r) }" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progressOf(r)" :aria-label="t(`workbench.status.${r.status}`)">
                  <i :style="{ width: progressOf(r) + '%' }" />
                </i>
              </div>
            </router-link>
            <router-link v-if="activeTotal > 5" to="/history" class="wb-more">{{ t('workbench.team.moreActive', { n: activeTotal - 5 }) }}</router-link>
          </div>
          <div v-else class="wb-rc-body">
            <router-link v-for="r in active.slice(0, 5)" :key="r.id" :to="genLink(r)" class="wb-qrow">
              <span v-if="r.status === 'queued'" class="lc-ring sm q"><LcIcon name="history" size="s" /></span>
              <span v-else-if="progressOf(r) > 0" class="lc-ring sm" :style="{ '--p': progressOf(r) }"><span>{{ progressOf(r) }}%</span></span>
              <span v-else class="lc-ring sm spin" />
              <div>
                <b>{{ t(`workbench.kind.${r.kind}`) }} · {{ r.modelLabel || r.model }}</b>
                <small>{{ queueSub(r) }}</small>
              </div>
            </router-link>
          </div>
        </section>

        <!-- 服务商是「模型管理」的一部分：集成方关了它（features.modelManagement，服务商由宿主的后端配）就不出这张卡片 -->
        <section v-if="$feat.modelManagement" class="lc-card lc-glass wb-rc">
          <div class="lc-row">
            <h2>{{ space.isTeam ? t('workbench.team.providers') : t('workbench.providers.title') }}</h2><span class="lc-sp" />
            <!-- 团队里只有能配置服务商的人（团长、管理员）才有「管理」 -->
            <router-link v-if="!space.isTeam" to="/models" class="wb-manage">{{ t('workbench.providers.manage') }}</router-link>
            <router-link v-else-if="canManageProviders" :to="teamTo('models')" class="lc-btn sm wb-manage-btn">{{ t('workbench.providers.manage') }}</router-link>
          </div>
          <div v-if="provState === 'loading'" class="wb-rc-body" aria-hidden="true"><i class="wb-skel line w80 tall" /><i class="wb-skel line w60 tall" /></div>
          <div v-else-if="provState === 'error'" class="wb-rc-state">
            <p>{{ t('workbench.providers.loadFailed') }}</p>
            <button class="lc-btn sm" @click="loadProviders">{{ t('common.retry') }}</button>
          </div>
          <div v-else-if="!providers.length" class="wb-rc-state">
            <p>{{ canManageProviders ? t('workbench.providers.empty') : t('workbench.team.providersWait') }}</p>
            <router-link v-if="canManageProviders" to="/models" class="lc-btn sm"><LcIcon name="plus" size="s" />{{ t('workbench.providers.add') }}</router-link>
          </div>
          <div v-else-if="space.isTeam" class="wb-rc-body">
            <div v-for="p in providers" :key="p.id" class="wb-tprow">
              <SpaceAvatar :name="p.name" :seed="p.id" :size="30" />
              <div class="wb-tp-t">
                <b v-tip="{ text: p.name, clipped: true }">{{ p.name }}</b>
                <small v-if="modelCounts">{{ t('workbench.team.modelCount', { n: modelCounts[p.id]?.total || 0, on: modelCounts[p.id]?.enabled || 0 }) }}</small>
              </div>
              <span class="lc-tag" :class="provTag(p)">{{ t(provStatus(p).key) }}</span>
            </div>
            <p v-if="!canManageProviders" class="lc-help wb-keynote">{{ t('workbench.team.keyNote') }}</p>
          </div>
          <div v-else class="wb-rc-body">
            <div v-for="p in providers" :key="p.id" class="wb-prow">
              <span v-tip="{ text: p.name, clipped: true }">{{ p.name }}</span>
              <span class="lc-st" :class="provStatus(p).cls">{{ t(provStatus(p).key) }}</span>
            </div>
          </div>
        </section>
      </aside>
    </div>

    <CanvasNameDialog
      v-model="nameOpen"
      :title="t('views.list.newCanvas')"
      :ok-text="t('views.list.create')"
      :busy-text="t('views.list.creating')"
      :busy="creating"
      @submit="createBlank"
    />

    <!-- 「全部模板」：和画布列表用的是同一个弹窗，选中的东西落到一个新画布里 -->
    <LibraryDialog
      v-if="$feat.templates"
      v-model="libraryOpen"
      initial-tab="canvas-template"
      @add-asset="onLibraryAsset"
      @apply-template="onLibraryTemplate"
      @add-text="onLibraryText"
    />

    <!-- 团队画布卡片右下角「…」里的操作和它们的弹窗（和画布列表是同一套） -->
    <CanvasActions v-if="space.isTeam" ref="acts" @changed="onCanvasesChanged" @patched="onCanvasPatched" />
  </div></div>
</template>

<script setup lang="ts">
/**
 * 工作台首页：登录后的落点。
 * 左边按使用频率排 —— 最近的画布、从模板开始、最近生成；右边是看一眼就够的用量、队列、服务商。
 * 每一块各自取数、各自有加载 / 空 / 出错三种状态，一块挂了不拖累别的。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  adminApi, runsApi, workflowApi, canvasTemplateApi, unwrap, type WorkflowSummary,
} from '@/utils/api'
import { useAppStore } from '@/stores/app'
import { useSpaceStore, spaceParam } from '@/stores/space'
import { ensureHttps } from '@/utils/mediaUrl'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { formatCost, sumCosts } from '@/utils/cost'
import { clipLength } from '@/utils/duration'
import { featureOn } from '@/utils/canvasBackend'
import LcIcon from '@/components/LcIcon.vue'
import LibraryDialog from '@/components/canvas/LibraryDialog.vue'
import CanvasNameDialog from '@/components/workbench/CanvasNameDialog.vue'
import GraphMini from '@/components/workbench/GraphMini.vue'
import TeamOverview from '@/components/workbench/TeamOverview.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import CanvasCard from '@/components/canvaslist/CanvasCard.vue'
import CanvasActions from '@/components/canvaslist/CanvasActions.vue'
import { mergeList, useCanvasLocks } from '@/components/canvaslist/useCanvasLocks'
import PersonName from '@/components/PersonName.vue'
import { useCanvasCreate, type TemplateLike } from '@/components/workbench/useCanvasCreate'
import type { AdminModel, Cost, ProviderInstance, Run, RunStatus, UsageRecord, UsageSummaryRow } from '@/types'

type LoadState = 'loading' | 'ready' | 'error'
/** 记录接口实际返回的比 UsageRecord 类型多几项，这里用到的补上 */
type Rec = UsageRecord & { modelLabel?: string; error?: string; params?: Record<string, any> }
interface Tpl extends TemplateLike { key: string; title: string; description?: string; cover?: string }

const { t, locale } = useI18n()
const app = useAppStore()
const router = useRouter()
const space = useSpaceStore()
/** 团队里的页面地址带着空间那一段，链接在新标签页里打开也还在这个团队 */
const teamTo = (name: string, params: Record<string, string> = {}) => ({ name, params: { ...params, space: spaceParam(space.currentId) } })
const { createAndOpen, createFromTemplate, createFromAsset, createFromText } = useCanvasCreate()

/* ===== 问候 ===== */
const now = ref(new Date())
const greeting = computed(() => {
  const h = now.value.getHours()
  const part = h < 5 ? 'dawn' : h < 11 ? 'morning' : h < 13 ? 'noon' : h < 18 ? 'afternoon' : 'evening'
  const g = t(`workbench.greeting.${part}`)
  const name = app.user?.username
  return name ? t('workbench.greeting.withName', { greeting: g, name }) : g
})

/* ===== 画布 ===== */
const canvases = ref<WorkflowSummary[]>([])
const canvasState = ref<LoadState>('loading')
const recentCanvases = computed(() => canvases.value.slice(0, 6))

/** 最近改动的在前 */
const canvasTs = (w: WorkflowSummary) => new Date(w.updatedAt || w.createdAt).getTime() || 0
const byRecent = (a: WorkflowSummary, b: WorkflowSummary) => canvasTs(b) - canvasTs(a)

async function loadCanvases(quiet = false) {
  if (!quiet) canvasState.value = 'loading'
  try {
    const list = unwrap(await workflowApi.list()) || []
    // 没变的卡片留着原来的对象：安静地重取（轮询发现张数对不上时）不重绘没变的那些
    canvases.value = mergeList(canvases.value, [...list].sort(byRecent))
    canvasState.value = 'ready'
  } catch {
    if (!quiet) canvasState.value = 'error'
  }
}

// 团队空间：隔几秒问一次谁正在编辑、别人改的名字、新建 / 删掉 / 恢复的画布，变了的卡片就地换（见 useCanvasLocks）
useCanvasLocks(canvases, {
  enabled: () => space.isTeam && canvasState.value === 'ready',
  onTick: () => { now.value = new Date() },
  reload: () => loadCanvases(true),
  order: byRecent,
})

/* 团队空间的画布卡片：点开、卡片上的操作 */
const overview = ref<InstanceType<typeof TeamOverview> | null>(null)
const acts = ref<InstanceType<typeof CanvasActions> | null>(null)
const openCanvas = (id: string) => router.push({ name: 'canvas', params: { id } })
function onCanvasPatched(canvas: WorkflowSummary) {
  canvases.value = canvases.value.map((it) => (it.id === canvas.id ? { ...it, ...canvas } : it))
}
/** 多了一张 / 少了一张：列表重取；「新建画布」那一步引导做没做完也跟着变 */
function onCanvasesChanged() {
  void loadCanvases(true)
  void overview.value?.reload(true)
}

/** 封面取不到（资源被清理过）时退回占位图，不让浏览器画破图标 */
const brokenCovers = ref(new Set<string>())
const onCoverError = (id: string) => { brokenCovers.value = new Set(brokenCovers.value).add(id) }
const hasCover = (w: WorkflowSummary) => !!w.thumbnail && !brokenCovers.value.has(w.id)

function updatedText(v: string) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const n = now.value
  const mins = Math.floor((n.getTime() - d.getTime()) / 60000)
  if (mins < 1) return t('workbench.canvases.justNow')
  if (mins < 60) return t('workbench.canvases.minutesAgo', { n: mins })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(n) - day(d)) / 86400000)
  const time = new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  if (diff === 0) return t('workbench.canvases.today', { time })
  if (diff === 1) return t('workbench.canvases.yesterday', { time })
  const date = new Intl.DateTimeFormat(locale.value, {
    month: 'short', day: 'numeric', ...(d.getFullYear() === n.getFullYear() ? {} : { year: 'numeric' }),
  }).format(d)
  return t('workbench.canvases.onDate', { date })
}

/* ===== 新建 ===== */
const nameOpen = ref(false)
const libraryOpen = ref(false)
const creating = ref(false)

async function guarded(fn: () => Promise<boolean>): Promise<boolean> {
  if (creating.value) return false
  creating.value = true
  try { return await fn() } finally { creating.value = false }
}
async function createBlank(name: string) {
  if (await guarded(() => createAndOpen(name))) nameOpen.value = false
}
const useTemplate = (tpl: Tpl) => guarded(() => createFromTemplate(tpl))
async function onLibraryAsset(asset: { nodeType?: string; mediaUrl?: string; name?: string }) {
  if (await guarded(() => createFromAsset(asset))) libraryOpen.value = false
}
async function onLibraryTemplate(tpl: TemplateLike) {
  if (await guarded(() => createFromTemplate(tpl))) libraryOpen.value = false
}
async function onLibraryText(content: string) {
  if (await guarded(() => createFromText(content))) libraryOpen.value = false
}

/* ===== 模板 ===== */
const templates = ref<Tpl[]>([])
const tplState = ref<LoadState>('loading')
async function loadTemplates() {
  tplState.value = 'loading'
  try {
    const list = unwrap(await canvasTemplateApi.list())
    templates.value = Array.isArray(list) ? list : []
    tplState.value = 'ready'
  } catch {
    tplState.value = 'error'
  }
}

/* ===== 生成记录 + 队列 =====
   最近 30 条记录取一次：前 6 条是「最近生成」，其中还没结束的是「生成队列」。
   缩略图和进度在 /runs/status 里（只有图片 / 视频任务），按 id 批量补。 */
const ACTIVE: RunStatus[] = ['queued', 'running', 'archiving']
const records = ref<Rec[]>([])
const runs = ref<Record<string, Run>>({})
const recState = ref<LoadState>('loading')
const isActive = (r: Rec) => ACTIVE.includes(r.status)
const recent = computed(() => records.value.slice(0, 6))
/** 正在跑的排前面，排队的跟在后面（队列卡只列前几条） */
const active = computed(() => {
  const list = space.isTeam ? teamActive.value : records.value.filter(isActive)
  return [...list.filter(r => r.status !== 'queued'), ...list.filter(r => r.status === 'queued')]
})
/**
 * 团队空间：全队同时在跑的可能比「最近 30 条」多得多，所以没结束的按状态单独取，数字用接口给的总数。
 * 谁看得到谁的由接口定（scope：all 全队 / own 只有自己的）。
 */
const teamActive = ref<Rec[]>([])
const teamCounts = ref({ running: 0, queued: 0 })
const queueScope = ref<'all' | 'own' | ''>('')
const runningCount = computed(() => (space.isTeam ? teamCounts.value.running : active.value.filter(r => r.status !== 'queued').length))
const queuedCount = computed(() => (space.isTeam ? teamCounts.value.queued : active.value.filter(r => r.status === 'queued').length))
const activeTotal = computed(() => runningCount.value + queuedCount.value)

async function loadRecords(quiet = false) {
  if (!quiet) recState.value = 'loading'
  try {
    const [data, ...byStatus] = await Promise.all([
      adminApi.usageRecords({ page: 1, pageSize: 30 }).then(unwrap),
      ...(space.isTeam ? ACTIVE.map(status => adminApi.usageRecords({ status, page: 1, pageSize: 20 }).then(unwrap)) : []),
    ])
    const list: Rec[] = data?.list || []
    const teamList: Rec[] = byStatus.flatMap(d => d?.list || [])
    const ids = [...new Set([...list.slice(0, 6), ...(space.isTeam ? teamList : list.filter(isActive))].filter(r => r.kind !== 'chat').map(r => r.id))]
    let map: Record<string, Run> = {}
    if (ids.length) {
      // 缩略图补不上不算整块失败：照样列出来，只是没有预览
      try {
        map = Object.fromEntries((unwrap(await runsApi.status(ids)) || []).map(r => [r.id, r]))
      } catch { map = runs.value }
    }
    const hadActive = active.value.length > 0
    records.value = list
    if (space.isTeam) {
      const total = (s: RunStatus) => byStatus[ACTIVE.indexOf(s)]?.total || 0
      teamActive.value = teamList
      teamCounts.value = { running: total('running') + total('archiving'), queued: total('queued') }
      queueScope.value = data?.scope === 'own' ? 'own' : 'all'
    }
    runs.value = map
    recState.value = 'ready'
    // 队列刚清空：用量数字跟着变了，悄悄刷一次
    if (quiet && hadActive && !active.value.length) {
      loadUsage(true)
      void overview.value?.reload(true)
    }
  } catch {
    // 轮询失败不打扰：保留上一次的内容，下一轮再试
    if (!quiet) recState.value = 'error'
  }
}

const progressOf = (r: Rec) => Math.max(0, Math.min(100, Math.round(Number(runs.value[r.id]?.progress) || 0)))

const brokenPreviews = ref(new Set<string>())
const onPreviewError = (id: string) => { brokenPreviews.value = new Set(brokenPreviews.value).add(id) }
function previewOf(r: Rec): { img: string; video: string; isVideo: boolean } | null {
  if (brokenPreviews.value.has(r.id)) return null
  const out = runs.value[r.id]?.outputs?.[0]
  if (!out?.url) return null
  const isVideo = out.type === 'video'
  const img = out.thumbnailUrl || (isVideo ? '' : out.url)
  return { img: ensureHttps(img), video: isVideo && !img ? ensureHttps(out.url) : '', isVideo }
}

const stClass = (s: RunStatus) =>
  s === 'succeeded' ? 'ok' : s === 'failed' ? 'err' : s === 'queued' || s === 'canceled' ? 'wait' : 'run'

/** 点一条生成：它所在的画布还在就去画布，否则去生成记录 */
const genLink = (r: Rec) =>
  r.workflowId && canvases.value.some(w => w.id === r.workflowId) ? `/canvas/${r.workflowId}` : '/history'

function queueSpec(r: Rec) {
  const p = r.params || {}
  // 顺序和画布节点、队列、生成记录一致：比例 · 分辨率 · 时长
  const spec: string[] = []
  if (p.aspectRatio && p.aspectRatio !== 'auto') spec.push(String(p.aspectRatio))
  if (p.resolution) spec.push(String(p.resolution))
  if (Number(p.duration) > 0) spec.push(clipLength(Number(p.duration)))
  return spec.join(' | ')
}
function queueSub(r: Rec) {
  const spec = queueSpec(r)
  return [t(`workbench.status.${r.status}`), ...(spec ? [spec] : [])].join(' · ')
}
/** 这次生成是在哪张画布上跑的（只认我看得到的画布） */
const canvasName = (r: Rec) => (r.workflowId && canvases.value.find(w => w.id === r.workflowId)?.name) || ''


/* 有任务在跑、且页面看得见时，每 5 秒悄悄刷一次；跑完或切走就停 */
let timer = 0
function schedule() {
  window.clearTimeout(timer)
  timer = window.setTimeout(async () => {
    if (document.visibilityState === 'visible' && active.value.length) await loadRecords(true)
    now.value = new Date()
    schedule()
  }, 5000)
}
function onVisible() {
  if (document.visibilityState !== 'visible') return
  now.value = new Date()
  if (active.value.length) loadRecords(true)
}

/* ===== 用量 ===== */
const dayRows = ref<UsageSummaryRow[]>([])
const models = ref<AdminModel[]>([])
const usageState = ref<LoadState>('loading')
const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function loadUsage(quiet = false) {
  if (!quiet) usageState.value = 'loading'
  try {
    const today = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const barsStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13)
    const from = monthStart < barsStart ? monthStart : barsStart
    // 按浏览器所在时区分天，「今天」「本月」才和用户看到的日历对得上
    const query = { from: from.toISOString(), groupBy: 'day' as const, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }
    const [usage, list] = await Promise.all([
      adminApi.usage(query),
      // 模型清单只用来数「没填价格的有几个」，取不到就不显示那条提示
      adminApi.models().then(r => unwrap(r) || [], () => [] as AdminModel[]),
    ])
    dayRows.value = unwrap(usage)?.items || []
    models.value = list
    usageState.value = 'ready'
  } catch {
    if (!quiet) usageState.value = 'error'
  }
}

const month = computed(() => {
  const start = dayKey(new Date(now.value.getFullYear(), now.value.getMonth(), 1))
  const rows = dayRows.value.filter(r => r.key >= start)
  const sum = (f: 'runs' | 'succeeded' | 'failed') => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0)
  const done = sum('succeeded') + sum('failed')
  // 只有成功的任务才有花费；某天有没算出价的成功任务，这一天就是未知
  const costs: Cost[] = rows.filter(r => (r.succeeded || 0) > 0).map(r =>
    (r.unknownCount || 0) > 0 || !r.currency
      ? { amount: 0, currency: '', unknown: true }
      : { amount: r.amount, currency: r.currency, unknown: false })
  return {
    runs: sum('runs'),
    rate: done ? Math.round((sum('succeeded') / done) * 1000) / 10 : null,
    cost: sumCosts(costs),
  }
})
const runsUnit = computed(() => t('workbench.usage.runsUnit').trim())

const bars = computed(() => {
  const byKey = new Map(dayRows.value.map(r => [r.key, r.runs]))
  const fmt = new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' })
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.value.getFullYear(), now.value.getMonth(), now.value.getDate() - 13 + i)
    return { key: dayKey(d), label: fmt.format(d), runs: byKey.get(dayKey(d)) || 0 }
  })
  const max = Math.max(1, ...days.map(d => d.runs))
  return days.map(d => ({ ...d, h: d.runs ? Math.max(8, Math.round((d.runs / max) * 100)) : 4 }))
})
const todayRuns = computed(() => dayRows.value.find(r => r.key === dayKey(now.value))?.runs || 0)
const unpriced = computed(() => models.value.filter(m => m.enabled && m.providerEnabled !== false && !m.pricing).length)

/* ===== 服务商 ===== */
const providers = ref<ProviderInstance[]>([])
const provState = ref<LoadState>('loading')
/** 团队里能不能配置服务商（团长、管理员）；个人空间里总是能 */
const canManageProviders = computed(() => space.can('provider:manage'))
/** 每个服务商下面有几个模型、启用了几个（团队首页用）；模型清单取不到时为 null，那一行就不写 */
const modelCounts = ref<Record<string, { total: number; enabled: number }> | null>(null)
async function loadProviders() {
  provState.value = 'loading'
  try {
    const [list, all] = await Promise.all([
      adminApi.providers(),
      space.isTeam ? adminApi.models().then(r => unwrap(r) || [], () => null) : Promise.resolve(null),
    ])
    providers.value = unwrap(list) || []
    if (all) {
      const counts: Record<string, { total: number; enabled: number }> = {}
      for (const m of all as AdminModel[]) {
        const c = (counts[m.providerId] ||= { total: 0, enabled: 0 })
        c.total++
        if (m.enabled) c.enabled++
      }
      modelCounts.value = counts
    } else {
      modelCounts.value = null
    }
    provState.value = 'ready'
  } catch {
    provState.value = 'error'
  }
}
const provTag = (p: ProviderInstance) => ({ ok: 'ok', warn: 'warn', wait: '' }[provStatus(p).cls] || '')
/** 后端不保存连通性测试的结果，所以这里只说确定的事：停用了 / 没填 Key / 已启用 */
function provStatus(p: ProviderInstance) {
  if (!p.enabled) return { cls: 'wait', key: 'workbench.providers.disabled' }
  if (!p.hasKey) return { cls: 'warn', key: 'workbench.providers.noKey' }
  return { cls: 'ok', key: 'workbench.providers.ready' }
}

/* ===== 副标题 ===== */
const subLine = computed(() => {
  const parts: string[] = []
  const n = runningCount.value
  const q = queuedCount.value
  if (n && q) parts.push(t('workbench.sub.runningQueued', { n, q }))
  else if (n) parts.push(t('workbench.sub.running', { n }))
  else if (q) parts.push(t('workbench.sub.queued', { q }))
  const last = canvases.value[0]
  if (last) parts.push(t('workbench.sub.lastEdited', { name: last.name }))
  if (!parts.length && canvasState.value === 'ready') parts.push(t('workbench.sub.fresh'))
  return parts.join(locale.value === 'zh-CN' ? '' : ' ')
})

onMounted(() => {
  loadCanvases()
  if (featureOn('templates')) loadTemplates()
  loadRecords()
  loadUsage()
  if (featureOn('modelManagement')) loadProviders()
  schedule()
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  window.clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<style scoped>
.wb-head { align-items: center; }
.wb-hello { min-width: 0; flex: 1 1 320px; }
.wb-hello .lc-ph-sub { min-height: 22px; }
.wb-new { height: 40px; padding: 0 20px; }

.wb-grid { display: grid; grid-template-columns: minmax(0, 1fr) 328px; gap: 24px; margin-top: 8px; align-items: start; }
.wb-main { min-width: 0; }
.wb-first { margin-top: 24px; }
.wb-linkbtn { border: 0; background: none; padding: 0; font: inherit; font-size: 13px; }
.wb-linkbtn:hover, .lc-sec-h .more:hover { text-decoration: underline; }

/* 画布卡 */
.wb-cvs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.wb-cv { display: block; overflow: hidden; min-width: 0; color: inherit; transition: border-color .15s, box-shadow .15s; }
.wb-cv:hover { text-decoration: none; border-color: var(--line-3); }
.wb-cv.on:hover { border-color: rgb(var(--c-cyan) / .8); }
.wb-cv-thumb { height: 144px; }
/* 封面可能是浅色的图：徽标垫一层深底才读得出来 */
.wb-cv-thumb .tag { box-shadow: 0 0 0 99px var(--tag-scrim) inset; }
.wb-cv-meta { padding: 12px 14px 14px; }
.wb-cv-meta h3 { font: 600 14px/1.5 var(--f-body); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-cv-meta small { display: block; font-size: 12px; color: var(--text-3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-ph {
  position: absolute; inset: 0; display: grid; place-items: center; color: rgb(var(--c-film-2) / .38);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .07), rgb(var(--c-violet) / .1));
}

.wb-cvs.team :deep(.cc-thumb) { aspect-ratio: auto; height: 168px; }
.wb-all { display: inline-flex; align-items: center; gap: 2px; }

/* 模板卡 */
.wb-tpls { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.wb-tpl {
  display: block; padding: 10px 10px 12px; min-width: 0; text-align: left; color: inherit; font: inherit;
  cursor: pointer; transition: border-color .15s;
}
.wb-tpl:hover:not(:disabled) { border-color: var(--line-3); }
.wb-tpl:disabled { opacity: .6; cursor: progress; }
.wb-tpl-thumb { height: 72px; border-radius: 9px; margin-bottom: 10px; }
.wb-tpl b { display: block; font-weight: 600; font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 真实的模板说明比设计稿里的长，给两行 */
.wb-tpl small { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 12px; line-height: 1.5; color: var(--text-3); margin-top: 2px; }

/* 最近生成 */
.wb-gens { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.wb-gen { display: block; min-width: 0; color: inherit; }
.wb-gen:hover { text-decoration: none; }
.wb-gen-thumb { height: 92px; border-radius: 10px; border: 1px solid var(--line); transition: border-color .15s; }
.wb-gen:hover .wb-gen-thumb { border-color: var(--line-3); }
.wb-gen-thumb.busy { display: grid; place-items: center; background: linear-gradient(135deg, rgb(var(--c-cyan) / .1), rgb(var(--c-violet) / .14)); }
.wb-gen-thumb.fail {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 6px 8px;
  background: rgb(var(--c-err) / .07); border-color: rgb(var(--c-err) / .3); color: var(--err-soft); font-size: 12px; line-height: 1.4;
}
.wb-gen-err { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; text-align: center; overflow-wrap: anywhere; }
.wb-gen-cap { margin-top: 8px; font-size: 12px; }
.wb-gen-cap > span:first-child { display: block; color: var(--text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-gen-cap .lc-st { font-size: 12px; }
.lc-ring.q { color: var(--text-3); }

/* 右栏 */
.wb-rail { display: grid; gap: 16px; margin-top: 24px; min-width: 0; }
.wb-rc { padding: 20px; min-width: 0; border-radius: var(--r-md); }
.wb-rc h2 { font: 600 15px/1.4 var(--f-disp); color: var(--text); }
.wb-rc-body { margin-top: 8px; }
.wb-ustat { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); }
.wb-ustat:first-child { border-top: 0; }
.wb-ustat.mid { align-items: center; }
.wb-ustat > span:first-child { color: var(--text-2); font-size: 13px; }
.wb-ustat b { font: 600 24px/1 var(--f-disp); color: var(--text); }
.wb-ustat b small { font: 400 12px var(--f-body); color: var(--text-3); margin-left: 4px; }
.wb-ustat b.wb-money { font-size: 20px; }
.wb-unk { font-size: 15px; color: var(--text-2); }
.wb-dash { color: var(--text-3); font-size: 15px; }
.wb-bars { display: flex; align-items: flex-end; gap: 4px; height: 48px; margin-top: 4px; }
.wb-bars i { flex: 1; min-width: 0; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, var(--cyan), rgb(var(--c-blue) / .35)); }
.wb-bars i.zero { background: rgb(var(--c-film) / .16); }
.wb-bars-cap { margin: 6px 0 12px; }
.wb-unpriced { margin-top: 4px; }
.wb-rc-empty { margin-top: 12px; color: var(--text-3); font-size: 13px; }
.wb-rc-state { margin-top: 12px; color: var(--text-3); font-size: 13px; display: grid; gap: 10px; justify-items: start; }
.wb-qrow { display: flex; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); color: inherit; min-width: 0; }
.wb-qrow:first-child { border-top: 0; }
.wb-qrow:hover { text-decoration: none; }
.wb-qrow > div { min-width: 0; }
.wb-qrow b { display: block; font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-qrow small { display: block; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-prow { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 36px; font-size: 13px; }
.wb-prow > span:first-child { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.wb-manage { font-size: 13px; }
.wb-manage-btn { text-decoration: none; }

/* 团队空间：正在运行 */
.wb-trow { display: block; padding: 12px 0; border-top: 1px solid var(--line); color: inherit; min-width: 0; }
.wb-trow:first-child { border-top: 0; padding-top: 4px; }
.wb-trow:hover { text-decoration: none; }
.wb-trow-top { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.wb-trow-top b { flex: 0 1 auto; min-width: 0; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-trow-model { flex: 1 1 0; min-width: 0; color: var(--text-2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-trow-st { flex: none; font-size: 12px; color: var(--text-3); }
.wb-trow-st.run { color: var(--cyan-soft); }
.wb-trow-sub { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.wb-trow-sub small { flex: 1; min-width: 0; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-pbar { flex: none; display: block; width: 90px; height: 4px; border-radius: 2px; background: rgb(var(--c-film) / .16); overflow: hidden; }
.wb-pbar > i { display: block; height: 100%; border-radius: 2px; background: var(--cyan); transition: width .3s; }
/* 上游不报进度的任务：一截来回走的光条，表示「在跑」 */
.wb-pbar.busy > i { width: 40% !important; animation: wb-slide 1.4s ease-in-out infinite alternate; }
@keyframes wb-slide { from { transform: translateX(-20%); } to { transform: translateX(170%); } }
@media (prefers-reduced-motion: reduce) { .wb-pbar.busy > i { animation: none; } }
.wb-more { display: block; padding-top: 10px; border-top: 1px solid var(--line); font-size: 13px; }

/* 团队空间：服务商 */
.wb-tprow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); min-width: 0; }
.wb-tprow:first-child { border-top: 0; }
.wb-tp-t { flex: 1; min-width: 0; }
.wb-tp-t b { display: block; font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-tp-t small { display: block; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-keynote { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }

/* 空 / 出错 */
.wb-state { display: grid; justify-items: center; gap: 8px; padding: 36px 20px; text-align: center; color: var(--text-3); font-size: 13px; }
.wb-state.sm { padding: 24px 20px; }
.wb-state b { font: 600 15px/1.4 var(--f-disp); color: var(--text); }
.wb-state .lc-btn { margin-top: 6px; }
.wb-state-ic {
  width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: var(--cyan);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .18), rgb(var(--c-violet) / .22)); box-shadow: 0 0 0 1px rgb(var(--c-cyan) / .35) inset;
}

/* 骨架 */
.wb-skel { display: block; background: var(--skel-bg); border-radius: 6px; animation: lc-pulse 1.6s ease-in-out infinite; }
.wb-skel.line { height: 10px; margin-top: 8px; }
.wb-skel.line.tall { height: 14px; margin-top: 14px; }
.wb-skel.w40 { width: 40%; } .wb-skel.w60 { width: 60%; } .wb-skel.w80 { width: 80%; }
.wb-skel.wb-cv-thumb, .wb-skel.wb-tpl-thumb, .wb-skel.wb-gen-thumb { border-radius: 0; border: 0; }
.wb-skel.wb-tpl-thumb { border-radius: 9px; margin-bottom: 4px; }
.wb-skel.wb-gen-thumb { border-radius: 10px; }
.wb-bars-skel { height: 48px; margin-top: 14px; }

@media (max-width: 1240px) {
  .wb-grid { grid-template-columns: minmax(0, 1fr); }
  .wb-rail { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); align-items: start; margin-top: 8px; }
}
@media (max-width: 900px) {
  .wb-gens { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .wb-tpls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .wb-new { width: 100%; }
  .wb-cvs { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .wb-cv-thumb { height: 104px; }
  .wb-cvs.team :deep(.cc-thumb) { height: 104px; }
  .wb-tpls { gap: 12px; }
  .wb-rc { padding: 16px; }
}
</style>
