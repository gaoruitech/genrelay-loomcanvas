<template>
  <section class="lc-card rq" data-testid="teams-requests">
    <header class="rq-head">
      <div class="rq-t">
        <h3>{{ t('settings.teams.requests.title') }}<span v-if="pending > 0" class="lc-tag warn" data-testid="teams-requests-pending">{{ t('settings.teams.requests.pendingN', { n: pending }) }}</span></h3>
        <p>{{ t('settings.teams.requests.desc') }}</p>
      </div>
      <div class="lc-seg" role="group" :aria-label="t('settings.teams.requests.filterLabel')">
        <button
          v-for="s in STATUSES" :key="s" type="button" :class="{ on: status === s }" :aria-pressed="status === s"
          :data-status="s" @click="pick(s)"
        >{{ t('settings.teams.requests.tab.' + s) }}<small v-if="s === 'pending' && pending > 0">{{ pending }}</small></button>
      </div>
    </header>

    <div v-if="loading && !rows.length" class="pad"><div class="sk" aria-busy="true"><i /><i /><i /></div></div>
    <div v-else-if="loadError" class="pad sec-state">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm" type="button" @click="load">{{ t('common.retry') }}</button>
    </div>
    <p v-else-if="!rows.length" class="lc-empty" data-testid="teams-requests-empty">{{ t('settings.teams.requests.empty.' + status) }}</p>

    <ul v-else class="rq-list" :class="{ dim: loading }">
      <li v-for="r in rows" :key="r.id" class="rq-row" :data-request="r.user.username" :data-status="r.status">
        <SpaceAvatar :name="r.user.username || '?'" :seed="r.user.id" shape="round" :size="32" />
        <div class="rq-main">
          <div class="rq-who">
            <b>{{ r.user.username || t('settings.teams.requests.goneUser') }}</b>
            <span v-if="r.user.email" class="mail">{{ r.user.email }}</span>
            <span v-if="r.user.disabled" class="lc-tag err">{{ t('settings.teams.requests.userDisabled') }}</span>
            <span v-if="r.user.canCreateTeams" class="lc-tag ok">{{ t('settings.teams.requests.userAuthorised') }}</span>
          </div>
          <p v-if="r.note" class="rq-note">{{ r.note }}</p>
          <p v-else class="rq-note none">{{ t('settings.teams.requests.noNote') }}</p>
          <p class="rq-meta">
            <span>{{ t('settings.teams.requests.submitted', { time: formatDateTime(r.createdAt) }) }}</span>
            <template v-if="r.status !== 'pending'">
              <span class="lc-tag" :class="r.status === 'approved' ? 'ok' : 'err'">{{ t('settings.teams.requests.status.' + r.status) }}</span>
              <span v-if="r.decidedAt">{{ t('settings.teams.requests.decided', { time: formatDateTime(r.decidedAt) }) }}</span>
            </template>
          </p>
          <p v-if="r.status === 'rejected' && r.reason" class="rq-reason">{{ t('settings.teams.requests.reasonLine', { reason: r.reason }) }}</p>
        </div>
        <div v-if="r.status === 'pending'" class="rq-ops">
          <button class="lc-btn sm" type="button" :disabled="busyId === r.id" data-act="reject" @click="askReject(r)">{{ t('settings.teams.requests.reject') }}</button>
          <button
            class="lc-btn sm primary quiet" type="button" :disabled="busyId === r.id" data-act="approve"
            v-tip="t('settings.teams.requests.approveTip')" @click="approveTarget = r"
          >{{ t('settings.teams.requests.approve') }}</button>
        </div>
      </li>
    </ul>

    <div v-if="total > PAGE_SIZE" class="lc-pager">
      <span>{{ t('settings.teams.requests.range', { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(total, page * PAGE_SIZE), total }) }}</span>
      <span class="lc-sp" />
      <button class="lc-pg" type="button" :disabled="page <= 1 || loading" v-tip="t('settings.teams.requests.prev')" :aria-label="t('settings.teams.requests.prev')" @click="go(page - 1)">
        <LcIcon name="chev" size="s" class="flip" />
      </button>
      <span class="pg-n">{{ page }} / {{ pages }}</span>
      <button class="lc-pg" type="button" :disabled="page >= pages || loading" v-tip="t('settings.teams.requests.next')" :aria-label="t('settings.teams.requests.next')" @click="go(page + 1)">
        <LcIcon name="chev" size="s" />
      </button>
    </div>

    <!-- 批准：说清楚这是给账号授权 -->
    <Teleport :to="$lcPortal">
      <div v-if="approveTarget" class="lc-mask lc-sheet" @click.self="!deciding && (approveTarget = null)">
        <div v-dialog="{ onEscape: () => { approveTarget = null }, busy: deciding }" class="lc-dialog dlg" role="dialog" aria-modal="true" aria-labelledby="teams-approve-h" data-testid="teams-approve-dialog">
          <div class="lc-dialog-head"><span id="teams-approve-h">{{ t('settings.teams.requests.approveTitle') }}</span></div>
          <div class="lc-dialog-body">
            <p>{{ t('settings.teams.requests.approveText', { name: approveTarget.user.username, max: maxPerUser }) }}</p>
            <p v-if="approveTarget.user.disabled" class="lc-error-text">{{ t('settings.teams.requests.approveDisabled') }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" :disabled="deciding" @click="approveTarget = null">{{ t('common.cancel') }}</button>
            <button class="lc-btn primary" type="button" :disabled="deciding" data-autofocus data-testid="teams-approve-ok" @click="doApprove">{{ t('settings.teams.requests.approveOk') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 拒绝：可以写一句原因，对方看得到 -->
    <Teleport :to="$lcPortal">
      <div v-if="rejectTarget" class="lc-mask lc-sheet" @click.self="!deciding && (rejectTarget = null)">
        <form v-dialog="{ onEscape: () => { rejectTarget = null }, busy: deciding }" class="lc-dialog dlg" role="dialog" aria-modal="true" aria-labelledby="teams-reject-h" novalidate data-testid="teams-reject-dialog" @submit.prevent="doReject">
          <div class="lc-dialog-head"><span id="teams-reject-h">{{ t('settings.teams.requests.rejectTitle', { name: rejectTarget.user.username }) }}</span></div>
          <div class="lc-dialog-body">
            <div class="lc-field last">
              <label for="team-reject-reason">{{ t('settings.teams.requests.reasonLabel') }}</label>
              <textarea
                id="team-reject-reason" v-model="reason" class="lc-textarea" rows="3" maxlength="500"
                :placeholder="t('settings.teams.requests.reasonPh')" :disabled="deciding"
              />
              <span class="lc-help">{{ t('settings.teams.requests.reasonHelp') }}</span>
            </div>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" :disabled="deciding" @click="rejectTarget = null">{{ t('common.cancel') }}</button>
            <button class="lc-btn danger" type="submit" :disabled="deciding" data-testid="teams-reject-ok">{{ t('settings.teams.requests.rejectOk') }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
/**
 * 创建团队的申请。批准 = 给那个账号「可以创建团队」的授权；拒绝可以写一句原因，对方看得到，之后还能再申请。
 * 别人先处理了、或者申请人自己撤回了（404 team.request_not_found）：说一声，重新读列表。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { vDialog } from '@/directives/dialog'
import { adminApi, ownerApi, unwrap, apiErrorCode, apiErrorMessage } from '@/utils/api'
import LcIcon from '@/components/LcIcon.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import { formatDateTime } from '@/components/space/format'
import type { AdminTeamRequest } from '@/types'

const { t } = useI18n()

const STATUSES = ['pending', 'approved', 'rejected', 'all'] as const
type Status = typeof STATUSES[number]
const PAGE_SIZE = 10

const status = ref<Status>('pending')
const page = ref(1)
const rows = ref<AdminTeamRequest[]>([])
const total = ref(0)
const pending = ref(0)
const loading = ref(true)
const loadError = ref('')
const busyId = ref('')
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
/** 批准时告诉超级管理员「对方最多能建几个」；读不到就不提这个数 */
const maxPerUser = ref(3)

let seq = 0
async function load() {
  const mine = ++seq
  loading.value = true
  loadError.value = ''
  try {
    const data = unwrap(await ownerApi.teamRequests({ status: status.value, page: page.value, pageSize: PAGE_SIZE }))
    if (mine !== seq) return
    // 这一页被处理空了：退回前一页
    if (!data.list.length && page.value > 1 && data.total > 0) {
      page.value = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
      return void load()
    }
    rows.value = data.list
    total.value = data.total
    pending.value = data.pending
  } catch (err) {
    if (mine !== seq) return
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    if (mine === seq) loading.value = false
  }
}
onMounted(load)

function pick(s: Status) {
  if (status.value === s) return
  status.value = s
  page.value = 1
  rows.value = []
  void load()
}
function go(p: number) {
  page.value = Math.min(pages.value, Math.max(1, p))
  void load()
}

function failed(err: unknown) {
  if (apiErrorCode(err) === 'team.request_not_found') {
    MessagePlugin.warning(t('settings.teams.requests.gone'))
    void load()
  } else {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  }
}

// ---- 批准 ----
const approveTarget = ref<AdminTeamRequest | null>(null)
const deciding = ref(false)

async function doApprove() {
  const r = approveTarget.value
  if (!r) return
  deciding.value = true
  busyId.value = r.id
  try {
    unwrap(await ownerApi.approveTeamRequest(r.id))
    MessagePlugin.success(t('settings.teams.requests.approved', { name: r.user.username }))
    void load()
  } catch (err) {
    failed(err)
  } finally {
    approveTarget.value = null
    deciding.value = false
    busyId.value = ''
  }
}

// ---- 拒绝 ----
const rejectTarget = ref<AdminTeamRequest | null>(null)
const reason = ref('')

function askReject(r: AdminTeamRequest) {
  rejectTarget.value = r
  reason.value = ''
}

async function doReject() {
  const r = rejectTarget.value
  if (!r) return
  deciding.value = true
  busyId.value = r.id
  try {
    unwrap(await ownerApi.rejectTeamRequest(r.id, reason.value.trim() || undefined))
    MessagePlugin.success(t('settings.teams.requests.rejected', { name: r.user.username }))
    void load()
  } catch (err) {
    failed(err)
  } finally {
    rejectTarget.value = null
    deciding.value = false
    busyId.value = ''
  }
}

onMounted(async () => {
  try {
    const s = unwrap(await adminApi.settings())
    if (typeof s?.teamMaxPerUser === 'number') maxPerUser.value = s.teamMaxPerUser
  } catch { /* 只是弹窗里的一个数，读不到就用默认的写法 */ }
})

// 两个弹窗的键盘和焦点交给 v-dialog：批准的落在确认按钮上，拒绝的落在原因框里；Esc 关，关掉后焦点还给那一行的按钮
</script>

<style scoped>
@import './section-shared.css';
.rq { min-width: 0; overflow: hidden; }
.rq-head { display: flex; align-items: flex-start; gap: 12px 20px; flex-wrap: wrap; padding: 18px 24px 16px; border-bottom: 1px solid var(--line); }
.rq-t { flex: 1 1 260px; min-width: 0; }
.rq-t h3 { font: 600 15px/1.5 var(--f-disp); color: var(--text); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rq-t p { color: var(--text-3); font-size: 13px; line-height: 1.65; margin-top: 2px; max-width: 560px; }
.lc-seg small { font: 11px var(--f-mono); color: var(--warn); margin-left: 6px; }
.pad { padding: 20px 24px; }

.rq-list { list-style: none; margin: 0; padding: 0; transition: opacity .15s; }
.rq-list.dim { opacity: .6; }
.rq-row { display: flex; align-items: flex-start; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--line); }
.rq-row:first-child { border-top: 0; }
.rq-main { flex: 1 1 auto; min-width: 0; }
.rq-who { display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; min-height: 22px; }
.rq-who b { font-weight: 500; color: var(--text); font-size: 14px; }
.mail { font-size: 12px; color: var(--text-3); overflow-wrap: anywhere; }
.rq-note { margin-top: 6px; font-size: 13px; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.rq-note.none { color: var(--text-3); }
.rq-meta { margin-top: 6px; display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap; font-size: 12px; color: var(--text-3); }
.rq-reason { margin-top: 6px; font-size: 12px; line-height: 1.6; color: var(--text-2); overflow-wrap: anywhere; }
.rq-ops { flex: none; display: flex; gap: 6px; }
.pg-n { font: 12px var(--f-mono); color: var(--text-3); }
.flip { transform: rotate(180deg); }
.last { margin-bottom: 0; }

@media (max-width: 600px) {
  .rq-head { padding: 16px; }
  .pad { padding: 16px; }
  .rq-row { flex-wrap: wrap; padding: 14px 16px; }
  .rq-main { flex-basis: calc(100% - 44px); }
  .rq-ops { width: 100%; }
  .rq-ops .lc-btn { flex: 1 1 auto; }
  .lc-pager { padding: 12px 16px; }
}
</style>
