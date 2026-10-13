<template>
  <SettingsSection id="users" icon="user" :title="t('account.users.title')" :desc="t('account.users.desc')">
    <template #action>
      <button class="lc-btn" type="button" :disabled="loading" data-testid="users-refresh" @click="load">
        <LcIcon name="refresh" size="s" />{{ t('account.users.refresh') }}
      </button>
    </template>

    <SettingsCard v-if="loading && !users.length">
      <div class="sk" aria-busy="true"><i /><i /><i /></div>
    </SettingsCard>
    <SettingsCard v-else-if="loadError">
      <div class="sec-state">
        <p class="lc-error-text">{{ loadError }}</p>
        <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
      </div>
    </SettingsCard>

    <section v-else class="lc-card list">
      <!-- 搜索 + 按状态筛 -->
      <div class="bar">
        <label class="find">
          <LcIcon name="search" size="s" />
          <input
            ref="searchEl" v-model.trim="query" class="lc-input" type="text" autocomplete="off" spellcheck="false"
            :placeholder="t('account.users.searchPh')" :aria-label="t('account.users.searchPh')" data-testid="users-search"
          />
        </label>
        <div class="lc-seg" role="group" :aria-label="t('account.users.col.status')">
          <button
            v-for="f in FILTERS" :key="f" type="button" :class="{ on: filter === f }" :aria-pressed="filter === f"
            :data-filter="f" @click="filter = f"
          >{{ t('account.users.filter.' + f) }}<small v-if="f !== 'all'">{{ tally[f] }}</small></button>
        </div>
        <span class="total" data-testid="users-total">{{ t('account.users.total', { n: users.length }, users.length) }}</span>
      </div>

      <div class="tbl-wrap">
        <table class="lc-table users" data-testid="users-table">
          <thead>
            <tr>
              <th class="c-user">{{ t('account.users.col.user') }}</th>
              <th class="c-role">{{ t('account.users.col.role') }}</th>
              <th class="c-status">{{ t('account.users.col.status') }}</th>
              <th class="c-when">{{ t('account.users.col.lastLogin') }}</th>
              <th class="c-teams">{{ t('account.users.col.teams') }}</th>
              <th class="num c-n1">{{ t('account.users.col.canvases') }}</th>
              <th class="num c-n2">{{ t('account.users.col.runs') }}</th>
              <th class="ops"><span class="sr">{{ t('account.users.col.actions') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in shown" :key="u.id" :data-user="u.username">
              <td class="c-user">
                <div class="idn">
                  <span class="av" :class="{ own: u.role === 'owner' }" aria-hidden="true">{{ u.username.slice(0, 1).toUpperCase() }}</span>
                  <div class="nm">
                    <b>
                      <span v-tip="{ text: u.username, clipped: true }" class="un">{{ u.username }}</span>
                      <span v-if="isSelf(u)" class="you">{{ t('account.users.you') }}</span>
                      <!-- 「角色」那一列收起来的宽度上，超级管理员标在名字后面 -->
                      <span v-if="u.role === 'owner'" class="lc-bd own role-in">{{ t('shell.roleOwner') }}</span>
                      <span
                        v-if="u.mustChangePassword" v-tip="t('account.users.mustChangeTip')" class="lc-tag warn pend" tabindex="0"
                        data-testid="users-must-change"
                      >{{ t('account.users.mustChange') }}</span>
                    </b>
                    <small v-tip="{ text: u.email, clipped: true }" class="em">{{ u.email || t('account.users.noEmail') }}</small>
                  </div>
                </div>
              </td>
              <td :data-label="t('account.users.col.role')" class="c-role">
                <span class="lc-bd" :class="{ own: u.role === 'owner' }">{{ u.role === 'owner' ? t('shell.roleOwner') : t('shell.roleUser') }}</span>
              </td>
              <td :data-label="t('account.users.col.status')" class="c-status">
                <span class="lc-st" :class="u.disabled ? 'wait' : 'ok'">{{ u.disabled ? t('account.users.disabled') : t('account.users.active') }}</span>
              </td>
              <td :data-label="t('account.users.col.lastLogin')" class="c-when">
                <span v-tip="{ text: lastLoginText(u), clipped: true }">{{ lastLoginText(u) }}</span>
                <small v-tip="{ text: joinedText(u), clipped: true }">{{ joinedText(u) }}</small>
              </td>
              <td :data-label="t('account.users.col.teams')" class="c-teams">
                <span v-tip="{ text: teamsText(u), clipped: true }" class="tm-n" data-testid="users-teams">{{ teamsText(u) }}</span>
                <span
                  v-if="u.role === 'owner'" v-tip="t('account.users.teams.alwaysTip')" class="lc-tag tm-tag" tabindex="0"
                  data-testid="users-can-create"
                >{{ t('account.users.teams.always') }}</span>
                <span v-else-if="u.canCreateTeams" class="lc-tag accent tm-tag" data-testid="users-can-create">{{ t('account.users.teams.canCreate') }}</span>
              </td>
              <td :data-label="t('account.users.col.canvases')" class="num c-n1">{{ count(u.counts?.workflows) }}</td>
              <td :data-label="t('account.users.col.runs')" class="num c-n2">{{ count(u.counts?.runs) }}</td>
              <td class="ops">
                <!-- 一行的操作都在「更多」里。自己这一行没有停用 / 重置 / 删除，只有去「账号与安全」的入口 -->
                <ActionMenu
                  v-if="menuOf(u).length"
                  :items="menuOf(u)" :label="t('account.users.moreOf', { name: u.username })" :disabled="busyId === u.id"
                  @pick="(k) => onPick(u, k)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!shown.length" class="lc-empty none" data-testid="users-nomatch">{{ t('account.users.noMatch') }}</p>
      <p v-else-if="!hasOthers" class="lc-empty none" data-testid="users-empty">{{ t('account.users.empty') }}</p>
    </section>

    <!-- 重置密码：先确认 -->
    <TeamDialog
      v-if="resetTarget" :title="t('account.users.resetTitle')" :width="440" :busy="resetting" data-testid="users-reset-dialog"
      @close="resetTarget = null" @submit="doReset"
    >
      <p>{{ t('account.users.resetText', { name: resetTarget.username }) }}</p>
      <template #foot>
        <button class="lc-btn" type="button" :disabled="resetting" @click="resetTarget = null">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary quiet" type="submit" :disabled="resetting" data-autofocus data-testid="users-reset-ok">{{ t('account.users.reset') }}</button>
      </template>
    </TeamDialog>

    <!-- 收回创建团队的授权：先确认 -->
    <TeamDialog
      v-if="revokeTarget" :title="t('account.users.teams.revokeTitle')" :width="440" :busy="revoking" data-testid="users-revoke-dialog"
      @close="revokeTarget = null" @submit="doRevoke"
    >
      <p>{{ t('account.users.teams.revokeText', { name: revokeTarget.username }) }}</p>
      <template #foot>
        <button class="lc-btn" type="button" :disabled="revoking" @click="revokeTarget = null">{{ t('common.cancel') }}</button>
        <button class="lc-btn danger" type="submit" :disabled="revoking" data-autofocus data-testid="users-revoke-ok">{{ t('account.users.teams.revokeOk') }}</button>
      </template>
    </TeamDialog>

    <!-- 临时密码：只显示这一次，只能点「我已转交」关 -->
    <TeamDialog
      v-if="temp" :title="t('account.users.tempTitle', { name: temp.username })" :width="440" persistent data-testid="users-temp-dialog"
      @submit="closeTemp"
    >
      <div class="temp">
        <code data-testid="users-temp-password">{{ temp.password }}</code>
        <button class="lc-btn sm" type="button" data-autofocus @click="copyTemp"><LcIcon name="copy" size="s" />{{ copied ? t('common.copied') : t('common.copy') }}</button>
      </div>
      <div class="lc-alert warn once"><LcIcon name="warn" /><span>{{ t('account.users.tempOnce') }}</span></div>
      <p>{{ t('account.users.tempPass', { name: temp.username }) }}</p>
      <template #foot>
        <button class="lc-btn primary quiet" type="submit" data-testid="users-temp-close">{{ t('account.users.tempDone') }}</button>
      </template>
    </TeamDialog>

    <!-- 删除：要敲一遍用户名 -->
    <TeamDialog
      v-if="delTarget" :title="t('account.users.deleteTitle', { name: delTarget.username })" :width="460" :busy="deleting"
      :fallback-focus="() => searchEl" data-testid="users-delete-dialog"
      @close="delTarget = null" @submit="doDelete"
    >
      <p>{{ t('account.users.deleteText') }}</p>
      <!-- 还在团队里：团队里的东西不跟着删，说清楚会怎样 -->
      <p v-if="delTeams > 0" data-testid="users-delete-teams">{{ t('account.users.deleteTeams', { n: delTeams }, delTeams) }}</p>
      <div class="del-fld">
        <!-- 要敲的名字写在这句话里（等宽、点一下整个选中、旁边能复制）；输入框里不放它当占位，那样看着像已经填好了 -->
        <div class="del-ask">
          <i18n-t keypath="account.users.deleteType" tag="label" for="users-del-confirm" scope="global">
            <template #name><code class="del-name" data-testid="users-delete-name">{{ delTarget.username }}</code></template>
          </i18n-t>
          <button
            v-tip="nameCopied ? t('common.copied') : t('common.copy')" type="button" class="lc-tb sm del-copy" :disabled="deleting"
            :aria-label="t('account.users.deleteCopy', { name: delTarget.username })" data-testid="users-delete-copy" @click="copyName"
          ><LcIcon :name="nameCopied ? 'check' : 'copy'" size="s" /></button>
        </div>
        <input
          id="users-del-confirm" v-model="delText" class="lc-input" :class="{ 'is-err': delError && !delOwns }"
          autocomplete="off" spellcheck="false" :placeholder="t('account.users.deletePh')" :disabled="deleting" data-autofocus
          :aria-invalid="(!!delError && !delOwns) || undefined"
          @input="clearDelError"
        />
        <span v-if="delError && !delOwns" class="lc-help err" role="alert">{{ delError }}</span>
      </div>
      <!-- 这个账号还是某个团队的团长：删不了，说清楚两条出路 -->
      <div v-if="delOwns" class="owns" role="alert" data-testid="users-delete-owns">
        <p class="lc-error-text">{{ delError }}</p>
        <p>{{ t('account.users.teams.ownsLead') }}</p>
        <ul>
          <li>{{ t('account.users.teams.ownsWay1') }}</li>
          <li>{{ t('account.users.teams.ownsWay2') }}</li>
        </ul>
        <router-link class="owns-go" :to="{ name: 'settings', params: { section: 'teams' } }">{{ t('account.users.teams.ownsGo') }}</router-link>
      </div>
      <template #foot>
        <button class="lc-btn" type="button" :disabled="deleting" @click="delTarget = null">{{ t('common.cancel') }}</button>
        <button class="lc-btn danger" type="submit" :disabled="deleting || delText !== delTarget.username" data-testid="users-delete-ok">{{ deleting ? t('account.users.deleteBusy') : t('account.users.deleteOk') }}</button>
      </template>
    </TeamDialog>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * 用户管理（仅超级管理员）：看谁在用这台实例，搜索 / 按状态筛，停用 / 启用、重置密码、删除。
 * 团队版：每个账号加入了几个团队、其中几个是团长；能不能创建团队按账号授权。
 * 一行的操作全在行尾的「更多」菜单里（共用的 ActionMenu，键盘可达），所以表格在 1100px 宽的窗口里也排得下；
 * 更窄的窗口先收起次要的列（见样式里的三档），到手机宽度才折成一人一张卡片。
 * 放不下的文字截断，悬停 / 长按时用 v-tip 给出全文（v-tip 的 clipped：没截断就不出）。
 * 还是某个团队团长的账号删不掉（409 team.account_owns_teams）：删除弹窗留着，说清楚先转让团长还是先删团队。
 * 还在用临时密码（重置后没换、或超级管理员的初始密码没换）的账号带一个「待改密码」的标记。
 * 重置出来的临时密码只在弹窗里显示一次：不进日志、不进提示条，关掉就从内存里清掉。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { writeClipboard } from '@/utils/clipboard'
import { ownerApi, unwrap, apiErrorCode, apiErrorMessage } from '@/utils/api'
import { useAppStore } from '@/stores/app'
import LcIcon from '@/components/LcIcon.vue'
import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu.vue'
import TeamDialog from '@/components/team/TeamDialog.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsCard from './SettingsCard.vue'
import { formatDay, formatWhen } from './when'
import type { AdminUser } from '@/types'

const { t } = useI18n()
const app = useAppStore()
const router = useRouter()

const users = ref<AdminUser[]>([])
const loading = ref(true)
const loadError = ref('')
const busyId = ref('')

const FILTERS = ['all', 'active', 'disabled', 'pending'] as const
type Filter = typeof FILTERS[number]
const query = ref('')
const filter = ref<Filter>('all')
const searchEl = ref<HTMLInputElement | null>(null)

const isSelf = (u: AdminUser) => u.id === app.user?.id
/** 超级管理员在最前，其余按注册时间 */
const sorted = computed(() => [...users.value].sort((a, b) => {
  if ((a.role === 'owner') !== (b.role === 'owner')) return a.role === 'owner' ? -1 : 1
  return String(a.createdAt).localeCompare(String(b.createdAt))
}))
const tally = computed(() => ({
  active: users.value.filter(u => !u.disabled).length,
  disabled: users.value.filter(u => u.disabled).length,
  pending: users.value.filter(u => u.mustChangePassword).length,
}))
const shown = computed(() => {
  const q = query.value.toLowerCase()
  return sorted.value.filter((u) => {
    if (filter.value === 'active' && u.disabled) return false
    if (filter.value === 'disabled' && !u.disabled) return false
    if (filter.value === 'pending' && !u.mustChangePassword) return false
    return !q || u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
  })
})
const hasOthers = computed(() => users.value.some(u => !isSelf(u)))
const count = (n?: number) => (typeof n === 'number' ? String(n) : '—')
const lastLoginText = (u: AdminUser) => formatWhen(u.lastLoginAt, app.locale) || t('account.users.never')
const joinedText = (u: AdminUser) => t('account.users.joined', { day: formatDay(u.createdAt, app.locale) || '—' })

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    users.value = unwrap(await ownerApi.users()) || []
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 用户管理接口的失败：认得的错误码用本地文案；那个人已经不在了就顺手刷新列表 */
const KNOWN: Record<string, string> = {
  'auth.user_not_found': 'notFound',
  'auth.cannot_modify_self': 'self',
  'auth.cannot_modify_owner': 'owner',
  'auth.confirm_mismatch': 'confirmMismatch',
}
function describe(err: unknown): string {
  const code = apiErrorCode(err)
  if (code === 'auth.user_not_found') void load()
  return KNOWN[code] ? t('account.users.errors.' + KNOWN[code]) : apiErrorMessage(err, t('common.operationFailed'))
}

async function toggleDisabled(u: AdminUser) {
  busyId.value = u.id
  try {
    const next = unwrap(await ownerApi.setUserDisabled(u.id, !u.disabled))
    // 接口只回这个人的基本信息，画布 / 运行数、团队数沿用列表里的
    users.value = users.value.map(x => (x.id === u.id ? { ...x, ...next, counts: x.counts, teams: x.teams } : x))
    MessagePlugin.success(next.disabled ? t('account.users.disabledDone', { name: u.username }) : t('account.users.enabledDone', { name: u.username }))
  } catch (err) {
    MessagePlugin.error(describe(err))
  } finally {
    busyId.value = ''
  }
}

// ---- 一行的「更多」菜单 ----
function menuOf(u: AdminUser): ActionMenuItem[] {
  // 自己的账号在「账号与安全」里管
  if (isSelf(u)) return [{ key: 'account', label: t('shell.account'), icon: 'shield' }]
  // 超级管理员账号不能在这里停用、重置或删除
  if (u.role === 'owner') return []
  return [
    u.disabled
      ? { key: 'toggle', label: t('account.users.enable'), icon: 'check' }
      : { key: 'toggle', label: t('account.users.disable'), icon: 'pause' },
    { key: 'reset', label: t('account.users.reset'), icon: 'key' },
    u.canCreateTeams
      ? { key: 'revoke', label: t('account.users.teams.revoke'), icon: 'lock' }
      : { key: 'grant', label: t('account.users.teams.grant'), icon: 'users' },
    { key: 'delete', label: t('account.users.deleteAction'), icon: 'trash', danger: true },
  ]
}
function onPick(u: AdminUser, key: string) {
  if (key === 'account') void router.push({ name: 'settings', params: { section: 'account' } })
  else if (key === 'toggle') void toggleDisabled(u)
  else if (key === 'reset') resetTarget.value = u
  else if (key === 'grant') void setCanCreate(u, true)
  else if (key === 'revoke') revokeTarget.value = u
  else if (key === 'delete') askDelete(u)
}

// ---- 团队：在几个团队里、能不能创建团队 ----
function teamsText(u: AdminUser): string {
  const m = u.teams?.member || 0
  const o = u.teams?.owned || 0
  if (!m && !o) return '—'
  return o ? t('account.users.teams.memberOwned', { m, o }) : t('account.users.teams.member', { m })
}
const revokeTarget = ref<AdminUser | null>(null)
const revoking = ref(false)

async function setCanCreate(u: AdminUser, on: boolean) {
  busyId.value = u.id
  try {
    const next = unwrap(await ownerApi.setUserCanCreateTeams(u.id, on))
    // 接口只回这个人的基本信息，团队数 / 画布数沿用列表里的
    users.value = users.value.map(x => (x.id === u.id ? { ...x, ...next, counts: x.counts, teams: x.teams } : x))
    MessagePlugin.success(t(on ? 'account.users.teams.granted' : 'account.users.teams.revoked', { name: u.username }))
  } catch (err) {
    MessagePlugin.error(describe(err))
  } finally {
    busyId.value = ''
  }
}
async function doRevoke() {
  const u = revokeTarget.value
  if (!u || revoking.value) return
  revoking.value = true
  await setCanCreate(u, false)
  revoking.value = false
  revokeTarget.value = null
}

// ---- 重置密码 ----
const resetTarget = ref<AdminUser | null>(null)
const resetting = ref(false)
const temp = ref<{ username: string; password: string } | null>(null)
const copied = ref(false)

async function doReset() {
  const u = resetTarget.value
  if (!u || resetting.value) return
  resetting.value = true
  try {
    const { temporaryPassword } = unwrap(await ownerApi.resetUserPassword(u.id))
    resetTarget.value = null
    copied.value = false
    temp.value = { username: u.username, password: temporaryPassword }
    // 这个账号现在拿的是临时密码：列表上立刻标出来
    users.value = users.value.map(x => (x.id === u.id ? { ...x, mustChangePassword: true } : x))
  } catch (err) {
    resetTarget.value = null
    MessagePlugin.error(describe(err))
  } finally {
    resetting.value = false
  }
}

async function copyTemp() {
  if (!temp.value) return
  try {
    await navigator.clipboard.writeText(temp.value.password)
    copied.value = true
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}

function closeTemp() {
  temp.value = null
  copied.value = false
}

// ---- 删除 ----
const delTarget = ref<AdminUser | null>(null)
const delText = ref('')
const delError = ref('')
/** 删不掉是因为这个账号还是团长：错误原样留着（里面有团队名），输入框改动也不清掉 */
const delOwns = ref(false)
const deleting = ref(false)

/** 要删的这个账号还在几个团队里（是团长的那些删不了，服务端会拦下来并说明） */
const delTeams = computed(() => delTarget.value?.teams?.member || 0)

function clearDelError() {
  if (!delOwns.value) delError.value = ''
}

function askDelete(u: AdminUser) {
  delTarget.value = u
  delText.value = ''
  delError.value = ''
  delOwns.value = false
  nameCopied.value = false
}

/** 复制要敲的那个用户名（长的、带下划线的名字照着敲容易错） */
const nameCopied = ref(false)
async function copyName() {
  if (!delTarget.value) return
  try {
    await writeClipboard(delTarget.value.username)
    nameCopied.value = true
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}

async function doDelete() {
  const u = delTarget.value
  if (!u || deleting.value || delText.value !== u.username) return
  deleting.value = true
  try {
    const out = unwrap(await ownerApi.removeUser(u.id, delText.value))
    users.value = users.value.filter(x => x.id !== u.id)
    delTarget.value = null
    // 账号和数据已经删了；存储里的文件没删干净时服务端会说，这里照实转告
    if (out && out.filesRemoved === false) MessagePlugin.warning(t('account.users.deletedFilesLeft', { name: u.username }))
    else MessagePlugin.success(t('account.users.deletedDone', { name: u.username }))
  } catch (err) {
    // 弹窗不关：还是团长的账号要先把团队交出去或者删掉，回来再点一次
    delOwns.value = apiErrorCode(err) === 'team.account_owns_teams'
    delError.value = describe(err)
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
@import './section-shared.css';

/* 表格排成哪一档看的是这张卡片自己有多宽，不是视口 */
.list { min-width: 0; overflow: hidden; container-type: inline-size; }
.bar { display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.find { position: relative; flex: 1 1 180px; max-width: 300px; min-width: 0; }
.find > .lc-ic { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.find .lc-input { height: 36px; padding-left: 34px; }
.lc-seg small { font: 11px var(--f-mono); color: var(--text-3); }
.total { margin-left: auto; font-size: 12px; color: var(--text-3); white-space: nowrap; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* 列宽写死（table-layout: fixed），「用户」那一列吃掉剩下的宽度；格子里的文字放不下就截断，不把表格撑出卡片 */
.users { table-layout: fixed; }
.users th, .users td { padding-left: 8px; padding-right: 8px; }
.users th:first-child, .users td:first-child { padding-left: 20px; }
.users th:last-child, .users td:last-child { padding-right: 16px; }
.users th { overflow: hidden; text-overflow: ellipsis; }
.users td { padding-top: 14px; padding-bottom: 14px; }
.users tbody tr:first-child td { border-top: 0; }
.users tbody tr:hover td { background: rgb(var(--c-film) / .04); }
/* 表头是字，不是数：右对齐留着，等宽字体不要（全局的 .num 是给数字用的） */
.users th.num { font-family: inherit; }
.users th.c-role { width: 108px; }
.users th.c-status { width: 88px; }
.users th.c-when { width: 152px; }
.users th.c-teams { width: 140px; }
.users th.c-n1 { width: 76px; }
.users th.c-n2 { width: 60px; }
.users th.ops { width: 56px; }
.idn { display: flex; align-items: center; gap: 12px; min-width: 0; }
.av {
  flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  font: 600 13px var(--f-disp); color: var(--text-2); background: rgb(var(--c-film) / .14);
}
.av.own { color: var(--cyan-soft); background: rgb(var(--c-cyan) / .14); }
.nm { min-width: 0; flex: 1; }
.nm b { display: flex; align-items: center; gap: 2px 6px; flex-wrap: wrap; font-weight: 500; color: var(--text); min-width: 0; }
.un { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; max-width: 100%; }
.nm small { display: block; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.you { flex: none; font-size: 12px; font-weight: 400; color: var(--text-3); }
/* 标记比这一列还宽的时候（英文、窄窗口）自己截断，不撑出格子；悬停 / 聚焦有完整的说明 */
.pend { display: block; flex: 0 1 auto; min-width: 0; max-width: 100%; height: 20px; line-height: 20px; padding: 0 6px; font-weight: 400; cursor: default; overflow: hidden; text-overflow: ellipsis; }
.pend:focus-visible, .tm-tag:focus-visible { outline: none; box-shadow: var(--ring); }
.lc-bd.own { color: var(--cyan-soft); background: rgb(var(--c-cyan) / .12); }
.role-in { display: none; flex: none; font-weight: 400; }
.c-when { font-size: 13px; }
.c-when span, .c-when small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-when small { font-size: 12px; color: var(--text-3); margin-top: 1px; }
.ops { text-align: right; white-space: nowrap; }
.c-teams { font-size: 13px; }
.tm-n { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-tag { display: block; width: fit-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px; height: 20px; line-height: 20px; padding: 0 6px; }
.owns { margin-top: 14px; padding: 12px 14px; border-radius: var(--r-sm); border: 1px solid rgb(var(--c-err) / .4); background: var(--danger-dim); }
.owns p { font-size: 13px; }
.owns p + p { margin-top: 8px; }
.owns ul { margin: 6px 0 0; padding-left: 20px; font-size: 13px; line-height: 1.7; color: var(--text-2); }
.owns-go { display: inline-block; margin-top: 8px; font-size: 13px; color: var(--cyan-soft); }
.none { padding: 28px 16px; border-top: 1px solid var(--line); }

.temp {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 14px;
  border-radius: var(--r-sm); border: 1px solid var(--line-2); background: var(--well);
}
.temp code { flex: 1; min-width: 0; font: 500 16px/1.4 var(--f-mono); color: var(--text); word-break: break-all; user-select: all; }
.once { margin-bottom: 12px; }
.del-fld { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.del-ask { display: flex; align-items: center; gap: 6px; min-width: 0; }
.del-fld label { min-width: 0; font-size: 13px; line-height: 1.7; color: var(--text-2); overflow-wrap: anywhere; }
.del-name {
  padding: 2px 6px; border-radius: 6px; border: 1px solid var(--line-2); background: var(--well);
  font: 500 13px/1.4 var(--f-mono); color: var(--text); user-select: all; white-space: nowrap;
}
.del-copy { flex: none; }

/*
 * 表格分三档，看的是卡片自己的宽度（窗口 1100px 时卡片约 750px；900–1024px 的窗口和竖着的平板约 550–680px）：
 *   ≥900px      八列全在；
 *   740–899px   「角色」并进名字后面，注册日期收起来，各列收窄；
 *   540–739px   再收起头像和「画布」「运行」两列（次要的数字，手机卡片和宽屏上都有），搜索框自己占一行；
 *   <540px      手机：一人一张卡片。
 * 分界按「用户」那一列至少还剩 210px 左右来定：再窄名字和邮箱就大半被截掉了。
 */
@container (min-width: 540px) and (max-width: 899px) {
  .users .c-role { display: none; }
  .role-in { display: inline-flex; }
  .c-when small { display: none; }
  .users th.c-when { width: 116px; }
  .users th.c-n2 { width: 52px; }
  .users th.ops { width: 52px; }
}
@container (min-width: 540px) and (max-width: 739px) {
  .users .c-n1, .users .c-n2, .av { display: none; }
  .users th.c-teams { width: 132px; }
  .find { max-width: none; flex-basis: 100%; }
  .total { margin-left: auto; }
}

/* 放不下一张表（手机）：一行变成一张卡片，「更多」在卡片右上角 */
@container (max-width: 539px) {
  .bar { padding: 14px 16px; }
  .find { max-width: none; flex-basis: 100%; }
  .total { margin-left: 0; }
  .tbl-wrap { padding: 12px 12px 2px; }
  .users, .users tbody, .users tr, .users td { display: block; }
  .users thead { display: none; }
  .users tr { position: relative; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 14px; margin-bottom: 10px; background: rgb(var(--c-well) / .25); }
  .users tbody tr:hover td { background: none; }
  .users td, .users td:first-child, .users td:last-child { border: 0; padding: 5px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: right; }
  .users td[data-label]::before { content: attr(data-label); color: var(--text-3); font: 12px var(--f-body); text-align: left; flex: none; }
  .users td.c-user { display: block; max-width: none; text-align: left; padding: 0 40px 8px 0; }
  .users td.c-when { flex-wrap: wrap; row-gap: 0; }
  .users td.c-when > span { min-width: 0; }
  .users td.c-when > small { flex-basis: 100%; }
  .users td.c-teams { flex-wrap: wrap; justify-content: flex-end; }
  .users td.c-teams::before { margin-right: auto; }
  .tm-n, .tm-tag { display: inline-flex; }
  .tm-tag { margin-top: 0; }
  .users td.ops, .users td.ops:last-child { position: absolute; top: 12px; right: 10px; padding: 0; display: block; }
}
</style>
