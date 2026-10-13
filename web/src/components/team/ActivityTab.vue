<template>
  <div class="ac">
    <div class="lc-fbar ac-bar">
      <t-date-range-picker
        v-model="range"
        class="lc-date ac-range"
        value-type="YYYY-MM-DD"
        format="YYYY-MM-DD"
        allow-input
        :clearable="false"
        :placeholder="[t('team.activity.from'), t('team.activity.to')]"
        :presets="rangePresets"
        :popup-props="DATE_POPUP"
      />
      <div class="ac-sel">
        <LcSelect v-model="category" :options="categoryOptions" size="sm" :aria-label="t('team.activity.category')" />
      </div>
      <div class="ac-sel">
        <LcSelect v-model="actor" :options="actorOptions" :searchable="actorOptions.length > 9" size="sm" :aria-label="t('team.activity.actor')" />
      </div>
      <p class="ac-note">{{ t('team.activity.note') }}</p>
    </div>

    <div v-if="error" class="lc-alert ac-error" role="alert">
      <LcIcon name="warn" />
      <span>{{ error }}</span>
      <button class="lc-btn sm" type="button" @click="reload">{{ t('common.retry') }}</button>
    </div>

    <div class="lc-card ac-card" :class="{ dim: loading && list.length > 0 }">
      <div v-if="loading && !list.length" class="ac-sk" aria-busy="true"><i v-for="n in 6" :key="n" /></div>
      <div v-else-if="!list.length" class="lc-empty">
        <p>{{ error ? t('common.loadFailed') : t(filtered ? 'team.activity.emptyFiltered' : 'team.activity.empty') }}</p>
        <button v-if="filtered && !error" class="lc-btn sm ac-reset" type="button" @click="resetFilters">{{ t('team.activity.reset') }}</button>
      </div>
      <template v-else>
        <section v-for="day in days" :key="day.key" class="ac-day">
          <h3>{{ day.label }}</h3>
          <ul>
            <li v-for="e in day.items" :key="e.id" class="ac-row" :data-type="e.type">
              <time class="lc-mono" :datetime="e.createdAt" v-tip="formatDateTime(e.createdAt)">{{ formatClock(e.createdAt) }}</time>
              <span v-if="e.actor.system" class="ac-who sys" v-tip="t('team.activity.log.siteAdminTip')" data-actor="system">
                <span class="ac-sys" aria-hidden="true"><LcIcon name="shield" size="s" /></span>
                <b>{{ actorName(e) }}</b>
              </span>
              <span v-else class="ac-who" :data-actor="e.actor.state || 'active'">
                <PersonName :person="e.actor" :avatar="22" stack />
              </span>
              <span class="ac-msg" :data-fallback="lineOf(e).fallback || undefined">
                <span class="ac-text">{{ lineOf(e).text }}</span>
                <span v-if="lineOf(e).changes.length || lineOf(e).notes.length" class="ac-facts">
                  <span v-for="(c, i) in lineOf(e).changes" :key="'c' + i" class="ac-change">
                    <i>{{ c.label }}</i><s>{{ c.from }}</s><LcIcon name="arrow" size="s" aria-hidden="true" /><span class="ac-sr">→</span><b>{{ c.to }}</b>
                  </span>
                  <span v-for="(n, i) in lineOf(e).notes" :key="'n' + i" class="ac-fact">{{ n }}</span>
                </span>
              </span>
              <span class="ac-end">
                <button
                  v-if="restorable(e)" class="lc-btn sm" type="button" :disabled="restoring === e.id" data-act="restore"
                  @click="restore(e)"
                >{{ restoring === e.id ? t('team.activity.restoring') : t('team.activity.restore') }}</button>
                <span class="lc-tag">{{ categoryLabel(e.category) }}</span>
              </span>
            </li>
          </ul>
        </section>
        <div class="lc-pager ac-more">
          <span>{{ t('team.activity.shown', { n: list.length, total }) }}</span>
          <span class="lc-sp" />
          <button v-if="list.length < total" class="lc-btn sm" type="button" :disabled="loading" data-act="more" @click="more">
            {{ loading ? t('common.loading') : t('team.activity.more') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 动态页签（团长、管理员）：团队里的管理操作，新的在前，按天分组。只读。
 * 每条的那句话在前端写（./activityText.ts）：人名是此刻的名字、带着已离开团队 / 账号已删除的标记，
 * 改了数值的写出「改之前 → 改之后」；不认识的类型用服务端按当前语言写好的那句。
 * 被删的画布还在 30 天内时，这里可以直接恢复。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamApi, workflowApi, unwrap, apiErrorCode } from '@/utils/api'
import { MessagePlugin } from '@/utils/feedback'
import { useSpaceStore } from '@/stores/space'
import { formatClock, formatDateTime, browserZone } from '@/components/space/format'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import PersonName from '@/components/PersonName.vue'
import { actorName, describeActivity, type ActivityLine } from './activityText'
import { personTitle } from '@/utils/person'
import { useTeamPage } from './context'
import type { TeamActivityItem, TeamMember } from '@/types'

const { t, te, locale } = useI18n()
const space = useSpaceStore()
const page = useTeamPage()

const PAGE_SIZE = 50
/** 日历弹层挂在 body 上，靠这个类名套用整站的配色（见 base.css） */
const DATE_POPUP = { overlayClassName: 'lc-date-popup' }

// ---- 筛选 ----
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date()
const todayText = iso(today)
const daysAgo = (n: number) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n))
const DEFAULT_FROM = daysAgo(29)

