<template>
  <div class="us">
    <div class="lc-fbar us-bar">
      <div class="us-month">
        <LcSelect v-model="month" :options="monthOptions" size="sm" :aria-label="t('team.usage.month')" />
      </div>
      <div class="lc-seg" role="group" :aria-label="t('team.usage.groupBy')">
        <button
          v-for="g in groups" :key="g" type="button" :class="{ on: groupBy === g }" :aria-pressed="groupBy === g" :data-group="g"
          @click="groupBy = g"
        >{{ t('team.usage.by.' + g) }}</button>
      </div>
      <span class="lc-sp" />
      <button class="lc-btn" type="button" :disabled="!items.length" data-act="export" @click="exportCsv">
        <LcIcon name="download" />{{ t('team.usage.export') }}
      </button>
    </div>

    <div v-if="scope === 'own'" class="lc-alert info us-own" data-testid="usage-own">
      <LcIcon name="info" />
      <span>{{ t(space.role === 'admin' ? 'team.usage.ownAdmin' : 'team.usage.ownMember') }}</span>
    </div>

    <div v-if="error" class="lc-alert us-error" role="alert">
      <LcIcon name="warn" />
      <span>{{ error }}</span>
      <button class="lc-btn sm" type="button" @click="load">{{ t('common.retry') }}</button>
    </div>

    <!--
      本月上限：永远是「本月」的（上限按团队时区的自然月计），不跟着上面选的月份走。
      看得到全队的是团队的，其余是自己的。
    -->
    <section v-if="side && limits" class="lc-card us-limit" data-block="limits" :data-state="side.effective.state">
      <header>
        <h2>{{ limits.team ? t('spaces.limits.team') : t('spaces.limits.mine') }}<span class="us-limit-m">{{ monthText(limits.month) }}</span></h2>
        <span class="lc-tag" :class="{ warn: side.effective.state === 'near', err: side.effective.state === 'reached' }" data-testid="limit-state">{{ stateTag }}</span>
      </header>
      <LimitSide split :side="side" :currency="limits.currency" :resets-at="limits.resetsAt" :timezone="limits.timezone" :member="!limits.team" />
    </section>

    <!-- 下面是所选月份的用量。看的不是本月时说一声：上面那一块仍然是本月的 -->
    <div class="us-range" data-block="range">
      <h2>{{ t('team.usage.rangeTitle', { month: monthLabel(shownMonth) }) }}</h2>
      <p>{{ t('team.usage.definition') }}</p>
    </div>
    <div v-if="limits && shownMonth !== limits.month" class="lc-alert info us-other" data-testid="usage-other-month">
      <LcIcon name="info" />
      <span>{{ t('team.usage.otherMonth', { shown: monthLabel(shownMonth), now: monthText(limits.month) }) }}</span>
    </div>

    <div class="us-tiles" :class="{ dim: loading, 'no-cost': !$feat.cost }">
      <div class="lc-card us-tile" data-tile="counted">
        <span><LcIcon name="bolt" size="s" />{{ t('team.usage.tiles.counted') }}</span>
        <b>{{ totals ? formatInt(countedOf(totals)) : '—' }}<i>{{ t('team.usage.times') }}</i></b>
        <small>{{ totals ? t('team.usage.tiles.countedNote', { ok: formatInt(totals.succeeded || 0), going: formatInt(totals.inProgress || 0) }) : '' }}</small>
        <small v-if="kindsNote">{{ kindsNote }}</small>
      </div>
      <div class="lc-card us-tile" data-tile="notCounted">
        <span><LcIcon name="x" size="s" />{{ t('team.usage.tiles.notCounted') }}</span>
        <b>{{ totals ? formatInt((totals.failed || 0) + (totals.canceled || 0)) : '—' }}<i>{{ t('team.usage.times') }}</i></b>
        <small>{{ totals ? t('team.usage.tiles.notCountedNote', { failed: formatInt(totals.failed || 0), canceled: formatInt(totals.canceled || 0) }) : '' }}</small>
        <small v-if="rate">{{ t('team.usage.tiles.rate', { rate }) }}</small>
      </div>
      <!-- 金额相关的两块、表里的两列、导出的四列：集成方关了成本显示（features.cost）就都不出 -->
      <div v-if="$feat.cost" class="lc-card us-tile" data-tile="cost">
        <span><LcIcon name="key" size="s" />{{ t('team.usage.tiles.cost') }}</span>
        <b>{{ totals ? amountOf(totals) : '—' }}</b>
        <small>{{ totals && heldOf(totals) ? t('team.usage.tiles.costHeld', { held: heldOf(totals) }) : t('team.usage.tiles.costNote') }}</small>
      </div>
      <div v-if="$feat.cost" class="lc-card us-tile" data-tile="unknown">
        <span><LcIcon name="warn" size="s" />{{ t('team.usage.tiles.unknown') }}</span>
        <b>{{ totals ? formatInt(totals.unknownCount || 0) : '—' }}<i>{{ t('team.usage.times') }}</i></b>
        <small>{{ unknownNote }}</small>
      </div>
    </div>

    <div class="lc-card us-card">
      <div v-if="loading && !loaded" class="us-sk" aria-busy="true"><i v-for="n in 4" :key="n" /></div>
      <div v-else-if="!items.length" class="lc-empty">{{ error ? t('common.loadFailed') : t('team.usage.empty', { month: monthLabel(month) }) }}</div>
      <div v-else class="lc-table-wrap" :class="{ dim: loading }">
        <table class="lc-table us-table">
          <thead>
            <tr>
              <th rowspan="2">{{ t('team.usage.col.' + shownBy) }}</th>
              <th colspan="3" class="grp">{{ t('team.usage.col.groupCounted') }}</th>
              <th colspan="2" class="grp off">{{ t('team.usage.col.groupNot') }}</th>
              <th v-if="$feat.cost" rowspan="2" class="num">{{ t('team.usage.col.cost') }}</th>
              <th v-if="$feat.cost" rowspan="2" class="num">{{ t('team.usage.col.unknown') }}</th>
              <th v-if="showLimit" rowspan="2" class="c-share">{{ t('team.usage.col.limit') }}</th>
            </tr>
            <tr class="sub">
              <th class="num strong">{{ t('team.usage.col.counted') }}</th>
              <th class="num">{{ t('team.usage.col.succeeded') }}</th>
              <th class="num">{{ t('team.usage.col.inProgress') }}</th>
              <th class="num off">{{ t('team.usage.col.failed') }}</th>
              <th class="num off">{{ t('team.usage.col.canceled') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in items" :key="r.key" :data-row="r.member?.username || r.key">
              <td>
                <!-- 点成员去看他的生成记录；这次挂载里没有生成记录那一页（集成方没开放）时只是一行字，不是一颗点了没反应的按钮 -->
                <button v-if="shownBy === 'member' && pages.has('history')" class="us-who" type="button" v-tip="t('team.usage.openHistory', { name: nameOf(r) })" @click="openHistory(r)">
                  <SpaceAvatar :name="nameOf(r)" :seed="r.key" shape="round" :size="28" />
                  <span class="us-who-t">
                    <b><PersonName :person="memberOf(r)" /></b>
                    <small v-if="r.member?.username" class="lc-mono">@{{ r.member.username }}</small>
                  </span>
                </button>
                <div v-else-if="shownBy === 'member'" class="us-who plain">
                  <SpaceAvatar :name="nameOf(r)" :seed="r.key" shape="round" :size="28" />
                  <span class="us-who-t">
                    <b><PersonName :person="memberOf(r)" /></b>
                    <small v-if="r.member?.username" class="lc-mono">@{{ r.member.username }}</small>
                  </span>
                </div>
                <span v-else class="us-key" :class="{ 'lc-mono': shownBy === 'day' }">{{ shownBy === 'model' ? r.label || r.key : r.key }}</span>
              </td>
              <td class="num strong" data-col="counted">{{ formatInt(countedOf(r)) }}</td>
              <td class="num">{{ formatInt(r.succeeded || 0) }}</td>
              <td class="num">{{ dash(r.inProgress) }}</td>
              <td class="num off">{{ dash(r.failed) }}</td>
              <td class="num off">{{ dash(r.canceled) }}</td>
              <td v-if="$feat.cost" class="num strong" data-col="cost">{{ amountOf(r) }}</td>
              <td v-if="$feat.cost" class="num">{{ r.unknownCount ? t('spaces.limits.runs', { n: formatInt(r.unknownCount) }) : '—' }}</td>
              <td v-if="showLimit" class="c-share">
                <MemberLimitCell :effective="effectiveOf(r)" :currency="limits?.currency" />
              </td>
            </tr>
          </tbody>
          <tfoot v-if="totals">
            <tr>
              <td>{{ t('team.usage.total') }}</td>
              <td class="num strong" data-col="counted">{{ formatInt(countedOf(totals)) }}</td>
              <td class="num">{{ formatInt(totals.succeeded || 0) }}</td>
              <td class="num">{{ dash(totals.inProgress) }}</td>
              <td class="num off">{{ dash(totals.failed) }}</td>
              <td class="num off">{{ dash(totals.canceled) }}</td>
              <td v-if="$feat.cost" class="num strong" data-col="cost">{{ amountOf(totals) }}</td>
              <td v-if="$feat.cost" class="num">{{ totals.unknownCount ? t('spaces.limits.runs', { n: formatInt(totals.unknownCount) }) : '—' }}</td>
              <td v-if="showLimit" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- 有模型的钱算不进金额上限：后果是服务端给的（unpriced.effect），这里只管说 -->
    <div v-if="$feat.cost && uncountable.length && unpricedEffect !== 'none'" class="lc-alert warn us-unpriced" data-testid="usage-uncountable" :data-effect="unpricedEffect">
      <LcIcon name="warn" />
      <span>
        {{ t(unpricedEffect === 'refused' ? (limits?.unpriced?.blocked === 'some' ? 'team.usage.uncountableBlockedSome' : 'team.usage.uncountableBlocked') : 'team.usage.uncountableOpen', { n: uncountable.length, models: uncountableNames, currency: limits?.currency || '' }) }}
        <router-link :to="{ name: 'models' }">{{ t('team.goPrices') }}</router-link>
      </span>
    </div>

    <div v-if="$feat.cost" class="lc-alert info us-foot">
      <LcIcon name="key" />
      <span>{{ t('team.usage.footNote') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 用量页签：某一个月的用量，按成员 / 按模型 / 按天分。月份按团队时区的自然月（接口默认就是团队时区）。
 * 能看全队的（团长，或团长允许了的管理员）看到全队的；其余人只有自己的，也就没有「按成员」。
 *
 * 数字的口径全页只有一个，和每月上限用的是同一个（服务端 services/budget.js）：
 *   计入上限 = 已成功 + 进行中；失败、取消的另列两栏并写明不计入；
 *   预估金额 = 已成功的金额 + 进行中的运行占着的金额；没有价格的运行单独计数，不当成 0。
 * 「本月上限」那一块永远是本月的；表格看的是别的月份时，中间有一行说明。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { teamApi, unwrap } from '@/utils/api'
import { formatMoney } from '@/utils/cost'
import { useEmbed } from '@/embed/context'
import { usePageOpen } from '@/embed/links'
import { useSpaceStore } from '@/stores/space'
import { formatInt } from '@/components/space/format'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import LimitSide from '@/components/space/LimitSide.vue'
import MemberLimitCell from '@/components/space/MemberLimitCell.vue'
import { monthText, stateLabel } from '@/utils/budget'
import PersonName from '@/components/PersonName.vue'
import { personName, personTitle } from '@/utils/person'
import { useTeamPage } from './context'
import type { LimitEffective, ModelKind, Person, TeamLimits, UsageSummaryRow } from '@/types'

type GroupBy = 'member' | 'model' | 'day'

const { t, locale } = useI18n()
const router = useRouter()
const space = useSpaceStore()
const page = useTeamPage()

const seeAll = computed(() => space.can('usage:view_all'))
const groups = computed<GroupBy[]>(() => (scope.value === 'all' ? ['member', 'model', 'day'] : ['model', 'day']))
const groupBy = ref<GroupBy>(seeAll.value ? 'member' : 'model')

// ---- 月份：团队时区里的这个月，往前 12 个 ----
const pad = (n: number) => String(n).padStart(2, '0')
function teamMonthNow(): string {
  const known = page.detail.value?.limits?.month
  if (known && /^\d{4}-\d{2}$/.test(known)) return known
  const tz = page.detail.value?.timezone
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: 'numeric' }).formatToParts(new Date())
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value)
    return `${get('year')}-${pad(get('month'))}`
  } catch {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  }
}
const thisMonth = teamMonthNow()
const month = ref(thisMonth)
function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  try { return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1))) } catch { return key }
}
const monthOptions = computed(() => {
  const [y, m] = thisMonth.split('-').map(Number)
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
    return { value: key, label: monthLabel(key) }
  })
})
function rangeOf(key: string) {
  const [y, m] = key.split('-').map(Number)
  return { from: `${key}-01`, to: `${key}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` }
}

