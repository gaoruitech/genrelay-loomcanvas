<template>
  <header class="lc-page-head to-head">
    <SpaceAvatar :name="space.name" :src="detail?.avatar || space.team?.avatar" :seed="space.currentId" :size="56" />
    <div class="to-title">
      <h1 class="lc-ph1" v-tip="{ text: space.name, clipped: true }">{{ space.name }}</h1>
      <p class="lc-ph-sub">{{ headline }}</p>
    </div>
    <span class="lc-sp" />
    <div class="to-actions">
      <router-link v-if="space.can('invite:manage')" class="lc-btn to-btn" :to="teamTo('team', { tab: 'members' })">
        <LcIcon name="users" /><span>{{ t('workbench.team.invite') }}</span>
      </router-link>
      <button class="lc-btn primary to-btn" type="button" @click="emit('create')">
        <LcIcon name="plus" /><span>{{ t('workbench.newCanvas') }}</span>
      </button>
    </div>
  </header>

  <!--
    本月的数字。口径只有一个，和每月上限用的是同一份（接口 limits 里的 breakdown）：
    本月运行 = 已成功 + 进行中；失败、取消的不计，在下面「本月上限」那一块里单独列出。
    成员看到的是自己的（接口按身份给），标题也跟着说「我的」。
  -->
  <div class="to-tiles">
    <section class="lc-card to-tile" data-testid="tile-runs">
      <h2><LcIcon name="bolt" size="s" />{{ own ? t('workbench.team.runsOwn') : t('workbench.team.runs') }}</h2>
      <template v-if="detailState === 'loading'"><i class="to-skel big" /><i class="to-skel" /></template>
      <div v-else-if="detailState === 'error' || !side" class="to-err">
        <span>{{ t('workbench.usage.loadFailed') }}</span>
        <button class="lc-btn sm" type="button" @click="reload()">{{ t('common.retry') }}</button>
      </div>
      <template v-else>
        <b class="to-num">{{ formatInt(side.breakdown.counted.runs) }}</b>
        <small data-part="split">{{ t('workbench.team.runsSplit', { ok: formatInt(side.breakdown.succeeded.runs), going: formatInt(side.breakdown.inProgress.runs) }) }}</small>
        <small v-if="kindsText" data-part="kinds">{{ kindsText }}</small>
      </template>
    </section>

    <section v-if="embed.features.cost" class="lc-card to-tile" data-testid="tile-cost">
      <h2><LcIcon name="key" size="s" />{{ own ? t('workbench.team.costOwn') : t('workbench.team.cost') }}</h2>
      <template v-if="detailState === 'loading'"><i class="to-skel big" /><i class="to-skel" /></template>
      <div v-else-if="detailState === 'error' || !side" class="to-err"><span>{{ t('workbench.usage.loadFailed') }}</span></div>
      <template v-else>
        <b v-if="side.breakdown.counted.amount > 0" class="to-num money">{{ t('cost.approx', { amount: formatMoney(side.breakdown.counted.amount, limits!.currency) }) }}</b>
        <b v-else-if="side.breakdown.unknownCost > 0" class="to-num unk">{{ t('cost.unknown') }}</b>
        <b v-else class="to-num dash">—</b>
        <small v-if="side.breakdown.inProgress.amount > 0" data-part="split">{{ t('workbench.team.costSplit', { ok: formatMoney(side.breakdown.succeeded.amount, limits!.currency), going: formatMoney(side.breakdown.inProgress.amount, limits!.currency) }) }}</small>
        <small v-else-if="side.breakdown.counted.amount > 0">{{ t('workbench.team.estimate') }}</small>
        <small v-else-if="!side.breakdown.unknownCost">{{ t('workbench.team.noCost') }}</small>
        <small v-if="side.breakdown.unknownCost > 0" class="warn" data-part="unknown">{{ unknownText(side.breakdown.unknownCost) }}</small>
      </template>
    </section>

    <section class="lc-card to-tile" data-testid="tile-queue">
      <h2><LcIcon name="queue" size="s" />{{ own ? t('workbench.team.activeOwn') : t('workbench.team.active') }}</h2>
      <template v-if="queueState === 'loading'"><i class="to-skel big" /><i class="to-skel" /></template>
      <div v-else-if="queueState === 'error'" class="to-err"><span>{{ t('workbench.recent.loadFailed') }}</span></div>
      <template v-else>
        <b class="to-num">{{ formatInt(running + queued) }}</b>
        <small v-if="cap && !own" data-part="cap">{{ t('workbench.team.activeSplitCap', { running, queued, cap: formatInt(cap) }) }}</small>
        <template v-else>
          <small>{{ t('workbench.team.activeSplit', { running, queued }) }}</small>
          <small v-if="cap" data-part="cap">{{ t('workbench.team.capShared', { cap: formatInt(cap) }) }}</small>
        </template>
      </template>
    </section>
  </div>

  <!-- 本月上限：看得到全队的是团队的，其余是自己的。数字和上面那两块是同一份 -->
  <section class="lc-card to-limit" data-testid="tile-limit" :data-state="side?.effective.state">
    <header>
      <h2><LcIcon name="shield" size="s" />{{ own ? t('spaces.limits.mine') : t('spaces.limits.team') }}<span v-if="limits" class="to-month">{{ monthText(limits.month) }}</span></h2>
      <span v-if="side" class="lc-tag" :class="{ warn: side.effective.state === 'near', err: side.effective.state === 'reached' }" data-testid="limit-state">{{ stateTag }}</span>
    </header>
    <template v-if="detailState === 'loading'"><i class="to-skel" /><i class="to-skel" /><i class="to-skel short" /></template>
    <div v-else-if="detailState === 'error'" class="to-err">
      <span>{{ t('workbench.team.limitsFailed') }}</span>
      <button class="lc-btn sm" type="button" @click="reload()">{{ t('common.retry') }}</button>
    </div>
    <p v-else-if="!side || !limits" class="to-none">{{ t('workbench.team.noLimitData') }}</p>
    <LimitSide v-else split :side="side" :currency="limits.currency" :resets-at="limits.resetsAt" :timezone="limits.timezone" :member="own" />
  </section>

  <!-- 新团队的三步：做完一步打一个勾，三步都做完整条消失 -->
  <section v-if="steps.length" class="lc-card to-onb" :aria-label="t('workbench.team.onboarding.title')" data-testid="onboarding">
    <h2>{{ t('workbench.team.onboarding.title') }}</h2>
    <ol>
      <li v-for="(s, i) in steps" :key="s.key" :class="{ done: s.done }">
        <span class="to-step-n" aria-hidden="true"><LcIcon v-if="s.done" name="check" size="s" /><template v-else>{{ i + 1 }}</template></span>
        <div class="to-step-t">
          <b>{{ s.title }}<span v-if="s.done" class="to-sr"> · {{ t('workbench.team.onboarding.done') }}</span></b>
          <small>{{ s.hint }}</small>
        </div>
        <template v-if="!s.done">
          <router-link v-if="s.to" class="lc-btn sm" :to="s.to">{{ s.action }}</router-link>
          <button v-else-if="s.key === 'canvas'" class="lc-btn sm" type="button" @click="emit('create')">{{ s.action }}</button>
        </template>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