const from = ref(DEFAULT_FROM)
const to = ref(todayText)
const category = ref('')
const actor = ref('')

const range = computed<string[]>({
  get: () => [from.value, to.value],
  set: (v) => {
    const [a, b] = v || []
    if (!a || !b) return
    ;[from.value, to.value] = a <= b ? [a, b] : [b, a]
  },
})
const rangePresets = computed<Record<string, [string, string]>>(() => ({
  [t('team.activity.last7')]: [daysAgo(6), todayText],
  [t('team.activity.last30')]: [DEFAULT_FROM, todayText],
  [t('team.activity.last365')]: [daysAgo(364), todayText],
}))
const filtered = computed(() => !!(category.value || actor.value || from.value !== DEFAULT_FROM || to.value !== todayText))
function resetFilters() {
  from.value = DEFAULT_FROM
  to.value = todayText
  category.value = ''
  actor.value = ''
}

const categories = ref<string[]>([])
const categoryLabel = (c: string) => (te('team.activity.categories.' + c) ? t('team.activity.categories.' + c) : c)
const categoryOptions = computed(() => [
  { value: '', label: t('team.activity.categoryAll') },
  ...categories.value.map((c) => ({ value: c, label: t('team.activity.categoryIs', { name: categoryLabel(c) }) })),
])
const members = ref<TeamMember[]>([])
/** 成员筛选：现在的成员，加上这一页里出现过、已经不在团队里的人（他们做过的事还在） */
const actorOptions = computed(() => {
  const gone = new Map<string, string>()
  for (const e of list.value) {
    if (e.actor.id && !e.actor.system && !members.value.some((m) => m.id === e.actor.id)) gone.set(e.actor.id, personTitle(e.actor))
  }
  if (actor.value && !gone.has(actor.value) && !members.value.some((m) => m.id === actor.value)) gone.set(actor.value, goneNames.get(actor.value) || t('spaces.person.former'))
  for (const [id, name] of gone) goneNames.set(id, name)
  return [
    { value: '', label: t('team.activity.actorAll') },
    ...members.value.map((m) => ({ value: m.id, label: t('team.activity.actorIs', { name: m.name }) })),
    ...[...gone].map(([id, name]) => ({ value: id, label: t('team.activity.actorIs', { name }) })),
  ]
})
/** 选中一个已离开的人之后列表只剩他的（或者空了）：名字得记着，不然下拉里那一项会变成「前成员」 */
const goneNames = new Map<string, string>()