// ---- 数据 ----
const items = ref<UsageSummaryRow[]>([])
const totals = ref<UsageSummaryRow | null>(null)
const scope = ref<'all' | 'own'>(seeAll.value ? 'all' : 'own')
/** 表格现在画的是哪一种分法（请求回来之前不跟着按钮变，免得表头和数据对不上） */
const shownBy = ref<GroupBy>(groupBy.value)
const shownMonth = ref(month.value)
const byKind = ref<Partial<Record<ModelKind, number>>>({})
const limits = ref<TeamLimits | null>(page.detail.value?.limits || null)
const loading = ref(true)
const loaded = ref(false)
const error = ref('')

const KINDS: ModelKind[] = ['image', 'video', 'chat']
let seq = 0

async function load() {
  const mine = ++seq
  const g = groupBy.value
  const m = month.value
  loading.value = true
  error.value = ''
  try {
    const range = rangeOf(m)
    const [main, kinds] = await Promise.all([
      teamApi.usage(page.teamId, { groupBy: g, ...range }).then(unwrap),
      Promise.all(KINDS.map((kind) => teamApi.usage(page.teamId, { groupBy: 'day', kind, ...range }).then(unwrap))),
    ])
    if (mine !== seq) return
    scope.value = main.scope === 'own' ? 'own' : 'all'
    // 以为能看全队，其实只能看自己的（团长刚关了「管理员可以查看全队」）：没有按成员这一种
    if (scope.value === 'own' && g === 'member') { groupBy.value = 'model'; return }
    items.value = main.items
    totals.value = main.totals || null
    shownBy.value = g
    shownMonth.value = m
    byKind.value = Object.fromEntries(KINDS.map((k, i) => [k, kinds[i].totals ? countedOf(kinds[i].totals!) : 0]))
    loaded.value = true
  } catch (err) {
    if (mine !== seq) return
    error.value = page.explain(err, t('common.loadFailed'))
  } finally {
    if (mine === seq) loading.value = false
  }
}
/** 本月上限（看得到全队的还带每个成员的那一份：表格最后一列用）。每次重取用量都跟着取：两边是同一时刻的数 */
async function loadSide() {
  try { limits.value = unwrap(await teamApi.limits(page.teamId, seeAll.value)) } catch { /* 上限那一块读不到就不画，表格照常 */ }
}
onMounted(() => { void load(); void loadSide() })
watch([groupBy, month], () => { void load(); void loadSide() })

