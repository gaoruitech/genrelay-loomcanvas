<template>
  <section class="lc-card tl" data-testid="teams-list">
    <header class="tl-head">
      <h3>{{ t('settings.teams.list.title') }}<small data-testid="teams-total">{{ t('settings.teams.list.total', { n: teams.length }) }}</small></h3>
      <div class="tl-tools">
        <label class="find">
          <LcIcon name="search" size="s" />
          <input
            v-model.trim="query" class="lc-input" type="text" autocomplete="off" spellcheck="false"
            :placeholder="t('settings.teams.list.searchPh')" :aria-label="t('settings.teams.list.searchPh')" data-testid="teams-search"
          />
        </label>
        <div class="flt">
          <LcSelect v-model="filter" :options="filterOptions" size="sm" :aria-label="t('settings.teams.list.filterLabel')" data-testid="teams-filter" />
        </div>
        <button class="lc-tb sm" type="button" :disabled="loading" v-tip="t('settings.teams.list.refresh')" :aria-label="t('settings.teams.list.refresh')" data-testid="teams-refresh" @click="reload">
          <LcIcon name="refresh" size="s" />
        </button>
      </div>
    </header>

    <div v-if="loading && !teams.length" class="pad"><div class="sk" aria-busy="true"><i /><i /><i /></div></div>
    <div v-else-if="loadError" class="pad sec-state">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm" type="button" @click="reload">{{ t('common.retry') }}</button>
    </div>
    <p v-else-if="!teams.length" class="lc-empty" data-testid="teams-empty">{{ t('settings.teams.list.empty') }}</p>
    <template v-else>
      <div class="lc-table-wrap tbl-wrap">
        <table class="lc-table teams" data-testid="teams-table">
          <thead>
            <tr>
              <th>{{ t('settings.teams.list.col.team') }}</th>
              <th>{{ t('settings.teams.list.col.owner') }}</th>
              <th class="num">{{ t('settings.teams.list.col.members') }}</th>
              <th class="num">{{ t('settings.teams.list.col.canvases') }}</th>
              <th class="num">{{ t('settings.teams.list.col.runs') }}</th>
              <th class="num">{{ t('settings.teams.list.col.concurrency') }}</th>
              <th>{{ t('settings.teams.list.col.status') }}</th>
              <th class="ops">{{ t('settings.teams.list.col.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tm in shown" :key="tm.id" :data-team="tm.name" :data-state="stateOf(tm)">
              <td class="c-team">
                <div class="idn">
                  <SpaceAvatar :name="tm.name" :seed="tm.id" :src="tm.avatar || ''" :size="28" />
                  <b>{{ tm.name }}</b>
                </div>
              </td>
              <td :data-label="t('settings.teams.list.col.owner')" class="c-owner">
                <span class="own">
                  <code>{{ tm.owner.username ? '@' + tm.owner.username : t('settings.teams.list.ownerGone') }}</code>
                  <span v-if="!tm.owner.usable" class="lc-tag err" data-testid="teams-owner-unusable">{{ t('settings.teams.list.ownerUnusable') }}</span>
                </span>
              </td>
              <td :data-label="t('settings.teams.list.col.members')" class="num">
                <span :class="{ custom: tm.maxMembers !== null }" v-tip="tm.maxMembers !== null ? t('settings.teams.list.customTip') : ''">{{ formatInt(tm.counts.members) }} / {{ formatInt(tm.effective.maxMembers) }}</span>
              </td>
              <td :data-label="t('settings.teams.list.col.canvases')" class="num">{{ formatInt(tm.counts.workflows) }}</td>
              <td :data-label="t('settings.teams.list.col.runs')" class="num">{{ formatInt(tm.counts.runs) }}</td>
              <td :data-label="t('settings.teams.list.col.concurrency')" class="num">
                <span :class="{ custom: tm.concurrency !== null }" v-tip="tm.concurrency !== null ? t('settings.teams.list.customTip') : ''">{{ tm.effective.concurrency }}</span>
              </td>
              <td :data-label="t('settings.teams.list.col.status')">
                <span class="lc-tag" :class="STATE_TONE[stateOf(tm)]" data-testid="teams-state">{{ stateText(tm) }}</span>
              </td>
              <td class="ops">
                <div class="ops-row">
                  <button
                    v-if="!tm.owner.usable" class="lc-btn sm" type="button" :disabled="busyId === tm.id" data-act="appoint"
                    @click="askAppoint(tm)"
                  >{{ t('settings.teams.list.act.appoint') }}</button>
                  <button
                    v-if="tm.status === 'dissolved'" class="lc-btn sm" type="button" :disabled="busyId === tm.id" data-act="restore"
                    @click="restore(tm)"
                  >{{ t('settings.teams.list.act.restore') }}</button>
                  <ActionMenu
                    :items="menuOf(tm)" :label="t('settings.teams.list.moreOf', { name: tm.name })" :disabled="busyId === tm.id"
                    @pick="(k) => onPick(tm, k)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!shown.length" class="lc-empty none" data-testid="teams-nomatch">{{ t('settings.teams.list.noMatch') }}</p>
      <p v-if="hasCustom" class="legend"><i class="mark" aria-hidden="true" />{{ t('settings.teams.list.customLegend') }}</p>
    </template>

    <!-- 调整上限 -->
    <Teleport :to="$lcPortal">
      <div v-if="limitsTarget" class="lc-mask lc-sheet" @click.self="closeLimits">
        <form v-dialog="{ onEscape: closeLimits, busy: limitsBusy }" class="lc-dialog dlg wide" role="dialog" aria-modal="true" aria-labelledby="teams-limits-h" novalidate data-testid="teams-limits-dialog" @submit.prevent="saveLimits">
          <div class="lc-dialog-head">
            <span id="teams-limits-h">{{ t('settings.teams.limits.title', { name: limitsTarget.name }) }}</span>
            <button class="lc-x" type="button" v-tip="t('common.close')" :aria-label="t('common.close')" :disabled="limitsBusy" @click="closeLimits">×</button>
          </div>
          <div class="lc-dialog-body">
            <div v-for="f in LIMIT_FIELDS" :key="f.key" class="lim" :data-limit="f.key">
              <div class="lim-k">
                <label :for="'team-lim-' + f.key">{{ t('settings.teams.limits.' + f.key) }}</label>
                <small>{{ f.key === 'maxMembers' ? t('settings.teams.limits.maxMembersHelp', { n: limitsTarget.counts.members }) : t('settings.teams.limits.concurrencyHelp') }}</small>
              </div>
              <label class="lc-check">
                <input v-model="limitsForm[f.key].useDefault" type="checkbox" :disabled="limitsBusy" :data-autofocus="f.key === LIMIT_FIELDS[0].key ? '' : undefined" />
                <span class="box" />
                <span>{{ t('settings.teams.limits.useDefault', { n: defaults[f.site] }) }}</span>
              </label>
              <div v-if="!limitsForm[f.key].useDefault" class="lim-v">
                <NumberStepper
                  :id="'team-lim-' + f.key" v-model="limitsForm[f.key].value" :min="1" :max="f.max" :disabled="limitsBusy"
                  :dec-label="t('settings.limits.decrease')" :inc-label="t('settings.limits.increase')"
                />
                <span class="range">{{ t('settings.limits.range', { min: 1, max: f.max }) }}</span>
              </div>
            </div>
            <p v-if="limitsError" class="lc-error-text" role="alert">{{ limitsError }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" :disabled="limitsBusy" @click="closeLimits">{{ t('common.cancel') }}</button>
            <button class="lc-btn primary" type="submit" :disabled="limitsBusy" data-testid="teams-limits-ok">{{ limitsBusy ? t('common.saving') : t('common.save') }}</button>
          </div>
        </form>
      </div>
    </Teleport>

    <!-- 停用 -->
    <Teleport :to="$lcPortal">
      <div v-if="suspendTarget" class="lc-mask lc-sheet" @click.self="!suspending && (suspendTarget = null)">
        <div v-dialog="{ onEscape: () => { suspendTarget = null }, busy: suspending }" class="lc-dialog dlg wide" role="alertdialog" aria-modal="true" aria-labelledby="teams-suspend-h" data-testid="teams-suspend-dialog">
          <div class="lc-dialog-head"><span id="teams-suspend-h">{{ t('settings.teams.suspend.title', { name: suspendTarget.name }) }}</span></div>
          <div class="lc-dialog-body">
            <p>{{ t('settings.teams.suspend.lead') }}</p>
            <ul class="pts">
              <li>{{ t('settings.teams.suspend.p1') }}</li>
              <li>{{ t('settings.teams.suspend.p2') }}</li>
              <li>{{ t('settings.teams.suspend.p3') }}</li>
            </ul>
            <p>{{ t('settings.teams.suspend.keep') }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" :disabled="suspending" data-autofocus @click="suspendTarget = null">{{ t('common.cancel') }}</button>
            <button class="lc-btn danger" type="button" :disabled="suspending" data-testid="teams-suspend-ok" @click="doSuspend">{{ t('settings.teams.suspend.ok') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 指定新团长 -->
    <Teleport :to="$lcPortal">
      <div v-if="appointTarget" class="lc-mask lc-sheet" @click.self="closeAppoint">
        <form ref="appointDlg" v-dialog="{ onEscape: closeAppoint, busy: appointing }" class="lc-dialog dlg wide" role="dialog" aria-modal="true" aria-labelledby="teams-appoint-h" novalidate data-testid="teams-appoint-dialog" @submit.prevent="doAppoint">
          <div class="lc-dialog-head">
            <span id="teams-appoint-h">{{ t('settings.teams.appoint.title', { name: appointTarget.name }) }}</span>
            <button class="lc-x" type="button" v-tip="t('common.close')" :aria-label="t('common.close')" :disabled="appointing" @click="closeAppoint">×</button>
          </div>
          <div class="lc-dialog-body">
            <p>{{ t('settings.teams.appoint.text', { owner: appointTarget.owner.username || t('settings.teams.list.ownerGone') }) }}</p>
            <div v-if="membersLoading" class="sk mem-sk" aria-busy="true"><i /><i /><i /></div>
            <div v-else-if="membersError" class="sec-state">
              <p class="lc-error-text">{{ membersError }}</p>
              <button class="lc-btn sm" type="button" @click="loadMembers">{{ t('common.retry') }}</button>
            </div>
            <p v-else-if="!candidates.length" class="lc-alert warn none-usable" data-testid="teams-appoint-none">
              <LcIcon name="warn" /><span>{{ t('settings.teams.appoint.none') }}</span>
            </p>
            <div v-else class="mems" role="radiogroup" :aria-label="t('settings.teams.appoint.pick')">
              <button
                v-for="m in others" :key="m.id" type="button" class="mem" :class="{ on: picked === m.id }" role="radio"
                :aria-checked="picked === m.id" :disabled="m.disabled || appointing" :data-member="m.username" @click="picked = m.id"
              >
                <span class="rd" aria-hidden="true" />
                <SpaceAvatar :name="m.username" :seed="m.id" shape="round" :size="26" />
                <span class="mn">{{ m.username }}</span>
                <span class="lc-tag">{{ t('spaces.role.' + (m.role === 'admin' ? 'admin' : 'member')) }}</span>
                <span v-if="m.disabled" class="lc-tag err">{{ t('settings.teams.appoint.disabled') }}</span>
              </button>
            </div>
            <p v-if="appointError" class="lc-error-text" role="alert">{{ appointError }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" :disabled="appointing" @click="closeAppoint">{{ t('common.cancel') }}</button>
            <button class="lc-btn primary" type="submit" :disabled="appointing || !picked" data-testid="teams-appoint-ok">{{ t('settings.teams.appoint.ok') }}</button>
          </div>
        </form>
      </div>
    </Teleport>

    <!-- 永久删除：敲一遍团队名称 -->
    <ConfirmNameDialog
      v-if="purgeTarget"
      :title="t('settings.teams.purge.title', { name: purgeTarget.name })"
      :name="purgeTarget.name"
      :ok-text="t('settings.teams.purge.ok')"
      :busy-text="t('settings.teams.purge.busy')"
      :busy="purging"
      :error="purgeError"
      @close="!purging && (purgeTarget = null)"
      @confirm="doPurge"
    >
      <p class="pg-lead">{{ t('settings.teams.purge.lead', { name: purgeTarget.name }) }}</p>
      <p class="pg-what">{{ t('settings.teams.purge.what') }}</p>
      <div class="lc-alert pg-warn"><LcIcon name="warn" /><span>{{ t('settings.teams.purge.forever') }}</span></div>
    </ConfirmNameDialog>

    <!-- 删除的结果 -->
    <Teleport :to="$lcPortal">
      <div v-if="purged" class="lc-mask lc-sheet" @click.self="purged = null">
        <div v-dialog="() => { purged = null }" class="lc-dialog dlg wide" role="dialog" aria-modal="true" aria-labelledby="teams-purged-h" data-testid="teams-purged-dialog">
          <div class="lc-dialog-head"><span id="teams-purged-h">{{ t('settings.teams.purge.doneTitle', { name: purged.name }) }}</span></div>
          <div class="lc-dialog-body">
            <p v-if="!purged.rows.some(r => r.n > 0)">{{ t('settings.teams.purge.doneEmpty') }}</p>
            <template v-else>
              <p>{{ t('settings.teams.purge.doneLead') }}</p>
              <dl class="res" data-testid="teams-purged-counts">
                <div v-for="r in purged.rows" :key="r.key" :class="{ zero: !r.n }" :data-count="r.key"><dt>{{ r.label }}</dt><dd>{{ formatInt(r.n) }}</dd></div>
              </dl>
            </template>
            <div v-if="!purged.filesRemoved" class="lc-alert warn res-warn"><LcIcon name="warn" /><span>{{ t('settings.teams.purge.filesLeft') }}</span></div>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn primary" type="button" data-autofocus data-testid="teams-purged-close" @click="purged = null">{{ t('settings.teams.purge.doneOk') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
/**
 * 团队列表（仅超级管理员）：只有名称和数字。
 * 能做的：调整这个团队自己的人数 / 并发上限（或改回站点默认值）、停用 / 恢复使用、恢复被团长解散的团队（7 天内）、
 * 团长账号不可用时指定新团长、把已经关闭（停用或解散）的团队永久删除。
 * 这里的几个弹窗的键盘和焦点都交给 v-dialog（打开时焦点进弹窗、Tab 圈在里面、Esc 关、关掉后焦点还给行尾的「更多」）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { vDialog, refocusDialog } from '@/directives/dialog'
import { ownerApi, unwrap, apiErrorCode, apiErrorMessage } from '@/utils/api'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import ConfirmNameDialog from '@/components/space/ConfirmNameDialog.vue'
import { daysUntil, formatInt } from '@/components/space/format'
import NumberStepper from './NumberStepper.vue'
import type { AdminTeam, TeamPurgeResult } from '@/types'

const { t, te } = useI18n()

type State = 'normal' | 'unmanaged' | 'suspended' | 'dissolved'
const STATE_TONE: Record<State, string> = { normal: 'ok', unmanaged: 'warn', suspended: 'err', dissolved: '' }

const teams = ref<AdminTeam[]>([])
const defaults = ref({ teamMaxPerUser: 3, teamMaxMembers: 50, teamConcurrency: 4, teamActivityDays: 365 })
const loading = ref(true)
const loadError = ref('')
const busyId = ref('')
const query = ref('')
const filter = ref<'all' | State>('all')

const filterOptions = computed(() => (['all', 'normal', 'unmanaged', 'suspended', 'dissolved'] as const)
  .map(v => ({ value: v, label: t('settings.teams.list.filter.' + v) })))

/** 已停用 / 已解散优先于「无人管理」：那两种状态下团队本来就没人进得去 */
function stateOf(tm: AdminTeam): State {
  if (tm.status === 'dissolved') return 'dissolved'
  if (tm.status === 'suspended') return 'suspended'
  return tm.owner.usable ? 'normal' : 'unmanaged'
}
function stateText(tm: AdminTeam): string {
  const s = stateOf(tm)
  if (s !== 'dissolved') return t('settings.teams.list.state.' + s)
  return tm.purgeAt ? t('settings.teams.list.state.dissolvedIn', { n: daysUntil(tm.purgeAt) }) : t('settings.teams.list.state.dissolved')
}

const shown = computed(() => {
  const q = query.value.toLowerCase()
  return teams.value.filter((tm) => {
    if (filter.value !== 'all' && stateOf(tm) !== filter.value) return false
    return !q || tm.name.toLowerCase().includes(q) || tm.owner.username.toLowerCase().includes(q)
  })
})
const hasCustom = computed(() => shown.value.some(tm => tm.maxMembers !== null || tm.concurrency !== null))

async function reload() {
  loading.value = true
  loadError.value = ''
  try {
    const data = unwrap(await ownerApi.teams())
    teams.value = data.teams || []
    if (data.defaults) defaults.value = data.defaults
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(reload)
defineExpose({ reload })

function put(next: AdminTeam) {
  teams.value = teams.value.map(x => (x.id === next.id ? next : x))
}

/** 认得的错误码给本地说法（多半带着下一步该怎么办）；团队已经不在了就顺手刷新 */
const KNOWN = ['team.is_dissolved', 'team.still_active', 'team.confirm_mismatch', 'team.owner_usable', 'team.new_owner_unusable', 'team.member_not_found', 'team.not_dissolved', 'team.not_found', 'team.changed']
function describe(err: unknown): string {
  const code = apiErrorCode(err)
  if (['team.not_found', 'team.not_dissolved', 'team.changed', 'team.owner_usable', 'team.is_dissolved', 'team.still_active'].includes(code)) void reload()
  const key = 'settings.teams.errors.' + code.replace(/^team\./, '')
  return KNOWN.includes(code) && te(key) ? t(key) : apiErrorMessage(err, t('common.operationFailed'))
}

function menuOf(tm: AdminTeam): ActionMenuItem[] {
  const items: ActionMenuItem[] = [{ key: 'limits', label: t('settings.teams.list.act.limits'), icon: 'settings' }]
  if (tm.status === 'active') items.push({ key: 'suspend', label: t('settings.teams.list.act.suspend'), icon: 'pause' })
  if (tm.status === 'suspended') items.push({ key: 'resume', label: t('settings.teams.list.act.resume'), icon: 'play' })
  if (tm.status !== 'active') items.push({ key: 'purge', label: t('settings.teams.list.act.purge'), icon: 'trash', danger: true })
  return items
}
function onPick(tm: AdminTeam, key: string) {
  if (key === 'limits') openLimits(tm)
  else if (key === 'suspend') suspendTarget.value = tm
  else if (key === 'resume') void resume(tm)
  else if (key === 'purge') { purgeError.value = ''; purgeTarget.value = tm }
}

// ---- 调整上限 ----
const LIMIT_FIELDS = [
  { key: 'maxMembers', site: 'teamMaxMembers', max: 1000 },
  { key: 'concurrency', site: 'teamConcurrency', max: 32 },
] as const
const limitsTarget = ref<AdminTeam | null>(null)
const limitsForm = reactive({
  maxMembers: { useDefault: true, value: 50 },
  concurrency: { useDefault: true, value: 4 },
})
const limitsBusy = ref(false)
const limitsError = ref('')

function openLimits(tm: AdminTeam) {
  for (const f of LIMIT_FIELDS) {
    limitsForm[f.key].useDefault = tm[f.key] === null
    limitsForm[f.key].value = tm[f.key] ?? defaults.value[f.site]
  }
  limitsError.value = ''
  limitsTarget.value = tm
}
function closeLimits() {
  if (!limitsBusy.value) limitsTarget.value = null
}
async function saveLimits() {
  const tm = limitsTarget.value
  if (!tm) return
  limitsError.value = ''
  const body: { maxMembers?: number | null; concurrency?: number | null } = {}
  for (const f of LIMIT_FIELDS) {
    const cur = limitsForm[f.key]
    const v = cur.useDefault ? null : Number(cur.value)
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > f.max)) {
      limitsError.value = t('settings.limits.outOfRange', { field: t('settings.teams.limits.' + f.key), min: 1, max: f.max })
      return
    }
    if (v !== tm[f.key]) body[f.key] = v
  }
  if (!Object.keys(body).length) { limitsTarget.value = null; return }
  limitsBusy.value = true
  try {
    put(unwrap(await ownerApi.updateTeam(tm.id, body)))
    limitsTarget.value = null
    MessagePlugin.success(t('settings.teams.limits.saved', { name: tm.name }))
  } catch (err) {
    limitsError.value = describe(err)
    if (apiErrorCode(err) === 'team.not_found') limitsTarget.value = null
  } finally {
    limitsBusy.value = false
  }
}

// ---- 停用 / 恢复使用 / 恢复已解散的 ----
const suspendTarget = ref<AdminTeam | null>(null)
const suspending = ref(false)

async function doSuspend() {
  const tm = suspendTarget.value
  if (!tm) return
  suspending.value = true
  try {
    put(unwrap(await ownerApi.updateTeam(tm.id, { status: 'suspended' })))
    MessagePlugin.success(t('settings.teams.suspend.done', { name: tm.name }))
  } catch (err) {
    MessagePlugin.error(describe(err))
  } finally {
    suspending.value = false
    suspendTarget.value = null
  }
}

async function resume(tm: AdminTeam) {
  busyId.value = tm.id
  try {
    put(unwrap(await ownerApi.updateTeam(tm.id, { status: 'active' })))
    MessagePlugin.success(t('settings.teams.list.resumed', { name: tm.name }))
  } catch (err) {
    MessagePlugin.error(describe(err))
  } finally {
    busyId.value = ''
  }
}

async function restore(tm: AdminTeam) {
  busyId.value = tm.id
  try {
    put(unwrap(await ownerApi.restoreTeam(tm.id)))
    MessagePlugin.success(t('settings.teams.list.restored', { name: tm.name }))
  } catch (err) {
    MessagePlugin.error(describe(err))
  } finally {
    busyId.value = ''
  }
}

// ---- 指定新团长 ----
type Member = { id: string; username: string; role: string; disabled: boolean }
const appointTarget = ref<AdminTeam | null>(null)
const members = ref<Member[]>([])
const membersLoading = ref(false)
const membersError = ref('')
const picked = ref('')
const appointing = ref(false)
const appointError = ref('')
const appointDlg = ref<HTMLElement | null>(null)
/** 现任团长不在可选的人里 */
const others = computed(() => members.value.filter(m => m.id !== appointTarget.value?.owner.id))
const candidates = computed(() => others.value.filter(m => !m.disabled))

async function loadMembers() {
  const tm = appointTarget.value
  if (!tm) return
  membersLoading.value = true
  membersError.value = ''
  try {
    const list = unwrap(await ownerApi.teamMembers(tm.id)) || []
    if (appointTarget.value?.id !== tm.id) return
    members.value = list
    if (!candidates.value.some(m => m.id === picked.value)) picked.value = ''
  } catch (err) {
    membersError.value = describe(err)
    if (apiErrorCode(err) === 'team.not_found') appointTarget.value = null
  } finally {
    membersLoading.value = false
  }
}
function askAppoint(tm: AdminTeam) {
  appointTarget.value = tm
  members.value = []
  picked.value = ''
  appointError.value = ''
  void loadMembers()
}
function closeAppoint() {
  if (!appointing.value) appointTarget.value = null
}
async function doAppoint() {
  const tm = appointTarget.value
  if (!tm || !picked.value) return
  const name = members.value.find(m => m.id === picked.value)?.username || ''
  appointing.value = true
  appointError.value = ''
  try {
    put(unwrap(await ownerApi.appointTeamOwner(tm.id, picked.value)))
    appointTarget.value = null
    MessagePlugin.success(t('settings.teams.appoint.done', { name, team: tm.name }))
  } catch (err) {
    const code = apiErrorCode(err)
    const msg = describe(err)
    if (code === 'team.owner_usable' || code === 'team.not_found') {
      // 团长的账号已经能用了（或者团队没了）：这个弹窗没有意义了
      appointTarget.value = null
      MessagePlugin.warning(msg)
    } else {
      appointError.value = msg
      // 那个人刚被停用、或者刚离开团队：名单重读一遍
      if (code === 'team.new_owner_unusable' || code === 'team.member_not_found') void loadMembers()
      // 选中的人没了，「指定」按钮会变灰：焦点别留在一个按不了的按钮上
      refocusDialog(appointDlg.value)
    }
  } finally {
    appointing.value = false
  }
}

// ---- 永久删除 ----
const purgeTarget = ref<AdminTeam | null>(null)
const purging = ref(false)
const purgeError = ref('')
const purged = ref<{ name: string; rows: { key: string; label: string; n: number }[]; filesRemoved: boolean } | null>(null)
/** 结果里各项的顺序：先是人，再是内容，最后是文件。服务端的 counts 总是带全这 14 项（没有的是 0） */
const PURGE_KEYS = ['members', 'invitations', 'activity', 'canvases', 'shares', 'assets', 'assetFolders', 'brandKits', 'providers', 'modelOverrides', 'runs', 'templates', 'textTemplates', 'files']
/** 老服务端按集合名给的那一份 → 现在的名字 */
const PURGE_OLD: Record<string, string> = { workflows: 'canvases', userassets: 'assets', brandkits: 'brandKits', modeloverrides: 'modelOverrides', texttemplates: 'textTemplates' }
function purgeRows(out: TeamPurgeResult) {
  const counts: Record<string, number> = {}
  if (out.counts) Object.assign(counts, out.counts)
  else {
    for (const [k, n] of Object.entries((out as { removed?: Record<string, number> }).removed || {})) counts[PURGE_OLD[k] || k] = Number(n) || 0
    counts.files = Number(out.files) || 0
  }
  const label = (key: string) => (te('settings.teams.purge.kind.' + key) ? t('settings.teams.purge.kind.' + key) : key)
  // 认得的按固定顺序列全（0 也列：看得出「这一类确实没有」）；不认得的原样跟在后面
  const known = PURGE_KEYS.filter((k) => out.counts || k in counts).map((key) => ({ key, label: label(key), n: Number(counts[key]) || 0 }))
  const extra = Object.keys(counts).filter((k) => !PURGE_KEYS.includes(k)).map((key) => ({ key, label: label(key), n: Number(counts[key]) || 0 }))
  return [...known, ...extra]
}

async function doPurge(confirm: string) {
  const tm = purgeTarget.value
  if (!tm) return
  purging.value = true
  purgeError.value = ''
  try {
    const out = unwrap(await ownerApi.purgeTeam(tm.id, confirm))
    teams.value = teams.value.filter(x => x.id !== tm.id)
    purgeTarget.value = null
    purged.value = {
      name: tm.name,
      rows: purgeRows(out),
      filesRemoved: out.filesRemoved !== false,
    }
  } catch (err) {
    const code = apiErrorCode(err)
    purgeError.value = describe(err)
    if (code === 'team.not_found') {
      purgeTarget.value = null
      MessagePlugin.warning(purgeError.value)
    }
  } finally {
    purging.value = false
  }
}
</script>

<style scoped>
@import './section-shared.css';

/* 表格要不要折成卡片看的是这张卡片自己有多宽，不是视口 */
.tl { min-width: 0; overflow: hidden; container-type: inline-size; }
.tl-head { display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap; padding: 14px 20px 14px 24px; border-bottom: 1px solid var(--line); }
.tl-head h3 { flex: 1 1 auto; font: 600 15px/1.5 var(--f-disp); color: var(--text); display: flex; align-items: baseline; gap: 10px; white-space: nowrap; }
.tl-head h3 small { font: 400 13px var(--f-body); color: var(--text-3); }
.tl-tools { display: flex; align-items: center; gap: 8px; flex: 0 1 auto; min-width: 0; }
.find { position: relative; flex: 1 1 220px; width: 220px; min-width: 0; }
.find > .lc-ic { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.find .lc-input { height: 32px; padding-left: 34px; font-size: 13px; }
.flt { flex: none; width: 132px; }
.pad { padding: 20px 24px; }

.teams th, .teams td { padding-left: 6px; padding-right: 6px; }
.teams th:first-child, .teams td:first-child { padding-left: 24px; }
.teams th:last-child, .teams td:last-child { padding-right: 20px; }
.teams td { padding-top: 11px; padding-bottom: 11px; white-space: nowrap; }
.teams tbody tr:first-child td { border-top: 0; }
.teams tbody tr:hover td { background: rgb(var(--c-film) / .04); }
.idn { display: flex; align-items: center; gap: 10px; min-width: 0; }
.idn b { font-weight: 500; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.c-team { max-width: 190px; }
.own { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.own code { font: 12px var(--f-mono); color: var(--text-2); }
.custom { color: var(--cyan-soft); border-bottom: 1px dashed currentColor; padding-bottom: 1px; }
.ops { text-align: right; }
.ops-row { display: inline-flex; align-items: center; gap: 6px; }
.none { padding: 28px 16px; border-top: 1px solid var(--line); }
.legend { display: flex; align-items: center; gap: 8px; padding: 10px 24px; border-top: 1px solid var(--line); font-size: 12px; color: var(--text-3); }
.legend .mark { width: 16px; height: 0; border-bottom: 1px dashed var(--cyan-soft); flex: none; }

.dlg.wide { width: 480px; }
.lim { display: grid; gap: 10px; padding: 16px 0; border-top: 1px solid var(--line); }
.lim:first-child { padding-top: 0; border-top: 0; }
.lim-k label { display: block; font-size: 14px; font-weight: 500; color: var(--text); }
.lim-k small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.6; color: var(--text-3); }
.lim-v { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.range { font: 12px var(--f-mono); color: var(--text-3); }
.pts { margin: 10px 0; padding-left: 20px; color: var(--text-2); line-height: 1.8; font-size: 14px; }
.mem-sk { margin-top: 16px; }
.none-usable { margin-top: 14px; }
.mems { display: grid; gap: 6px; margin-top: 14px; }
.mem {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; text-align: left;
  border-radius: 10px; border: 1px solid var(--line-2); background: rgb(var(--c-well) / .35); color: var(--text); cursor: pointer;
  transition: border-color .15s, background .15s;
}
.mem:hover:not(.on):not(:disabled) { border-color: var(--line-3); }
.mem:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.mem.on { border-color: var(--cyan); background: rgb(var(--c-cyan) / .07); }
.mem:disabled { opacity: .55; cursor: not-allowed; }
.mem .rd { width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid var(--line-3); flex: none; display: grid; place-items: center; }
.mem.on .rd { border-color: var(--cyan); }
.mem.on .rd::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); }
.mn { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.lc-dialog-body > .lc-error-text { margin-top: 12px; }
.pg-lead { color: var(--text); line-height: 1.7; }
.pg-what { margin-top: 8px; color: var(--text-2); line-height: 1.7; font-size: 13px; }
.pg-warn { margin-top: 12px; }
.res { margin: 12px 0 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.res > div { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.res dt { color: var(--text-2); }
.res dd { margin: 0; font: 12px var(--f-mono); color: var(--text); }
.res > .zero dt, .res > .zero dd { color: var(--text-3); }
.res-warn { margin-top: 14px; }

/* 放不下一张表：一行变成一张卡片 */
@container (max-width: 760px) {
  .tl-head { padding: 14px 16px; }
  .tl-tools { flex: 1 1 100%; }
  .find { width: auto; }
  .pad { padding: 16px; }
  .tbl-wrap { overflow: visible; padding: 12px 12px 2px; }
  .teams, .teams tbody, .teams tr, .teams td { display: block; }
  .teams thead { display: none; }
  .teams tr { border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 14px; margin-bottom: 10px; background: rgb(var(--c-well) / .25); }
  .teams tbody tr:hover td { background: none; }
  .teams td, .teams td:first-child, .teams td:last-child { border: 0; padding: 5px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: right; white-space: normal; }
  .teams td[data-label]::before { content: attr(data-label); color: var(--text-3); font: 12px var(--f-body); text-align: left; flex: none; }
  .teams td.c-team { display: block; max-width: none; text-align: left; padding-bottom: 8px; }
  .own { justify-content: flex-end; }
  .teams td.ops { padding: 10px 0 0; margin-top: 6px; border-top: 1px solid var(--line); justify-content: flex-end; }
  .legend { padding: 10px 16px; }
}
@media (max-width: 600px) {
  .res { grid-template-columns: minmax(0, 1fr); }
}
</style>
