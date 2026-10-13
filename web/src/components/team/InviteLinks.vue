<template>
  <section ref="root" class="lc-card il" data-block="invites">
    <header class="il-head">
      <h2>{{ t('team.invites.title') }}</h2>
      <p>{{ t('team.invites.desc') }}</p>
      <button class="lc-btn sm" type="button" data-act="invite-new" @click="openCreate"><LcIcon name="plus" size="s" />{{ t('team.invites.create') }}</button>
    </header>

    <div v-if="loading && !list.length" class="il-sk" aria-busy="true"><i /><i /></div>
    <div v-else-if="error" class="il-state">
      <p class="lc-error-text" role="alert">{{ error }}</p>
      <button class="lc-btn sm" type="button" @click="load">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="!list.length" class="lc-empty">{{ t('team.invites.empty') }}</div>
    <template v-else>
      <div class="lc-table-wrap">
        <table class="lc-table il-table">
          <thead>
            <tr>
              <th>{{ t('team.invites.col.link') }}</th>
              <th>{{ t('team.invites.col.by') }}</th>
              <th>{{ t('team.invites.col.left') }}</th>
              <th>{{ t('team.invites.col.expires') }}</th>
              <th class="right">{{ t('team.col.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in shown" :key="inv.id" :class="{ dead: !usable(inv) }" :data-invite="inv.id">
              <td>
                <span class="il-link lc-mono">{{ shortLink(inv) }}</span>
                <span v-if="inv.state !== 'valid'" class="lc-tag" :class="inv.state === 'team_full' ? 'warn' : 'err'">{{ t('team.invites.state.' + inv.state) }}</span>
                <small v-if="!inv.token && usable(inv)" class="il-note">{{ t('team.invites.noToken') }}</small>
              </td>
              <td class="il-by"><PersonName :person="inv.createdBy" :you="inv.createdBy?.id === meId" /></td>
              <td class="lc-mono il-num" :class="{ 'lc-t3': !leftOf(inv) }" data-role="invite-left">{{ leftOf(inv) || '—' }}</td>
              <td class="lc-mono il-num">{{ formatDate(inv.expiresAt) }}</td>
              <td class="right">
                <span class="il-acts">
                  <button v-if="usable(inv) && inv.token" class="lc-btn sm" type="button" data-act="invite-copy" @click="copy(inv)">
                    <LcIcon name="copy" size="s" />{{ t('common.copy') }}
                  </button>
                  <ConfirmPop
                    v-if="usable(inv)"
                    :text="t('team.invites.revokeAsk')"
                    :hint="t('team.invites.revokeHint')"
                    :ok-text="t('team.invites.revoke')"
                    @ok="revoke(inv)"
                  >
                    <button class="lc-btn sm danger" type="button" :disabled="revoking === inv.id" data-act="invite-revoke">{{ t('team.invites.revoke') }}</button>
                  </ConfirmPop>
                  <span v-if="!usable(inv)" class="lc-t3" aria-hidden="true">—</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button v-if="deadCount && liveCount" class="lc-btn sm text il-more" type="button" :aria-expanded="showDead" @click="showDead = !showDead">
        {{ showDead ? t('team.invites.hideDead') : t('team.invites.showDead', { n: deadCount }) }}
      </button>
    </template>

    <TeamDialog v-if="creating" :title="t('team.invites.create')" :busy="saving" @close="creating = false" @submit="create">
      <template v-if="!made">
        <div class="il-f" role="group" :aria-label="t('team.invites.days')">
          <span class="il-l">{{ t('team.invites.days') }}</span>
          <div class="lc-seg">
            <button v-for="d in DAYS" :key="d" type="button" :class="{ on: days === d }" :aria-pressed="days === d" :data-days="d" @click="days = d">{{ t('spaces.days', { n: d }) }}</button>
          </div>
        </div>
        <div class="il-f" role="group" :aria-label="t('team.invites.uses')">
          <span class="il-l">{{ t('team.invites.uses') }}</span>
          <div class="lc-seg">
            <button v-for="u in USES" :key="u" type="button" :class="{ on: uses === u }" :aria-pressed="uses === u" :data-uses="u" @click="uses = u">
              {{ u ? t('team.invites.usesN', { n: u }) : t('spaces.limits.unlimited') }}
            </button>
          </div>
        </div>
        <p class="lc-help">{{ t('team.invites.createHelp') }}</p>
        <p v-if="createError" class="lc-error-text" role="alert">{{ createError }}</p>
      </template>
      <template v-else>
        <p>{{ t('team.invites.madeLead') }}</p>
        <div class="il-made">
          <input class="lc-input lc-mono" readonly :value="linkOf(made)" :aria-label="t('team.invites.col.link')" data-autofocus @focus="selectAll" />
          <button class="lc-btn primary quiet" type="button" data-act="invite-copy-new" @click="copy(made)"><LcIcon name="copy" size="s" />{{ t('common.copy') }}</button>
        </div>
        <div class="lc-alert info"><LcIcon name="info" /><span>{{ madeNote }}</span></div>
      </template>
      <template #foot>
        <template v-if="!made">
          <button class="lc-btn" type="button" :disabled="saving" @click="creating = false">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary" type="submit" :disabled="saving" data-act="invite-create">{{ saving ? t('team.invites.creating') : t('team.invites.createOk') }}</button>
        </template>
        <button v-else class="lc-btn" type="button" @click="creating = false">{{ t('common.close') }}</button>
      </template>
    </TeamDialog>
  </section>
</template>

<script setup lang="ts">
/**
 * 邀请链接（团长、管理员）：列表、复制、撤销、生成新链接。拿到链接的人登录后确认即可加入，角色是成员。
 * 链接地址用加入页的路由拼，嵌在别的路径下时也对。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { teamApi, unwrap } from '@/utils/api'
import { MessagePlugin } from '@/utils/feedback'
import { writeClipboard } from '@/utils/clipboard'
import { formatDate } from '@/components/space/format'
import LcIcon from '@/components/LcIcon.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import PersonName from '@/components/PersonName.vue'
import TeamDialog from './TeamDialog.vue'
import { useTeamPage } from './context'
import type { TeamInvitation } from '@/types'

const { t } = useI18n()
const router = useRouter()
const page = useTeamPage()
const meId = computed(() => page.detail.value?.me?.id || '')

const DAYS = [1, 7, 30]
const USES = [1, 10, 0]

const root = ref<HTMLElement | null>(null)
const list = ref<TeamInvitation[]>([])
const loading = ref(true)
const error = ref('')
const showDead = ref(false)

/** 还能用（或只是因为团队满员暂时用不了）的排前面；失效的默认收起 */
const usable = (inv: TeamInvitation) => inv.state === 'valid' || inv.state === 'team_full'
const liveCount = computed(() => list.value.filter(usable).length)
const deadCount = computed(() => list.value.length - liveCount.value)
const shown = computed(() => {
  const live = list.value.filter(usable)
  return showDead.value || !live.length ? [...live, ...list.value.filter((i) => !usable(i))] : live
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    list.value = unwrap(await teamApi.invitations(page.teamId))
  } catch (err) {
    error.value = page.explain(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

const linkOf = (inv: TeamInvitation) => new URL(router.resolve({ name: 'join', params: { token: inv.token } }).href, location.href).href
function shortLink(inv: TeamInvitation) {
  const k = inv.token
  if (!k) return t('team.invites.hidden')
  return '…/join/' + (k.length > 12 ? k.slice(0, 6) + '…' + k.slice(-4) : k)
}
/**
 * 还能用几次。已撤销、已过期、团队已关闭的链接没有「还剩几次」可说（服务端给的也是 null）：返回空串，格子里画「—」，
 * 是哪种状态写在链接旁边的标签上 —— 不然一条已撤销的链接还写着「5 / 5」，像是还能用。
 * 其余的以服务端给的 remainingUses 为准；老服务端没有这一项时才自己减。
 */
function leftOf(inv: TeamInvitation): string {
  if (inv.state === 'revoked' || inv.state === 'expired' || inv.state === 'team_unavailable') return ''
  if (!inv.maxUses) return t('spaces.limits.unlimited')
  const left = typeof inv.remainingUses === 'number' ? inv.remainingUses : Math.max(0, inv.maxUses - inv.usedCount)
  return left + ' / ' + inv.maxUses
}
function selectAll(e: FocusEvent) {
  (e.target as HTMLInputElement).select()
}

async function copy(inv: TeamInvitation) {
  try {
    await writeClipboard(linkOf(inv))
    MessagePlugin.success(t('team.invites.copied'))
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}

const revoking = ref('')
async function revoke(inv: TeamInvitation) {
  revoking.value = inv.id
  try {
    await teamApi.revokeInvitation(page.teamId, inv.id)
    MessagePlugin.success(t('team.invites.revoked'))
    await load()
  } catch (err) {
    page.fail(err)
  } finally {
    revoking.value = ''
  }
}

// ---- 生成新链接 ----
const creating = ref(false)
const saving = ref(false)
const createError = ref('')
const days = ref(7)
const uses = ref(10)
const made = ref<TeamInvitation | null>(null)

function openCreate() {
  days.value = 7
  uses.value = 10
  made.value = null
  createError.value = ''
  creating.value = true
  root.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
defineExpose({ openCreate })

const madeNote = computed(() => {
  const inv = made.value
  if (!inv) return ''
  const date = formatDate(inv.expiresAt)
  return inv.maxUses
    ? t('team.invites.madeNote', { date, n: inv.maxUses })
    : t('team.invites.madeNoteUnlimited', { date })
})

async function create() {
  if (saving.value || made.value) return
  saving.value = true
  createError.value = ''
  try {
    made.value = unwrap(await teamApi.createInvitation(page.teamId, { expiresInDays: days.value, maxUses: uses.value }))
    void load()
  } catch (err) {
    // invite.max（同时最多 50 条有效链接）等：服务端的话里有数字，原样显示
    createError.value = page.explain(err)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.il { margin-top: 20px; overflow: hidden; }
.il-head { display: flex; align-items: center; gap: 6px 12px; flex-wrap: wrap; padding: 16px 20px; }
.il-head h2 { font: 600 15px/1.5 var(--f-disp); color: var(--text); }
.il-head p { flex: 1 1 240px; min-width: 0; color: var(--text-3); font-size: 13px; }
.il-table th:first-child, .il-table td:first-child { padding-left: 20px; }
.il-table th:last-child, .il-table td:last-child { padding-right: 20px; }
.il-table .right { text-align: right; }
.il-table td { white-space: nowrap; }
.il-link { color: var(--text); font-size: 12px; margin-right: 8px; }
.il-num { font-size: 12px; }
.il-by { color: var(--text); }
.il-note { display: block; margin-top: 4px; color: var(--text-3); font-size: 12px; white-space: normal; min-width: 220px; }
.il-acts { display: inline-flex; gap: 8px; align-items: center; }
tr.dead .il-link, tr.dead .il-by, tr.dead .il-num { color: var(--text-3); }
.il-more { margin: 8px 12px 12px; }
.il-state { padding: 4px 20px 20px; }
.il-state .lc-btn { margin-top: 10px; }
.il-sk { display: grid; gap: 12px; padding: 4px 20px 20px; }
.il-sk i { display: block; height: 14px; border-radius: 6px; background: rgb(var(--c-film) / .1); animation: lc-pulse 1.6s ease-in-out infinite; }
.il-sk i:nth-child(1) { width: 60%; } .il-sk i:nth-child(2) { width: 44%; }
.il-f { display: grid; gap: 8px; justify-items: start; margin-bottom: 16px; }
.il-l { font-size: 13px; color: var(--text); font-weight: 500; }
.il-made { display: flex; gap: 8px; margin-top: 12px; }
.il-made .lc-input { flex: 1; min-width: 0; font-size: 12px; }
@media (max-width: 600px) {
  .il-head { padding: 14px 16px; }
  .il-table th:first-child, .il-table td:first-child { padding-left: 16px; }
  .il-table th:last-child, .il-table td:last-child { padding-right: 16px; }
}
</style>