// ---- 数字怎么写 ----
/** 集成方关了成本显示（features.cost）：金额那几列屏幕上不出，导出的表里也不出 */
const costOn = useEmbed().features.cost
const pages = usePageOpen()
const dash = (n?: number) => (n ? formatInt(n) : '—')
/** 计入上限的次数 = 已成功 + 进行中（服务端给的 counted；老服务端没有就自己加） */
const countedOf = (r: UsageSummaryRow) => r.counted?.runs ?? (r.succeeded || 0) + (r.inProgress || 0)
const moneyList = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
/** 预估金额 = 已成功的 + 进行中的运行占着的，按币种各算各的 */
function amountOf(r: UsageSummaryRow): string {
  const sum: Record<string, number> = { ...(r.costs || {}) }
  for (const [cur, v] of Object.entries(r.reserved || {})) sum[cur] = Math.round(((sum[cur] || 0) + v) * 1e6) / 1e6
  const list = moneyList(sum)
  if (!list.length) return '—'
  return list.map(([cur, v]) => t('cost.approx', { amount: formatMoney(v, cur) })).join(' + ')
}
/** 其中进行中的运行占着多少；没有返回空串 */
function heldOf(r: UsageSummaryRow): string {
  return moneyList(r.reserved || {}).map(([cur, v]) => formatMoney(v, cur)).join(' + ')
}
/** 跑完的里面成功的占比（进行中的还没有结果，不算）；没有跑完的返回空串 */
const rate = computed(() => {
  const s = totals.value?.succeeded || 0
  const f = totals.value?.failed || 0
  if (!totals.value || s + f === 0) return ''
  return (Math.round((s / (s + f)) * 1000) / 10).toFixed(1) + '%'
})
const kindsNote = computed(() => {
  if (!totals.value) return ''
  return KINDS.filter((k) => byKind.value[k]).map((k) => t('team.usage.kinds.' + k, { n: formatInt(byKind.value[k] || 0) })).join(' · ')
})
const uncountable = computed(() => limits.value?.uncountable || [])
const uncountableNames = computed(() => uncountable.value.map((m) => m.label || m.id).join(t('team.listSep')))
/** 这些模型现在意味着什么：refused 被拦 / runs_only 只计次数 / none 没有金额上限，无所谓 */
const unpricedEffect = computed(() => limits.value?.unpriced?.effect || 'none')
const unknownNote = computed(() => {
  const n = uncountable.value.filter((m) => m.reason === 'unpriced').length
  return n ? t('team.usage.tiles.unknownModels', { n }) : t('team.usage.tiles.unknownNote')
})