// ---- 列表 ----
const list = ref<TeamActivityItem[]>([])
const total = ref(0)
const pageNo = ref(1)
const loading = ref(true)
const error = ref('')
let seq = 0

async function fetchPage(n: number) {
  const mine = ++seq
  loading.value = true
  error.value = ''
  try {
    const d = unwrap(await teamApi.activity(page.teamId, {
      page: n, pageSize: PAGE_SIZE, from: from.value, to: to.value,
      // 日期是按这台浏览器的日历选的，分组也按它，所以请求里带上浏览器的时区
      ...(browserZone() ? { tz: browserZone() } : {}),
      ...(category.value ? { category: category.value } : {}),
      ...(actor.value ? { actor: actor.value } : {}),
    }))
    if (mine !== seq) return
    list.value = n === 1 ? d.list : [...list.value, ...d.list.filter((x) => !list.value.some((y) => y.id === x.id))]
    total.value = d.total
    pageNo.value = n
    if (d.categories?.length) categories.value = d.categories
  } catch (err) {
    if (mine !== seq) return
    error.value = page.explain(err, t('common.loadFailed'))
  } finally {
    if (mine === seq) loading.value = false
  }
}
const reload = () => fetchPage(1)
const more = () => fetchPage(pageNo.value + 1)
watch([from, to, category, actor], reload)

/** 还在回收期里、调用者恢复得了的画布 id */
const trash = ref<Set<string>>(new Set())
const canRestore = computed(() => space.can('canvas:restore'))
async function loadTrash() {
  if (!canRestore.value) return
  try { trash.value = new Set(unwrap(await workflowApi.trash()).map((w) => w.id)) } catch { /* 读不到就不出「恢复」 */ }
}
onMounted(() => {
  void reload()
  void loadTrash()
  teamApi.members(page.teamId).then((r) => { members.value = unwrap(r).members }).catch(() => undefined)
})

// ---- 一行怎么写 ----
/** 每条只算一次；换语言时整份重算 */
const lines = computed(() => {
  void locale.value
  return new Map<string, ActivityLine>(list.value.map((e) => [e.id, describeActivity(e, ctx.value)]))
})
/** 成员上限那一条里的金额按团队现在的币种写 */
const ctx = computed(() => ({ currency: page.detail.value?.limits?.currency || '' }))
const lineOf = (e: TeamActivityItem) => lines.value.get(e.id) || describeActivity(e, ctx.value)

const days = computed(() => {
  const now = new Date()
  const key = (d: Date) => iso(d)
  const todayKey = key(now)
  const yesterdayKey = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const out: { key: string; label: string; items: TeamActivityItem[] }[] = []
  for (const e of list.value) {
    const d = new Date(e.createdAt)
    const k = key(d)
    let group = out[out.length - 1]
    if (!group || group.key !== k) {
      const date = new Intl.DateTimeFormat(locale.value, {
        month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
      }).format(d)
      const label = k === todayKey ? t('team.activity.today', { date }) : k === yesterdayKey ? t('team.activity.yesterday', { date }) : date
      group = { key: k, label, items: [] }
      out.push(group)
    }
    group.items.push(e)
  }
  return out
})

// ---- 恢复被删的画布 ----
const restoring = ref('')
/** 同一张画布可能删过不止一次：只在最近那一次删除上出按钮 */
function restorable(e: TeamActivityItem) {
  if (e.type !== 'canvas:deleted' || !e.target?.id || !canRestore.value || !trash.value.has(e.target.id)) return false
  return list.value.find((x) => x.type === 'canvas:deleted' && x.target?.id === e.target!.id)?.id === e.id
}
async function restore(e: TeamActivityItem) {
  if (!e.target?.id || restoring.value) return
  restoring.value = e.id
  try {
    await workflowApi.restore(e.target.id)
    MessagePlugin.success(t('team.activity.restored', { name: e.target.name }))
    trash.value = new Set([...trash.value].filter((id) => id !== e.target!.id))
    void reload()
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404 && !apiErrorCode(err).startsWith('team.')) {
      MessagePlugin.error(t('team.activity.restoreGone'))
      void loadTrash()
    } else {
      page.fail(err)
    }
  } finally {
    restoring.value = ''
  }
}
</script>

