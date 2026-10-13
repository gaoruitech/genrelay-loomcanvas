<template>
  <div class="jn">
    <header class="jn-top">
      <LcLogo v-if="embed.brand !== false" :to="app.authed ? '/app' : '/'" />
      <span class="lc-sp" />
      <LcSelect
        v-if="embed.features.localeSwitch"
        class="jn-lang"
        size="sm"
        auto-width
        :model-value="app.locale"
        :options="LOCALE_OPTIONS"
        :aria-label="t('shell.language')"
        @update:model-value="app.setLocale"
      />
      <ThemeSwitch v-if="embed.features.themeSwitch" />
    </header>

    <main class="jn-main">
      <section class="jn-card lc-glass" :aria-busy="loading">
        <!-- 取预览 -->
        <div v-if="loading" class="jn-state"><span class="lc-ring sm spin"><i /></span><p>{{ t('common.loading') }}</p></div>

        <!-- 没取到（网络、服务端出错）：可以重试 -->
        <div v-else-if="loadError" class="jn-state">
          <span class="jn-ic err"><LcIcon name="warn" size="l" /></span>
          <h1>{{ t('spaces.join.loadFailed') }}</h1>
          <p>{{ loadError }}</p>
          <button class="lc-btn" type="button" @click="load">{{ t('common.retry') }}</button>
        </div>

        <!-- 邀请用不了：说明原因，没有加入按钮 -->
        <div v-else-if="problem" class="jn-state">
          <span class="jn-ic"><LcIcon name="warn" size="l" /></span>
          <h1>{{ t(`spaces.join.problem.${problem}.title`) }}</h1>
          <p>{{ t(`spaces.join.problem.${problem}.body`) }}</p>
          <p v-if="askLine" class="jn-dim" data-testid="join-ask">{{ askLine }}</p>
          <router-link class="lc-btn" :to="app.authed ? { name: 'home' } : '/'">{{ app.authed ? t('spaces.join.backToApp') : t('auth.backHome') }}</router-link>
        </div>

        <!-- 已经加入了（刚点的，或者本来就是成员） -->
        <div v-else-if="joined || preview?.alreadyMember" class="jn-state">
          <SpaceAvatar :name="preview!.team!.name" :src="preview!.team!.avatar" :seed="preview!.team!.id" :size="64" />
          <h1>{{ preview!.team!.name }}</h1>
          <p>{{ joined && !already ? t('spaces.join.joinedBody') : t('spaces.join.alreadyBody') }}</p>
          <button class="lc-btn primary lg block" type="button" @click="enterTeam">{{ t('spaces.join.enter') }}</button>
        </div>

        <template v-else-if="preview?.team">
          <div class="jn-head">
            <SpaceAvatar :name="preview.team.name" :src="preview.team.avatar" :seed="preview.team.id" :size="64" />
            <h1>{{ preview.team.name }}</h1>
            <p>{{ t('spaces.join.invitedBy', { name: preview.inviterName || preview.team.ownerName, n: preview.team.members }) }}</p>
          </div>

          <ul class="jn-facts">
            <li><LcIcon name="users" /><i18n-t keypath="spaces.join.factTeam" tag="span" scope="global"><template #b><b>{{ t('spaces.join.factTeamB') }}</b></template></i18n-t></li>
            <li><LcIcon name="lock" /><i18n-t keypath="spaces.join.factPersonal" tag="span" scope="global"><template #b><b>{{ t('spaces.personal') }}</b></template></i18n-t></li>
          </ul>

          <!-- 已登录：以谁的身份加入 -->
          <template v-if="app.authed">
            <p class="jn-as">
              <i18n-t keypath="spaces.join.asWho" tag="span" scope="global">
                <template #name><b class="lc-mono">@{{ app.user?.username }}</b></template>
                <template #role>{{ t('spaces.role.member') }}</template>
              </i18n-t>
            </p>
            <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
            <button class="lc-btn primary lg block" type="button" :disabled="busy" @click="accept">{{ busy ? t('spaces.join.joining') : t('spaces.join.join') }}</button>
            <router-link class="jn-skip" :to="{ name: 'home' }">{{ t('spaces.join.notNow') }}</router-link>
          </template>

          <!-- 没登录：先登录；开放注册时才提供注册，关着就如实说 -->
          <template v-else>
            <p class="jn-as">{{ t('spaces.join.signInFirst') }}</p>
            <router-link class="lc-btn primary lg block" :to="{ name: 'login', query: { redirect: route.fullPath } }">{{ t('spaces.join.signIn') }}</router-link>
            <router-link v-if="preview.registrationOpen" class="lc-btn lg block jn-reg" :to="{ name: 'register', query: { redirect: route.fullPath } }">{{ t('spaces.join.register') }}</router-link>
            <p v-else class="jn-closed"><LcIcon name="info" size="s" /><span>{{ t('spaces.join.registrationClosed') }}</span></p>
          </template>

          <p class="jn-foot">
            {{ t('spaces.join.expires', { date: formatDate(preview.expiresAt) }) }}
            <span v-if="typeof preview.remainingUses === 'number'" data-testid="invite-uses">{{ t('spaces.join.usesLeft', { n: preview.remainingUses }, preview.remainingUses) }}</span>
          </p>
        </template>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * 打开邀请链接后的加入页（/join/<邀请码>）。
 * 不登录也能看到是哪个团队、谁在邀请（预览接口是公开的，里面没有团队内部的任何内容）；
 * 加入要先登录。本站关闭注册时不引导去注册：邀请链接不能用来注册账号。
 * 邀请过期、用完、被撤销、团队满员或已关闭时，同一张卡片换成原因说明。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useSpaceStore, spaceParam } from '@/stores/space'