/**
 * 团队首页的上半截：团队是谁、我在里面是什么角色；四个数字；新团队的三步引导。
 * 数字全部来自接口，而且只有一份：本月运行、本月金额、本月上限都读团队详情里的 limits
 * （已用 = 已成功 + 进行中，团队时区里的自然月），成员拿到的只有自己的。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { adminApi, teamApi, unwrap } from '@/utils/api'
import { useSpaceStore, spaceParam } from '@/stores/space'
import { useEmbed } from '@/embed/context'
import { isPageOpen } from '@/embed/options'
import { formatMoney } from '@/utils/cost'
import { formatInt } from '@/components/space/format'
import { monthText, stateLabel, unknownText } from '@/utils/budget'
import LcIcon from '@/components/LcIcon.vue'
import LimitSide from '@/components/space/LimitSide.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import type { LimitSide as LimitSideData, ModelKind, TeamDetail } from '@/types'

type LoadState = 'loading' | 'ready' | 'error'

defineProps<{
  /** 正在跑的、在排队的各有几个（首页的队列那一块取的，这里只管显示） */
  running: number
  queued: number
  queueState: LoadState
}>()
const emit = defineEmits<{ (e: 'create'): void }>()

const { t } = useI18n()
const space = useSpaceStore()
const embed = useEmbed()

/** 团队里的页面地址带着空间那一段，链接在新标签页里打开也还在这个团队 */
const teamTo = (name: string, params: Record<string, string> = {}) => ({ name, params: { ...params, space: spaceParam(space.currentId) } })