<style scoped>
.ac-bar { gap: 12px; margin-bottom: 16px; }
.ac-range { width: 250px; flex: none; }
.ac-sel { width: 148px; flex: none; }
.ac-note { flex: 1 1 260px; min-width: 0; text-align: right; color: var(--text-3); font-size: 12px; line-height: 1.6; }
.ac-error { margin-bottom: 16px; align-items: center; }
.ac-error span { flex: 1; min-width: 0; }
.ac-card { overflow: hidden; }
.ac-card.dim { opacity: .65; transition: opacity .15s; }
.ac-day h3 {
  padding: 10px 20px; font: 400 12px/1.6 var(--f-body); color: var(--text-3);
  background: rgb(var(--c-well) / .35); border-top: 1px solid var(--line);
}
.ac-day:first-child h3 { border-top: 0; }
.ac-day ul { list-style: none; margin: 0; padding: 0; }
.ac-row {
  display: grid; grid-template-columns: 52px minmax(132px, 172px) minmax(0, 1fr) auto; align-items: start; gap: 8px 16px;
  padding: 11px 20px; border-top: 1px solid var(--line); font-size: 13px;
}
.ac-row time { color: var(--text-3); font-size: 12px; }
.ac-who { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.ac-who { color: var(--text); font-weight: 500; }
.ac-who b { color: var(--text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-who :deep(.pn-tag) { height: 18px; padding: 0 6px; font-size: 11px; }
/* 超级管理员不是团队里的人：不用人的头像，用一枚盾牌 */
.ac-sys { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--chip-bg); color: var(--chip-fg); }
.ac-who.sys b { color: var(--chip-fg); }
.ac-msg { display: grid; gap: 4px; color: var(--text-2); min-width: 0; overflow-wrap: anywhere; line-height: 1.6; }
.ac-facts { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--text-3); }
.ac-change { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 2px 6px; min-width: 0; }
.ac-change i { font-style: normal; }
.ac-change i::after { content: ':'; }
.ac-change s { text-decoration: none; color: var(--text-2); }
.ac-change b { font-weight: 500; color: var(--text); }
.ac-change :deep(svg) { flex: none; color: var(--text-3); }
.ac-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ac-end { display: inline-flex; align-items: center; gap: 8px; justify-self: end; }
.ac-more { padding: 12px 20px; }
.ac-reset { margin-top: 12px; }
.ac-sk { display: grid; gap: 22px; padding: 24px 20px; }
.ac-sk i { display: block; height: 14px; border-radius: 6px; background: rgb(var(--c-film) / .1); animation: lc-pulse 1.6s ease-in-out infinite; }
.ac-sk i:nth-child(odd) { width: 74%; } .ac-sk i:nth-child(even) { width: 58%; }

@media (max-width: 720px) {
  .ac-row { grid-template-columns: auto minmax(0, 1fr) auto; padding: 12px 16px; }
  .ac-row time { grid-column: 1; grid-row: 1; }
  .ac-who { grid-column: 2; grid-row: 1; }
  .ac-end { grid-column: 3; grid-row: 1; }
  .ac-msg { grid-column: 1 / -1; grid-row: 2; }
  .ac-day h3 { padding: 10px 16px; }
  .ac-note { text-align: left; flex-basis: 100%; }
}
@media (max-width: 600px) {
  .ac-range { width: 100%; flex: 1 1 100%; }
  .ac-sel { flex: 1 1 120px; width: auto; }
}
</style>
