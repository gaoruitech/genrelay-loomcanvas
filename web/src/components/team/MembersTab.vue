<template>
  <div class="mb">
    <div class="lc-fbar mb-bar">
      <p class="mb-count" data-testid="member-count">
        <i18n-t keypath="team.members.count" tag="span" scope="global">
          <template #n><b>{{ members.length }}</b></template>
          <template #max><b>{{ maxMembers }}</b></template>
        </i18n-t>
      </p>
      <label class="lc-inp sm mb-search">
        <LcIcon name="search" size="s" />
        <input v-model.trim="q" type="search" :placeholder="t('team.members.search')" :aria-label="t('team.members.search')" />
      </label>
      <div class="mb-role">
        <LcSelect v-model="roleFilter" :options="roleOptions" size="sm" :aria-label="t('team.members.roleLabel')" />
      </div>
      <span class="lc-sp" />
      <button v-if="canInvite" class="lc-btn primary" type="button" data-act="invite" @click="invites?.openCreate()">
        <LcIcon name="plus" />{{ t('team.members.invite') }}
      </button>
    </div>

    <p v-if="!loading && !error && withUsage" class="mb-why def" data-testid="members-definition">
      <LcIcon name="info" size="s" />{{ t('team.members.definition', { month: monthName }) }}
    </p>
    <p v-if="!loading && !error && !withUsage" class="mb-why">
      <LcIcon name="info" size="s" />{{ t(space.role === 'admin' ? 'team.members.noUsageAdmin' : 'team.members.noUsageMember') }}
    </p>

    <div class="lc-card mb-card">
      <div v-if="loading && !members.length" class="mb-sk" aria-busy="true"><i v-for="n in 5" :key="n" /></div>
      <div v-else-if="error" class="mb-state">
        <p class="lc-error-text" role="alert">{{ error }}</p>
        <button class="lc-btn sm" type="button" @click="load">{{ t('common.retry') }}</button>
      </div>
      <div v-else class="lc-table-wrap">
        <table class="lc-table mb-table" :class="{ wide: withUsage }">
          <thead>
            <tr>
              <th>{{ t('team.col.member') }}</th>
              <th>{{ t('team.col.role') }}</th>
              <template v-if="withUsage">
                <th class="num">{{ t('team.members.col.runs') }}</th>
                <th v-if="$feat.cost" class="num">{{ t('team.members.col.amount') }}</th>
                <th class="c-limit">{{ t('team.members.col.limit') }}</th>
              </template>
              <th>{{ t('team.members.col.joined') }}</th>
              <th class="right">{{ t('team.col.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in rows" :key="m.id" :data-member="m.username">
              <td>
                <span class="mb-who">
                  <SpaceAvatar :name="m.name" :seed="m.id" shape="round" :size="28" />
                  <span class="mb-who-t">
                    <b>{{ m.name }}<span v-if="m.id === meId" class="mb-you">{{ t('spaces.person.you') }}</span></b>
                    <small class="lc-mono">@{{ m.username }}</small>
                  </span>
                </span>
              </td>
              <td>
                <span class="mb-tags">
                  <span class="lc-tag" :class="{ accent: m.role !== 'member' }">{{ t('spaces.role.' + m.role) }}</span>
                  <span v-if="m.disabled" class="lc-tag err">{{ t('team.members.disabled') }}</span>
                </span>
              </td>
              <template v-if="withUsage">
                <!-- 本月已用 = 已成功 + 进行中（和上限用的是同一个数）；失败、取消的写在下面，标明不计 -->
                <td class="num" data-col="used">
                  {{ formatInt(m.usage?.runs || 0) }}
                  <small v-if="m.usage?.breakdown?.inProgress.runs" class="mb-sub">{{ t('team.members.inProgress', { n: formatInt(m.usage.breakdown.inProgress.runs) }) }}</small>
                  <small v-if="notCountedOf(m)" class="mb-sub off" data-part="not-counted">{{ notCountedOf(m) }}</small>
                </td>
                <td v-if="$feat.cost" class="num" data-col="amount">
                  {{ amountOf(m) }}
                  <small v-if="m.usage?.uncounted" class="mb-sub warn">{{ t('spaces.limits.uncounted', { n: m.usage.uncounted }) }}</small>
                </td>
                <td class="c-limit">
                  <MemberLimitCell :effective="m.effective" :currency="m.usage?.currency || currency" />
                </td>
              </template>
              <td class="lc-mono mb-date">{{ formatDate(m.joinedAt) }}</td>
              <td class="right">
                <ActionMenu v-if="actionsOf(m).length" :items="actionsOf(m)" :label="t('team.members.actionsFor', { name: m.name })" @pick="(k) => act(k, m)" />
                <span v-else class="lc-t3" aria-hidden="true">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!rows.length" class="lc-empty">{{ t('team.members.noMatch') }}</div>
      </div>
    </div>

    <InviteLinks v-if="canInvite" ref="invites" />

    <!-- 调整上限 -->
    <MemberLimitDialog v-if="dialog?.kind === 'limit'" :member="dialog.member" @close="dialog = null" @saved="onLimitSaved" />

    <!-- 修改显示名 -->
    <TeamDialog v-if="dialog?.kind === 'name'" :title="t('team.rename.title')" :busy="busy" @close="dialog = null" @submit="saveName">
      <div class="lc-field">
        <label for="mb-name">{{ t('team.rename.label', { username: dialog.member.username }) }}</label>
        <input id="mb-name" v-model="nameText" class="lc-input" maxlength="40" autocomplete="off" :placeholder="dialog.member.username" data-autofocus />
        <span class="lc-help">{{ t('team.rename.help') }}</span>
      </div>
      <p v-if="dialogError" class="lc-error-text" role="alert">{{ dialogError }}</p>
      <template #foot>
        <button class="lc-btn" type="button" :disabled="busy" @click="dialog = null">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary" type="submit" :disabled="busy">{{ busy ? t('common.saving') : t('common.save') }}</button>
      </template>
    </TeamDialog>

    <!-- 移除成员：先说清会发生什么，移除后给结果 -->
    <TeamDialog
      v-if="dialog?.kind === 'remove'"
      :title="removed ? t('team.remove.doneTitle', { name: dialog.member.name }) : t('team.remove.title', { name: dialog.member.name })"
      :busy="busy"
      @close="dialog = null"
      @submit="removed ? (dialog = null) : remove()"
    >
      <template v-if="!removed">
        <p>{{ t('team.remove.body', { name: dialog.member.name }) }}</p>
        <ul>
          <li>{{ t('team.remove.private') }}</li>
          <li>{{ t('team.remove.runs') }}</li>
          <li>{{ t('team.remove.stays') }}</li>
          <li>{{ t('team.remove.back') }}</li>
        </ul>
        <p v-if="dialogError" class="lc-error-text" role="alert">{{ dialogError }}</p>
      </template>
      <template v-else>
        <p data-testid="remove-result">{{ t('team.remove.result', { canvases: removed.canvasesInherited, runs: removed.runsCanceled }) }}</p>
        <div v-if="removed.keysSet?.length" class="lc-alert warn" role="alert" data-testid="keys-notice">
          <LcIcon name="key" />
          <div>
            <b>{{ t('team.remove.keysTitle', { name: dialog.member.name }) }}</b>
            <p>{{ t('team.remove.keysBody', { providers: removed.keysSet.map((k) => k.name).join(t('team.listSep')) }) }}</p>
            <router-link :to="{ name: 'models' }">{{ t('team.remove.keysLink') }}</router-link>
          </div>
        </div>
      </template>
      <template #foot>
        <template v-if="!removed">
          <button class="lc-btn" type="button" :disabled="busy" data-autofocus @click="dialog = null">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" type="submit" :disabled="busy" data-act="remove-confirm">{{ busy ? t('team.remove.removing') : t('team.remove.confirm') }}</button>
        </template>
        <button v-else class="lc-btn primary" type="submit" data-autofocus>{{ t('spaces.notice.ok') }}</button>
      </template>
    </TeamDialog>

    <!-- 退出团队 -->
    <LeaveDialog v-if="dialog?.kind === 'leave'" @close="dialog = null" />

    <!-- 团长不能退出：说清楚该怎么办 -->
    <TeamDialog v-if="dialog?.kind === 'ownerLeave'" :title="t('team.ownerLeave.title')" @close="dialog = null" @submit="dialog = null">
      <p>{{ t('team.ownerLeave.body') }}</p>
      <template #foot>
        <button class="lc-btn" type="button" @click="dialog = null">{{ t('common.close') }}</button>
        <router-link class="lc-btn primary" :to="{ name: 'team', params: { tab: 'settings' } }" data-autofocus>{{ t('team.ownerLeave.go') }}</router-link>
      </template>
    </TeamDialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 成员页签：名单、角色、（团长和被允许的管理员）本月用量和上限；每行的操作只出现当前这个人做得了的；
 * 表格下面是邀请链接（团长、管理员）。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamApi, unwrap, apiErrorCode } from '@/utils/api'
import { MessagePlugin } from '@/utils/feedback'
import { formatMoney } from '@/utils/cost'
import { useSpaceStore } from '@/stores/space'
import { formatDate, formatInt } from '@/components/space/format'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import MemberLimitCell from '@/components/space/MemberLimitCell.vue'
import { monthText, notCountedText } from '@/utils/budget'
import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu.vue'
import TeamDialog from './TeamDialog.vue'
import MemberLimitDialog from './MemberLimitDialog.vue'
import LeaveDialog from './LeaveDialog.vue'
import InviteLinks from './InviteLinks.vue'
import { useTeamPage } from './context'
import type { TeamMember, TeamRole } from '@/types'

const { t, locale } = useI18n()
const space = useSpaceStore()
const page = useTeamPage()

const members = ref<TeamMember[]>([])
const maxMembers = ref(page.detail.value?.maxMembers || 0)
const withUsage = ref(false)
const loading = ref(true)
const error = ref('')

const meId = computed(() => page.detail.value?.me.id || '')
const currency = computed(() => page.detail.value?.limits?.currency || 'CNY')
/** 名单里的用量是哪个月的：团队时区里的本月 */
const monthName = computed(() => (void locale.value, monthText(page.detail.value?.limits?.month)))
const canInvite = computed(() => space.can('invite:manage'))
const invites = ref<InstanceType<typeof InviteLinks> | null>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const d = unwrap(await teamApi.members(page.teamId))
    members.value = d.members
    maxMembers.value = d.maxMembers
    withUsage.value = d.withUsage
  } catch (err) {
    error.value = page.explain(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---- 筛选 ----
const q = ref('')
const roleFilter = ref<TeamRole | ''>('')
const roleOptions = computed(() => [
  { value: '' as TeamRole | '', label: t('team.members.roleFilter', { role: t('common.all') }) },
  ...(['owner', 'admin', 'member'] as TeamRole[]).map((r) => ({ value: r as TeamRole | '', label: t('team.members.roleFilter', { role: t('spaces.role.' + r) }) })),
])
const rows = computed(() => {
  const s = q.value.toLowerCase()
  return members.value.filter((m) =>
    (!roleFilter.value || m.role === roleFilter.value)
    && (!s || m.name.toLowerCase().includes(s) || m.username.toLowerCase().includes(s)))
})

/** 「失败 3 次、取消 1 次，不计入上限」；没有就是空串 */
const notCountedOf = (m: TeamMember) => (m.usage?.breakdown ? notCountedText(m.usage.breakdown) : '')
function amountOf(m: TeamMember) {
  const u = m.usage
  if (!u || !u.amount) return '—'
  return t('cost.approx', { amount: formatMoney(u.amount, u.currency || currency.value) })
}

// ---- 每行能做什么 ----
type Action = 'promote' | 'demote' | 'limit' | 'name' | 'remove' | 'leave' | 'ownerLeave'
function actionsOf(m: TeamMember): ActionMenuItem[] {
  const self = m.id === meId.value
  const out: ActionMenuItem[] = []
  const add = (key: Action, icon: string, danger = false) => out.push({ key, icon, danger, label: t('team.members.act.' + key) })
  if (m.role !== 'owner' && space.can('member:set_role')) add(m.role === 'admin' ? 'demote' : 'promote', 'shield')
  if (withUsage.value && space.can('limits:manage')) add('limit', 'bolt')
  // 显示名：自己的，或者团长 / 管理员改别人的（团长那一行只有团长自己动）
  if (self || (space.isManager && m.role !== 'owner')) add('name', 'edit')
  if (!self && m.role !== 'owner' && space.maybe('member:remove') && (space.isTeamOwner || (space.role === 'admin' && m.role === 'member'))) add('remove', 'trash', true)
  if (self) add(m.role === 'owner' ? 'ownerLeave' : 'leave', 'logout', m.role !== 'owner')
  return out
}

type Dialog = { kind: 'limit' | 'name' | 'remove'; member: TeamMember } | { kind: 'leave' | 'ownerLeave' }
const dialog = ref<Dialog | null>(null)
const busy = ref(false)
const dialogError = ref('')
const nameText = ref('')
const removed = ref<{ canvasesInherited: number; runsCanceled: number; keysSet?: { id: string; name: string }[] } | null>(null)

function act(key: string, m: TeamMember) {
  dialogError.value = ''
  removed.value = null
  if (key === 'promote' || key === 'demote') void setRole(m, key === 'promote' ? 'admin' : 'member')
  else if (key === 'limit' || key === 'remove') dialog.value = { kind: key, member: m }
  else if (key === 'name') { nameText.value = m.displayName; dialog.value = { kind: 'name', member: m } }
  else if (key === 'leave' || key === 'ownerLeave') dialog.value = { kind: key }
}

function put(m: TeamMember | undefined) {
  if (!m) return void load()
  members.value = members.value.map((x) => (x.id === m.id ? m : x))
}
/** 人不在了（别人刚把他移除）之类：名单已经过时，重读 */
function failed(err: unknown): string {
  if (apiErrorCode(err) === 'team.member_not_found') void load()
  return page.explain(err)
}

async function setRole(m: TeamMember, role: 'admin' | 'member') {
  try {
    put(unwrap(await teamApi.updateMember(page.teamId, m.id, { role })))
    MessagePlugin.success(t(role === 'admin' ? 'team.members.promoted' : 'team.members.demoted', { name: m.name }))
    // 角色的排序、管理员能做的事都变了
    void load()
  } catch (err) {
    if (apiErrorCode(err) === 'team.member_not_found') void load()
    page.fail(err)
  }
}

function onLimitSaved(m: TeamMember) {
  put(m)
  dialog.value = null
  MessagePlugin.success(t('common.saved'))
  // 改的是自己的上限时，团队详情里「我的上限」也变了
  if (m?.id === meId.value) void page.reload()
}

async function saveName() {
  const d = dialog.value
  if (!d || d.kind !== 'name' || busy.value) return
  busy.value = true
  dialogError.value = ''
  try {
    put(unwrap(await teamApi.updateMember(page.teamId, d.member.id, { displayName: nameText.value.trim() })))
    dialog.value = null
    MessagePlugin.success(t('common.saved'))
    if (d.member.id === meId.value) void page.reload()
  } catch (err) {
    dialogError.value = failed(err)
  } finally {
    busy.value = false
  }
}

async function remove() {
  const d = dialog.value
  if (!d || d.kind !== 'remove' || busy.value) return
  busy.value = true
  dialogError.value = ''
  try {
    removed.value = unwrap(await teamApi.removeMember(page.teamId, d.member.id))
    // 人数变了：名单、团队详情、空间切换器里的「N 名成员」
    void load()
    void page.reload()
    void space.refresh()
  } catch (err) {
    dialogError.value = failed(err)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.mb-bar { gap: 12px; margin-bottom: 16px; }
.mb-count { font: 500 14px/1.4 var(--f-disp); color: var(--text); white-space: nowrap; }
.mb-count b { font-weight: 600; }
.mb-search { flex: 0 1 240px; min-width: 160px; }
.mb-role { flex: none; width: 132px; }
.mb-why { display: flex; align-items: center; gap: 8px; margin: -4px 0 14px; color: var(--text-3); font-size: 13px; line-height: 1.6; }
.mb-why :deep(svg) { flex: none; }
.mb-card { overflow: hidden; }
.mb-table th { padding-top: 12px; padding-bottom: 12px; }
.mb-table th:first-child, .mb-table td:first-child { padding-left: 20px; }
.mb-table th:last-child, .mb-table td:last-child { padding-right: 20px; }
.mb-table.wide { min-width: 920px; }
.mb-table .right { text-align: right; }
.mb-table th.num { text-align: right; font-family: var(--f-body); }
.mb-table td { white-space: nowrap; }
.mb-who { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.mb-who-t { display: grid; min-width: 0; line-height: 1.35; }
.mb-who-t b { color: var(--text); font-weight: 500; font-size: 14px; }
.mb-who-t small { color: var(--text-3); font-size: 11px; }
.mb-you { color: var(--text-3); font-weight: 400; margin-left: 4px; }
.mb-tags { display: inline-flex; gap: 6px; }
.mb-sub { display: block; margin-top: 2px; color: var(--text-3); font: 11px/1.4 var(--f-body); white-space: nowrap; }
.mb-sub.warn { color: var(--warn); }
.c-limit { width: 30%; min-width: 250px; padding-left: 24px !important; }
.mb-date { font-size: 12px; }
.mb-state { padding: 20px; }
.mb-state .lc-btn { margin-top: 10px; }
.mb-sk { display: grid; gap: 22px; padding: 24px 20px; }
.mb-sk i { display: block; height: 16px; border-radius: 6px; background: rgb(var(--c-film) / .1); animation: lc-pulse 1.6s ease-in-out infinite; }
.mb-sk i:nth-child(odd) { width: 72%; } .mb-sk i:nth-child(even) { width: 54%; }
@media (max-width: 600px) {
  .mb-count { flex-basis: 100%; }
  .mb-search { flex: 1 1 140px; min-width: 0; }
  .mb-bar > .lc-sp { display: none; }
  .mb-bar > .lc-btn.primary { flex: 1 1 100%; }
  .mb-table th:first-child, .mb-table td:first-child { padding-left: 16px; }
  .mb-table th:last-child, .mb-table td:last-child { padding-right: 16px; }
}
</style>