const side = computed(() => limits.value?.team || limits.value?.member || null)
const stateTag = computed(() => {
  const st = side.value?.effective.state
  return st === 'unlimited' ? t('spaces.limits.noneSet') : st ? stateLabel(st) : ''
})

// ---- 本月上限那一列：只有看的是本月才有意义（上限是本月的），每个成员的状态是服务端给的 ----
const showLimit = computed(() => shownBy.value === 'member' && shownMonth.value === limits.value?.month && !!limits.value?.members?.length)
function effectiveOf(r: UsageSummaryRow): LimitEffective | null {
  // 已经不在团队里的人没有上限
  return limits.value?.members?.find((x) => x.id === r.key)?.effective || null
}

/** 这一行是谁（老服务端只有 label）。已离开 / 账号已删除的人名字照旧，后面带标签 */
const memberOf = (r: UsageSummaryRow): Partial<Person> => r.member || { name: r.label || '' }
const nameOf = (r: UsageSummaryRow) => personName(memberOf(r))
function openHistory(r: UsageSummaryRow) {
  router.push({ name: 'history', query: { member: r.key } })
}

// ---- 导出：就是屏幕上这张表 ----
function exportCsv() {
  const by = shownBy.value
  const head = [
    ...(by === 'member' ? [t('team.col.member'), t('team.usage.csv.username')] : [t('team.usage.col.' + by)]),
    t('team.usage.csv.counted'), t('team.usage.col.succeeded'), t('team.usage.col.inProgress'),
    t('team.usage.csv.failed'), t('team.usage.csv.canceled'),
    ...(costOn ? [t('team.usage.col.cost'), t('team.usage.csv.currency'), t('team.usage.csv.held'), t('team.usage.col.unknown')] : []),
  ]
  const money = (r: UsageSummaryRow) => {
    const sum: Record<string, number> = { ...(r.costs || {}) }
    for (const [cur, v] of Object.entries(r.reserved || {})) sum[cur] = Math.round(((sum[cur] || 0) + v) * 1e6) / 1e6
    const list = Object.entries(sum).sort((a, b) => b[1] - a[1])
    return [list.map(([, v]) => String(v)).join(' + '), list.map(([c]) => c).join(' + '), list.map(([c]) => String(r.reserved?.[c] || 0)).join(' + ')]
  }
  const line = (first: string[], r: UsageSummaryRow) => [...first, countedOf(r), r.succeeded || 0, r.inProgress || 0, r.failed || 0, r.canceled || 0, ...(costOn ? [...money(r), r.unknownCount || 0] : [])]
  const rows: (string | number)[][] = [head]
  for (const r of items.value) {
    rows.push(line(by === 'member' ? [personTitle(memberOf(r)), r.member?.username || ''] : [by === 'model' ? r.label || r.key : r.key], r))
  }
  if (totals.value) rows.push(line(by === 'member' ? [t('team.usage.total'), ''] : [t('team.usage.total')], totals.value))
  const cell = (v: string | number) => {
    let s = String(v ?? '')
    // 表格软件会把 = + - @ 开头的格子当公式
    if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
  const safe = (space.name || 'team').replace(/[\\/:*?"<>|\s]+/g, '-')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `${safe}-usage-${shownMonth.value}-${by}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
</script>

<style scoped>
.us-bar { gap: 12px; margin-bottom: 16px; }
.us-month { width: 168px; flex: none; }
.us-own, .us-error { margin-bottom: 16px; }
.us-error { align-items: center; }
.us-error span { flex: 1; min-width: 0; }
.us-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
/* 没有金额那两块时剩两块：排满一行，不留半边空着 */
.us-tiles.no-cost { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.us-tile { padding: 18px 20px; display: grid; gap: 4px; min-width: 0; align-content: start; }
.us-tile > span { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 13px; }
.us-tile > span :deep(svg) { color: var(--text-3); }
.us-tile > b { font: 600 28px/1.25 var(--f-disp); color: var(--text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.us-tile > b i { font: 400 13px var(--f-body); color: var(--text-3); margin-left: 6px; }
.us-tile > small { color: var(--text-3); font-size: 12px; line-height: 1.5; min-height: 18px; }
.dim { opacity: .6; transition: opacity .15s; }

.us-limit { padding: 18px 20px 20px; }
.us-limit header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.us-limit h2 { font: 600 15px/1.5 var(--f-disp); color: var(--text); flex: 1 1 auto; min-width: 0; }
.us-limit-m { margin-left: 10px; font: 400 13px var(--f-body); color: var(--text-3); }
.us-limit .lc-tag { flex: none; }
.us-range { margin: 28px 0 12px; display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 16px; }
.us-range h2 { font: 600 15px/1.5 var(--f-disp); color: var(--text); }
.us-range p { color: var(--text-3); font-size: 12px; line-height: 1.6; }
.us-other { margin-bottom: 16px; }

.us-card { margin-top: 16px; overflow: hidden; }
.us-table th { padding-top: 12px; padding-bottom: 12px; }
.us-table th:first-child, .us-table td:first-child { padding-left: 20px; }
.us-table th:last-child, .us-table td:last-child { padding-right: 20px; }
.us-table th.num { text-align: right; font-family: var(--f-body); }
.us-table thead th { vertical-align: bottom; }
.us-table th.grp { text-align: center; padding-bottom: 4px; color: var(--text-2); border-bottom: 1px solid var(--line); }
.us-table th.grp.off, .us-table th.off { color: var(--text-3); }
.us-table tr.sub th { padding-top: 6px; padding-left: 12px; padding-right: 12px; }
.us-table tr.sub th:first-child { padding-left: 12px; }
.us-table tr.sub th:last-child { padding-right: 12px; }
.us-table td.off { color: var(--text-3); }
.us-table th.strong { color: var(--text); }
.us-table td { white-space: nowrap; }
.us-table td.strong { color: var(--text); }
.us-table tfoot td { color: var(--text); font-weight: 600; border-top: 1px solid var(--line-2); }
.us-key { color: var(--text); }
.us-who {
  display: inline-flex; align-items: center; gap: 10px; min-width: 0; padding: 2px 6px 2px 2px; margin: -2px -6px -2px -2px;
  border: 0; background: none; text-align: left; border-radius: 8px; color: inherit; cursor: pointer;
}
.us-who:hover b { color: var(--cyan-soft); }
.us-who.plain { cursor: default; }
.us-who.plain:hover b { color: var(--text); }
.us-who:focus-visible { outline: none; box-shadow: var(--ring); }
.us-who-t { display: grid; min-width: 0; line-height: 1.35; }
.us-who-t b { color: var(--text); font-weight: 500; font-size: 14px; transition: color .15s; }
.us-who-t small { color: var(--text-3); font-size: 11px; }
.us-who-t b :deep(.pn) { display: flex; }
.c-share { width: 24%; min-width: 250px; padding-left: 20px !important; }
.us-sk { display: grid; gap: 22px; padding: 24px 20px; }
.us-sk i { display: block; height: 16px; border-radius: 6px; background: rgb(var(--c-film) / .1); animation: lc-pulse 1.6s ease-in-out infinite; }
.us-sk i:nth-child(odd) { width: 70%; } .us-sk i:nth-child(even) { width: 52%; }
.us-unpriced, .us-foot { margin-top: 16px; }
.us-foot > :deep(svg) { color: var(--cyan); }

/* 九栏的表在窄一点的屏上放不下整根条：最后一栏只留数字和状态标签（颜色照旧跟状态走） */
@media (max-width: 1280px) {
  .c-share { width: auto; min-width: 0; padding-left: 12px !important; }
  .c-share :deep(.lb-track) { display: none; }
  .us-table th, .us-table td { padding-left: 10px; padding-right: 10px; }
}
@media (max-width: 1100px) { .us-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .us-tiles { gap: 12px; }
  .us-tile { padding: 14px 16px; }
  .us-tile > b { font-size: 22px; }
  .us-month { flex: 1 1 140px; width: auto; }
  .us-bar > .lc-sp { display: none; }
  .us-bar > .lc-btn { flex: 1 1 100%; }
  .us-table th:first-child, .us-table td:first-child { padding-left: 16px; }
  .us-table th:last-child, .us-table td:last-child { padding-right: 16px; }
}
</style>