/* ===== 团队 ===== */
const detail = ref<TeamDetail | null>(null)
const detailState = ref<LoadState>('loading')
async function loadDetail(quiet = false) {
  if (!quiet) detailState.value = 'loading'
  try {
    detail.value = unwrap(await teamApi.detail(space.currentId))
    detailState.value = 'ready'
  } catch {
    // 空间没了（被移出、解散）由外壳统一处理；别的失败这一块自己说
    if (!quiet) detailState.value = 'error'
  }
}

/**
 * 「你是团长 · 5 名成员 · 这里的画布、素材和 Key 属于团队」。集成方关掉的东西不提：
 * 素材库（features.assetLibrary）、模型管理（features.modelManagement —— Key 在那一页上）；
 * 团队管理关了（features.teamAdmin：成员由宿主自己管）就不报成员数。
 */
const headline = computed(() => {
  const n = embed.features.teamAdmin ? detail.value?.members ?? space.team?.members : 0
  const role = t(`spaces.role.${detail.value?.me?.role || space.role}`)
  const assets = embed.features.assetLibrary
  const keys = embed.features.modelManagement
  const owns = t('workbench.team.owns.' + (assets && keys ? 'all' : keys ? 'noAssets' : assets ? 'noKeys' : 'canvases'))
  return n ? t('workbench.team.headline', { role, n, owns }) : t('workbench.team.headlineNoCount', { role, owns })
})

/* ===== 本月：用量和上限是同一份数字 ===== */
const limits = computed(() => detail.value?.limits || null)
/** 看得到全队数字的人（团长，和团长放开了的管理员）看团队的；其余看自己的 */
const side = computed<LimitSideData | null>(() => limits.value?.team || limits.value?.member || null)
const own = computed(() => !!limits.value && !limits.value.team)
/** 团队同时在跑的运行数上限（所有成员共用一份）；老服务端不给时不写 */
const cap = computed(() => Number(detail.value?.concurrency) || 0)
/** 状态是服务端给的（effective.state）；两项都没设上限时说「未设上限」 */
const stateTag = computed(() => {
  const st = side.value?.effective.state
  return st === 'unlimited' ? t('workbench.team.noLimit') : st ? stateLabel(st) : ''
})

/* 本月运行里图片、视频、对话各几次：同一个口径（counted = 已成功 + 进行中），取不到就不写这一行 */
const kinds = ref<Partial<Record<ModelKind, number>>>({})
const KINDS: ModelKind[] = ['image', 'video', 'chat']
async function loadKinds() {
  const lim = limits.value
  if (!lim) { kinds.value = {}; return }
  try {
    const q = { from: `${lim.month}-01`, groupBy: 'model' as const, tz: lim.timezone }
    const rows = await Promise.all(KINDS.map((kind) => adminApi.usage({ ...q, kind })))
    kinds.value = Object.fromEntries(KINDS.map((k, i) => [k, unwrap(rows[i])?.totals?.counted?.runs ?? 0]))
  } catch {
    kinds.value = {}
  }
}
const kindsText = computed(() => {
  const k = kinds.value
  if (k.image == null) return ''
  return t('workbench.team.kinds', { image: formatInt(k.image || 0), video: formatInt(k.video || 0), chat: formatInt(k.chat || 0) })
})

/* ===== 三步引导 ===== */
const steps = computed(() => {
  const o = detail.value?.onboarding
  if (!o) return []
  const manageProviders = space.can('provider:manage')
  const invite = space.can('invite:manage')
  // 集成方关了模型管理 / 团队管理（服务商、成员由宿主自己管）：那一步在这里做不了，也就不是这里的一步
  const all = [
    {
      key: 'provider', done: o.hasProvider,
      title: t('workbench.team.onboarding.provider'),
      hint: manageProviders ? t('workbench.team.onboarding.providerHint') : t('workbench.team.onboarding.providerWait'),
      action: t('workbench.team.onboarding.providerGo'),
      to: manageProviders ? teamTo('models') : null,
    },
    {
      key: 'members', done: o.hasMembers,
      title: t('workbench.team.onboarding.members'),
      hint: invite ? t('workbench.team.onboarding.membersHint') : t('workbench.team.onboarding.membersWait'),
      action: t('workbench.team.onboarding.membersGo'),
      to: invite ? teamTo('team', { tab: 'members' }) : null,
    },
    {
      key: 'canvas', done: o.hasCanvas,
      title: t('workbench.team.onboarding.canvas'),
      hint: t('workbench.team.onboarding.canvasHint'),
      action: t('workbench.newCanvas'),
      to: null,
    },
  ]
  const list = all.filter((s) => (s.key === 'provider' ? isPageOpen(embed, 'models') : s.key === 'members' ? isPageOpen(embed, 'team') : true))
  return list.every((s) => s.done) ? [] : list
})

