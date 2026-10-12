<template>
  <SettingsSection id="users" icon="users" :title="t('account.users.title')" :desc="t('account.users.desc')">
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
            v-model.trim="query" class="lc-input" type="text" autocomplete="off" spellcheck="false"
            :placeholder="t('account.users.searchPh')" :aria-label="t('account.users.searchPh')" data-testid="users-search"
          />
        </label>
        <div class="lc-seg" role="group" :aria-label="t('account.users.col.status')">
          <button
            v-for="f in FILTERS" :key="f" type="button" :class="{ on: filter === f }" :aria-pressed="filter === f"
            :data-filter="f" @click="filter = f"
          >{{ t('account.users.filter.' + f) }}<small v-if="f !== 'all'">{{ tally[f] }}</small></button>
        </div>
        <span class="total" data-testid="users-total">{{ t('account.users.total', { n: users.length }) }}</span>
      </div>

      <div class="tbl-wrap">
        <table class="lc-table users" data-testid="users-table">
          <thead>
            <tr>
              <th>{{ t('account.users.col.user') }}</th>
              <th>{{ t('account.users.col.role') }}</th>
              <th>{{ t('account.users.col.status') }}</th>
              <th>{{ t('account.users.col.lastLogin') }}</th>
              <th class="num">{{ t('account.users.col.canvases') }}</th>
              <th class="num">{{ t('account.users.col.runs') }}</th>
              <th class="ops">{{ t('account.users.col.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in shown" :key="u.id" :data-user="u.username">
              <td class="c-user">
                <div class="idn">
                  <span class="av" :class="{ own: u.role === 'owner' }" aria-hidden="true">{{ u.username.slice(0, 1).toUpperCase() }}</span>
                  <div class="nm">
                    <b>
                      <span class="un">{{ u.username }}</span>
                      <span v-if="isSelf(u)" class="you">{{ t('account.users.you') }}</span>
                      <span v-if="u.mustChangePassword" class="lc-tag warn pend" :title="t('account.users.mustChangeTip')" data-testid="users-must-change">{{ t('account.users.mustChange') }}</span>
                    </b>
                    <small>{{ u.email || t('account.users.noEmail') }}</small>
                  </div>
                </div>
              </td>
              <td :data-label="t('account.users.col.role')">
                <span class="lc-bd" :class="{ own: u.role === 'owner' }">{{ u.role === 'owner' ? t('shell.roleOwner') : t('shell.roleUser') }}</span>
              </td>
              <td :data-label="t('account.users.col.status')">
                <span class="lc-st" :class="u.disabled ? 'wait' : 'ok'">{{ u.disabled ? t('account.users.disabled') : t('account.users.active') }}</span>
              </td>
              <td :data-label="t('account.users.col.lastLogin')" class="when">
                <span>{{ formatWhen(u.lastLoginAt, app.locale) || t('account.users.never') }}</span>
                <small>{{ t('account.users.joined', { day: formatDay(u.createdAt, app.locale) || '—' }) }}</small>
              </td>
              <td :data-label="t('account.users.col.canvases')" class="num">{{ count(u.counts?.workflows) }}</td>
              <td :data-label="t('account.users.col.runs')" class="num">{{ count(u.counts?.runs) }}</td>
              <td class="ops">
                <!-- 超级管理员自己这一行没有停用 / 删除；自己的密码在「账号与安全」里改 -->
                <div v-if="u.role !== 'owner' && !isSelf(u)" class="ops-row">
                  <button class="lc-btn sm" type="button" :disabled="busyId === u.id" data-act="toggle" @click="toggleDisabled(u)">
                    {{ u.disabled ? t('account.users.enable') : t('account.users.disable') }}
                  </button>
                  <button class="lc-btn sm" type="button" :disabled="busyId === u.id" data-act="reset" :title="t('account.users.resetTitle')" @click="resetTarget = u">
                    {{ t('account.users.resetShort') }}
                  </button>
                  <button class="lc-btn sm danger" type="button" :disabled="busyId === u.id" data-act="delete" @click="askDelete(u)">
                    {{ t('common.delete') }}
                  </button>
                </div>
                <router-link v-else-if="isSelf(u)" class="self" :to="{ name: 'settings', params: { section: 'account' } }">{{ t('shell.account') }}</router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!shown.length" class="lc-empty none" data-testid="users-nomatch">{{ t('account.users.noMatch') }}</p>
      <p v-else-if="!hasOthers" class="lc-empty none" data-testid="users-empty">{{ t('account.users.empty') }}</p>
    </section>

    <!-- 重置密码：先确认 -->
    <div v-if="resetTarget" class="lc-mask" @click.self="!resetting && (resetTarget = null)">
      <div class="lc-dialog dlg" role="dialog" aria-modal="true">
        <div class="lc-dialog-head"><span>{{ t('account.users.resetTitle') }}</span></div>
        <div class="lc-dialog-body">
          <p>{{ t('account.users.resetText', { name: resetTarget.username }) }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="resetting" @click="resetTarget = null">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary quiet" :disabled="resetting" data-testid="users-reset-ok" @click="doReset">{{ t('account.users.reset') }}</button>
        </div>
      </div>
    </div>

    <!-- 临时密码：只显示这一次 -->
    <div v-if="temp" class="lc-mask">
      <div class="lc-dialog dlg" role="dialog" aria-modal="true" data-testid="users-temp-dialog">
        <div class="lc-dialog-head"><span>{{ t('account.users.tempTitle', { name: temp.username }) }}</span></div>
        <div class="lc-dialog-body">
          <div class="temp">
            <code data-testid="users-temp-password">{{ temp.password }}</code>
            <button class="lc-btn sm" type="button" @click="copyTemp"><LcIcon name="copy" size="s" />{{ copied ? t('common.copied') : t('common.copy') }}</button>
          </div>
          <div class="lc-alert warn once"><LcIcon name="warn" /><span>{{ t('account.users.tempOnce') }}</span></div>
          <p>{{ t('account.users.tempPass', { name: temp.username }) }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn primary quiet" data-testid="users-temp-close" @click="closeTemp">{{ t('account.users.tempDone') }}</button>
        </div>
      </div>
    </div>

    <!-- 删除：要敲一遍用户名 -->
    <div v-if="delTarget" class="lc-mask" @click.self="!deleting && (delTarget = null)">
      <form class="lc-dialog dlg" role="dialog" aria-modal="true" @submit.prevent="doDelete">
        <div class="lc-dialog-head"><span>{{ t('account.users.deleteTitle', { name: delTarget.username }) }}</span></div>
        <div class="lc-dialog-body">
          <p>{{ t('account.users.deleteText') }}</p>
          <div class="del-fld">
            <label for="users-del-confirm">{{ t('account.users.deleteType', { name: delTarget.username }) }}</label>
            <input
              id="users-del-confirm" ref="delInput" v-model="delText" class="lc-input" :class="{ 'is-err': delError }"
              autocomplete="off" spellcheck="false" :placeholder="delTarget.username" :disabled="deleting"
              @input="delError = ''"
            />
            <span v-if="delError" class="lc-help err" role="alert">{{ delError }}</span>
          </div>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" :disabled="deleting" @click="delTarget = null">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" type="submit" :disabled="deleting || delText !== delTarget.username" data-testid="users-delete-ok">{{ t('account.users.deleteOk') }}</button>
        </div>
      </form>
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * 用户管理（仅超级管理员）：看谁在用这台实例，搜索 / 按状态筛，停用 / 启用、重置密码、删除。
 * 还在用临时密码（重置后没换、或超级管理员的初始密码没换）的账号带一个「待改密码」的标记。
 * 重置出来的临时密码只在弹窗里显示一次：不进日志、不进提示条，关掉就从内存里清掉。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { ownerApi, unwrap, apiErrorCode, apiErrorMessage } from '@/utils/api'
import { useAppStore } from '@/stores/app'
import LcIcon from '@/components/LcIcon.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsCard from './SettingsCard.vue'
import { formatDay, formatWhen } from './when'
import type { AdminUser } from '@/types'

const { t } = useI18n()
const app = useAppStore()

const users = ref<AdminUser[]>([])
const loading = ref(true)
const loadError = ref('')
const busyId = ref('')

const FILTERS = ['all', 'active', 'disabled', 'pending'] as const
type Filter = typeof FILTERS[number]
const query = ref('')
const filter = ref<Filter>('all')

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
    // 接口只回这个人的基本信息，画布 / 运行数沿用列表里的
    users.value = users.value.map(x => (x.id === u.id ? { ...x, ...next } : x))
    MessagePlugin.success(next.disabled ? t('account.users.disabledDone', { name: u.username }) : t('account.users.enabledDone', { name: u.username }))
  } catch (err) {
    MessagePlugin.error(describe(err))
  } finally {
    busyId.value = ''
  }
}

// ---- 重置密码 ----
const resetTarget = ref<AdminUser | null>(null)
const resetting = ref(false)
const temp = ref<{ username: string; password: string } | null>(null)
const copied = ref(false)

async function doReset() {
  const u = resetTarget.value
  if (!u) return
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
const deleting = ref(false)
const delInput = ref<HTMLInputElement | null>(null)

function askDelete(u: AdminUser) {
  delTarget.value = u
  delText.value = ''
  delError.value = ''
  void nextTick(() => delInput.value?.focus())
}

async function doDelete() {
  const u = delTarget.value
  if (!u || delText.value !== u.username) return
  deleting.value = true
  try {
    unwrap(await ownerApi.removeUser(u.id, delText.value))
    users.value = users.value.filter(x => x.id !== u.id)
    delTarget.value = null
    MessagePlugin.success(t('account.users.deletedDone', { name: u.username }))
  } catch (err) {
    delError.value = describe(err)
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
@import './section-shared.css';

/* 表格要不要折成卡片看的是这张卡片自己有多宽，不是视口 */
.list { min-width: 0; overflow: hidden; container-type: inline-size; }
.bar { display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.find { position: relative; flex: 1 1 220px; max-width: 300px; min-width: 0; }
.find > .lc-ic { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.find .lc-input { height: 36px; padding-left: 34px; }
.lc-seg small { font: 11px var(--f-mono); color: var(--text-3); }
.total { margin-left: auto; font-size: 12px; color: var(--text-3); white-space: nowrap; }

.tbl-wrap { overflow-x: auto; }
.users th, .users td { padding-left: 8px; padding-right: 8px; }
.users th:first-child, .users td:first-child { padding-left: 20px; }
.users th:last-child, .users td:last-child { padding-right: 20px; }
.users td { padding-top: 14px; padding-bottom: 14px; }
.users tbody tr:first-child td { border-top: 0; }
.users tbody tr:hover td { background: rgb(var(--c-film) / .04); }
.idn { display: flex; align-items: center; gap: 12px; min-width: 0; }
.av {
  flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  font: 600 13px var(--f-disp); color: var(--text-2); background: rgb(var(--c-film) / .14);
}
.av.own { color: var(--cyan-soft); background: rgb(var(--c-cyan) / .14); }
.nm { min-width: 0; }
.c-user { min-width: 180px; max-width: 230px; }
.nm b { display: flex; align-items: center; gap: 6px; font-weight: 500; color: var(--text); min-width: 0; }
.un { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nm small { display: block; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.you { flex: none; font-size: 12px; font-weight: 400; color: var(--text-3); }
.pend { flex: none; height: 20px; padding: 0 6px; font-weight: 400; }
.lc-bd.own { color: var(--cyan-soft); background: rgb(var(--c-cyan) / .12); }
.when { white-space: nowrap; font-size: 13px; }
.when span, .when small { display: block; }
.when small { font-size: 12px; color: var(--text-3); margin-top: 1px; }
.ops { text-align: right; white-space: nowrap; }
.ops-row { display: inline-flex; gap: 6px; }
.self { font-size: 12px; color: var(--cyan-soft); }
.none { padding: 28px 16px; border-top: 1px solid var(--line); }

.temp {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 14px;
  border-radius: var(--r-sm); border: 1px solid var(--line-2); background: var(--well);
}
.temp code { flex: 1; min-width: 0; font: 500 16px/1.4 var(--f-mono); color: var(--text); word-break: break-all; user-select: all; }
.once { margin-bottom: 12px; }
.del-fld { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.del-fld label { font-size: 13px; color: var(--text-2); }

/* 放不下一张表：一行变成一张卡片 */
@container (max-width: 860px) {
  .bar { padding: 14px 16px; }
  .find { max-width: none; flex-basis: 100%; }
  .total { margin-left: 0; }
  .tbl-wrap { overflow: visible; padding: 12px 12px 2px; }
  .users, .users tbody, .users tr, .users td { display: block; }
  .users thead { display: none; }
  .users tr { border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 14px; margin-bottom: 10px; background: rgb(var(--c-well) / .25); }
  .users tbody tr:hover td { background: none; }
  .users td, .users td:first-child, .users td:last-child { border: 0; padding: 5px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: right; }
  .users td[data-label]::before { content: attr(data-label); color: var(--text-3); font: 12px var(--f-body); text-align: left; flex: none; }
  .users td.c-user { display: block; max-width: none; text-align: left; padding-bottom: 8px; }
  .nm b { flex-wrap: wrap; }
  .when small { display: none; }
  .users td.ops { padding: 0; }
  .users td.ops .ops-row { display: flex; flex-wrap: wrap; width: 100%; padding-top: 10px; margin-top: 6px; border-top: 1px solid var(--line); }
  .users td.ops .lc-btn { flex: 1 1 auto; }
  .users td.ops .self { display: block; width: 100%; padding-top: 10px; margin-top: 6px; border-top: 1px solid var(--line); text-align: left; }
}
</style>