import { teamApi, unwrap, apiErrorCode, apiErrorMessage } from '@/utils/api'
import { LOCALE_OPTIONS } from '@/locales'
import { useEmbed } from '@/embed/context'
import LcIcon from '@/components/LcIcon.vue'
import LcLogo from '@/components/LcLogo.vue'
import LcSelect from '@/components/LcSelect.vue'
import ThemeSwitch from '@/components/ThemeSwitch.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import { formatDate } from '@/components/space/format'
import type { InvitationPreview } from '@/types'

type Problem = 'not_found' | 'expired' | 'used_up' | 'revoked' | 'team_full' | 'team_unavailable'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const app = useAppStore()
const space = useSpaceStore()
const embed = useEmbed()

const token = computed(() => String(route.params.token || ''))
const preview = ref<InvitationPreview | null>(null)
const loading = ref(true)
const loadError = ref('')
const notFound = ref(false)
const busy = ref(false)
const error = ref('')
const joined = ref(false)
const already = ref(false)
/** 点「加入」时接口说的原因（预览之后才过期、才用完的） */
const refused = ref<Problem | ''>('')

const problem = computed<Problem | ''>(() => {
  if (notFound.value) return 'not_found'
  if (refused.value) return refused.value
  const s = preview.value?.state
  if (!s) return ''
  if (s !== 'valid') return s
  return preview.value?.team ? '' : 'team_unavailable'
})

/**
 * 邀请用不了时该找谁，一句话；没什么可说的（链接不存在、团队已关闭）是空串。
 * 重新生成要找「现在还能生成邀请的人」：服务端给的 contactName —— 生成这条链接的人已经离开团队、被移除、
 * 账号被删、或者不再是管理员时，是团长，不会让人去找一个已经不在的人。满员不是链接的问题，找团长。
 */
const askLine = computed(() => {
  const p = preview.value
  const kind = problem.value
  if (!p?.team || !kind || kind === 'not_found' || kind === 'team_unavailable') return ''
  if (kind === 'team_full') return p.team.ownerName ? t('spaces.join.askOwner', { name: p.team.ownerName }) : ''
  const name = p.contactName ?? p.team.ownerName
  return name ? t('spaces.join.askInviter', { name }) : t('spaces.join.askManagers')
})