/** 重取一遍（quiet：不闪骨架）。队列跑空之后首页会来叫一次：用量和上限的数字都变了 */
async function reload(quiet = false) {
  await loadDetail(quiet)
  await loadKinds()
}
defineExpose({ reload })

onMounted(() => reload())
</script>

<style scoped>
.to-head { align-items: center; }
.to-title { min-width: 0; flex: 1 1 280px; }
.to-title h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.to-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.to-btn { height: 40px; padding: 0 18px; text-decoration: none; }

.to-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 24px; }
.to-tile { padding: 16px 20px; min-width: 0; min-height: 120px; display: flex; flex-direction: column; }
.to-tile h2 { display: flex; align-items: center; gap: 8px; font: 400 13px/1.4 var(--f-body); color: var(--text-2); }
.to-tile h2 .lc-ic { color: var(--text-3); }
.to-num { display: block; margin-top: 10px; font: 600 28px/1.2 var(--f-disp); color: var(--text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.to-num.unk { font-size: 22px; line-height: 34px; color: var(--text-2); }
.to-num.dash { color: var(--text-3); }
.to-tile small { display: block; margin-top: 8px; font-size: 12px; line-height: 1.5; color: var(--text-3); }
.to-tile small.warn { color: var(--warn); }
.to-tile small.err { color: var(--err-soft); }
.to-limit { margin-top: 16px; padding: 16px 20px 18px; }
.to-limit header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.to-limit h2 { flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font: 400 13px/1.4 var(--f-body); color: var(--text-2); }
.to-limit h2 .lc-ic { color: var(--text-3); }
.to-month { color: var(--text-3); }
.to-month::before { content: '·'; margin-right: 8px; }
.to-limit .lc-tag { flex: none; }
.to-none { color: var(--text-3); font-size: 13px; }
.to-err { margin-top: 12px; display: grid; gap: 8px; justify-items: start; font-size: 13px; color: var(--text-3); }

.to-skel { display: block; height: 12px; width: 70%; margin-top: 12px; border-radius: 6px; background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }
.to-skel.big { height: 28px; width: 45%; margin-top: 12px; }
.to-skel.short { width: 40%; }

/* 三步引导 */
.to-onb { margin-top: 16px; padding: 18px 20px; }
.to-onb h2 { font: 600 15px/1.4 var(--f-disp); color: var(--text); }
.to-onb ol { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.to-onb li {
  display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 14px; border-radius: var(--r-md);
  border: 1px solid var(--line); background: rgb(var(--c-film) / .04);
}
.to-step-n {
  flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  font: 600 13px var(--f-disp); color: var(--text-2); box-shadow: 0 0 0 1px var(--line-3) inset;
}
.to-onb li.done .to-step-n { color: var(--ok); background: var(--success-dim); box-shadow: none; }
.to-step-t { flex: 1; min-width: 0; }
.to-step-t b { display: block; font-weight: 600; font-size: 13px; color: var(--text); }
.to-step-t small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.5; color: var(--text-3); }
.to-onb li.done .to-step-t b { color: var(--text-2); }
.to-onb li .lc-btn { flex: none; text-decoration: none; }
/* 「已完成」只念给读屏听：看得见的人有那个勾 */
.to-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@media (max-width: 900px) {
  .to-onb ol { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 600px) {
  .to-actions { width: 100%; }
  .to-btn { flex: 1 1 auto; justify-content: center; }
  .to-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .to-tile { padding: 14px 16px; min-height: 0; }
  /* 三块里落单的那一块铺满，不留半行空白 */
  .to-tile:last-child:nth-child(odd) { grid-column: 1 / -1; }
  .to-limit { padding: 14px 16px 16px; }
  .to-num { font-size: 24px; }
  /* 英文带货币代码的金额（≈ CN¥1,234.56）在半宽的格子里一行放不下 24px：小一号，不拆成两行 */
  .to-num.money { font-size: 20px; line-height: 29px; overflow-wrap: normal; }
}
</style>