async function load() {
  loading.value = true
  loadError.value = ''
  notFound.value = false
  refused.value = ''
  try {
    preview.value = unwrap(await teamApi.invitationPreview(token.value))
  } catch (err: any) {
    if (err?.response?.status === 404) notFound.value = true
    else loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)
// 登录回来、换了邀请码：重取（alreadyMember 说的是当前登录的人）
watch([token, () => app.user?.id], load)

const REFUSALS: Record<string, Problem> = {
  'invite.not_found': 'not_found',
  'invite.expired': 'expired',
  'invite.used_up': 'used_up',
  'invite.revoked': 'revoked',
  'invite.team_full': 'team_full',
}

async function accept() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const out = unwrap(await teamApi.acceptInvitation(token.value))
    already.value = !!out.already
    joined.value = true
    await space.refresh()
    await enterTeam(out.team.id)
  } catch (err) {
    const why = REFUSALS[apiErrorCode(err)]
    if (why) refused.value = why
    else error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    busy.value = false
  }
}

/** 加入后落在团队首页 */
async function enterTeam(id?: string | Event) {
  const teamId = typeof id === 'string' ? id : preview.value?.team?.id
  if (!teamId) return
  if (!space.teams.some((x) => x.id === teamId)) await space.refresh()
  await router.push({ name: 'home', params: { space: spaceParam(teamId) } })
}
</script>

<style scoped>
.jn { width: 100%; height: 100%; display: flex; flex-direction: column; overflow-y: auto; }
.jn-top {
  flex: none; height: var(--shell-top); display: flex; align-items: center; gap: 16px; padding: 0 20px 0 16px;
  border-bottom: 1px solid var(--line); background: rgb(var(--c-chrome) / .78);
}
.jn-lang :deep(.lcs-trigger) { background: rgb(var(--c-film) / .05); border-color: var(--line); height: 36px; border-radius: 10px; }
.jn-main { flex: 1; display: flex; align-items: flex-start; justify-content: center; padding: 48px 20px; min-height: 0; }
.jn-card { width: 460px; max-width: 100%; padding: 32px; border-radius: var(--r-xl); text-align: center; }
.jn-head h1, .jn-state h1 { font: 600 22px/1.3 var(--f-disp); color: var(--text); margin: 16px 0 6px; overflow-wrap: anywhere; }
.jn-head p { color: var(--text-2); margin: 0; }
.jn-state { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; }
.jn-state p { color: var(--text-2); line-height: 1.7; margin: 0 0 12px; overflow-wrap: anywhere; }
.jn-state .jn-dim { color: var(--text-3); font-size: 13px; margin-top: -6px; }
.jn-state .lc-btn { margin-top: 4px; }
.jn-ic { display: inline-grid; place-items: center; width: 56px; height: 56px; border-radius: 16px; color: var(--warn); background: var(--warning-dim); }
.jn-ic.err { color: var(--err-soft); background: var(--danger-dim); }
.jn-facts { list-style: none; margin: 24px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; text-align: left; }
.jn-facts li {
  display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: var(--r-md);
  border: 1px solid var(--line); background: rgb(var(--c-film) / .05); color: var(--text-2); line-height: 1.6; font-size: 13px;
}
.jn-facts .lc-ic { color: var(--cyan); margin-top: 2px; }
.jn-facts b { color: var(--text); font-weight: 600; }
.jn-as { margin: 22px 0 14px; color: var(--text-2); font-size: 13px; line-height: 1.6; }
.jn-as b { color: var(--text); font-weight: 600; margin: 0 2px; }
.jn-skip { display: inline-block; margin-top: 14px; color: var(--text-2); font-size: 14px; }
.jn-skip:hover { color: var(--text); }
.jn-reg { margin-top: 10px; }
.jn-closed { display: flex; gap: 8px; align-items: flex-start; justify-content: center; margin: 14px 0 0; color: var(--text-3); font-size: 13px; line-height: 1.6; text-align: left; }
.jn-closed .lc-ic { margin-top: 3px; }
.jn-foot { margin: 20px 0 0; color: var(--text-3); font-size: 12px; }
.lc-error-text { margin: 0 0 12px; }
@media (max-width: 640px) {
  .jn-top { padding: 0 12px; gap: 8px; }
  .jn-main { padding: 20px 12px; }
  .jn-card { padding: 24px 18px; }
}
</style>
