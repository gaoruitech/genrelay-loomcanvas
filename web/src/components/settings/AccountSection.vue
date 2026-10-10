<template>
  <SettingsSection id="account" icon="shield" :title="t('account.title')">
    <template #desc>
      {{ t('account.current') }}<b class="who">{{ app.user?.username }}</b> · {{ app.isOwner ? t('shell.roleOwner') : t('shell.roleUser') }}
    </template>

    <!-- 用户名 / 邮箱 -->
    <form class="srow top" novalidate @submit.prevent="saveProfile">
      <div class="k">
        <b>{{ t('account.profile.title') }}</b>
        <small>{{ t('account.profile.help') }}</small>
      </div>
      <div class="v">
        <div class="g2">
          <div class="fld">
            <label for="ac-username">{{ t('account.profile.username') }}</label>
            <input
              id="ac-username" v-model.trim="profile.username" class="lc-input" :class="{ 'is-err': profileErr.username }"
              maxlength="32" autocomplete="username" spellcheck="false" :disabled="profileBusy"
              :aria-invalid="!!profileErr.username || undefined" @input="profileErr.username = ''"
            />
            <span v-if="profileErr.username" class="lc-help err" role="alert">{{ profileErr.username }}</span>
          </div>
          <div class="fld">
            <label for="ac-email">{{ t('account.profile.email') }}</label>
            <input
              id="ac-email" v-model.trim="profile.email" class="lc-input" :class="{ 'is-err': profileErr.email }"
              type="email" autocomplete="email" spellcheck="false" :disabled="profileBusy"
              :aria-invalid="!!profileErr.email || undefined" @input="profileErr.email = ''"
            />
            <span v-if="profileErr.email" class="lc-help err" role="alert">{{ profileErr.email }}</span>
          </div>
        </div>
        <p v-if="profileErr.form" class="lc-error-text msg" role="alert">{{ profileErr.form }}</p>
        <button class="lc-btn act" type="submit" :disabled="profileBusy || !profileDirty" data-testid="account-save-profile">
          {{ profileBusy ? t('common.saving') : t('account.profile.save') }}
        </button>
      </div>
    </form>

    <!-- 修改密码 -->
    <form class="srow top" novalidate autocomplete="off" @submit.prevent="savePassword">
      <div class="k">
        <b>{{ t('account.password.title') }}</b>
        <small>{{ t('account.password.help') }}</small>
      </div>
      <div class="v">
        <div class="g3">
          <div class="fld">
            <label for="ac-pw-cur">{{ t('account.password.current') }}</label>
            <input
              id="ac-pw-cur" v-model="pw.current" class="lc-input" :class="{ 'is-err': pwErr.current }" type="password"
              autocomplete="current-password" :placeholder="t('account.password.currentPh')" :disabled="pwBusy"
              :aria-invalid="!!pwErr.current || undefined" @input="pwErr.current = ''"
            />
            <span v-if="pwErr.current" class="lc-help err" role="alert">{{ pwErr.current }}</span>
          </div>
          <div class="fld">
            <label for="ac-pw-new">{{ t('account.password.next') }}</label>
            <input
              id="ac-pw-new" v-model="pw.next" class="lc-input" :class="{ 'is-err': pwErr.next }" type="password"
              autocomplete="new-password" :placeholder="t('account.password.nextPh')" :disabled="pwBusy"
              :aria-invalid="!!pwErr.next || undefined" @input="pwErr.next = ''"
            />
            <span v-if="pwErr.next" class="lc-help err" role="alert">{{ pwErr.next }}</span>
          </div>
          <div class="fld">
            <label for="ac-pw-again">{{ t('account.password.confirm') }}</label>
            <input
              id="ac-pw-again" v-model="pw.again" class="lc-input" :class="{ 'is-err': pwErr.again }" type="password"
              autocomplete="new-password" :placeholder="t('account.password.confirmPh')" :disabled="pwBusy"
              :aria-invalid="!!pwErr.again || undefined" @input="pwErr.again = ''"
            />
            <span v-if="pwErr.again" class="lc-help err" role="alert">{{ pwErr.again }}</span>
          </div>
        </div>
        <p v-if="pwErr.form" class="lc-error-text msg" role="alert">{{ pwErr.form }}</p>
        <button class="lc-btn act" type="submit" :disabled="pwBusy" data-testid="account-save-password">
          {{ pwBusy ? t('common.saving') : t('account.password.submit') }}
        </button>
      </div>
    </form>

    <!-- 登录会话 -->
    <div class="srow top">
      <div class="k">
        <b>{{ t('account.sessions.title') }}</b>
        <small>{{ t('account.sessions.help') }}</small>
      </div>
      <div class="v" data-testid="account-sessions">
        <div v-if="sessLoading && !sessions.length" class="sk flat" aria-busy="true"><i /><i /></div>
        <div v-else-if="sessError" class="sess-state">
          <p class="lc-error-text">{{ sessError }}</p>
          <button class="lc-btn sm" @click="loadSessions">{{ t('common.retry') }}</button>
        </div>
        <template v-else>
          <ul class="sess-list">
            <li v-for="s in sorted" :key="s.id" class="sess">
              <span class="dv"><LcIcon :name="device(s).mobile ? 'phone' : 'monitor'" /></span>
              <div class="who-dev">
                <b>{{ deviceName(s) }}</b>
                <small>{{ ipText(s) || t('account.sessions.noIp') }}</small>
              </div>
              <span v-if="s.current" class="lc-st ok">{{ t('account.sessions.current') }}</span>
              <span v-else class="seen">{{ seenText(s) }}</span>
              <button
                v-if="!s.current"
                class="lc-btn sm"
                type="button"
                :disabled="revoking === s.id || revokingAll"
                @click="revoke(s)"
              >{{ t('account.sessions.revoke') }}</button>
              <span v-else class="pad" />
            </li>
          </ul>
          <button
            v-if="others > 0"
            class="lc-btn danger sm all"
            type="button"
            :disabled="revokingAll"
            data-testid="account-revoke-others"
            @click="confirmAll = true"
          >{{ t('account.sessions.revokeOthers') }}</button>
        </template>
      </div>
    </div>

    <div v-if="confirmAll" class="lc-mask" @click.self="confirmAll = false">
      <div class="lc-dialog dlg" role="dialog" aria-modal="true">
        <div class="lc-dialog-head"><span>{{ t('account.sessions.revokeOthers') }}</span></div>
        <div class="lc-dialog-body"><p>{{ t('account.sessions.revokeOthersText', { n: others }) }}</p></div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="revokingAll" @click="confirmAll = false">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" :disabled="revokingAll" data-testid="account-revoke-others-ok" @click="revokeOthers">{{ t('account.sessions.revokeOthersOk') }}</button>
        </div>
      </div>
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
/** 账号与安全：改用户名 / 邮箱、改密码、看和下线登录会话。每个登录的人都有。 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { authApi, unwrap, apiErrorCode, apiErrorMessage } from '@/utils/api'
import { describeAuthError, EMAIL_RE, PASSWORD_MAX, PASSWORD_MIN, USERNAME_RE } from '@/utils/authErrors'
import { useAppStore } from '@/stores/app'
import LcIcon from '@/components/LcIcon.vue'
import SettingsSection from './SettingsSection.vue'
import { parseUserAgent } from './userAgent'
import { formatWhen } from './when'
import type { AuthSession } from '@/types'

const { t } = useI18n()
const app = useAppStore()

// ---- 用户名 / 邮箱 ----
const profile = reactive({ username: app.user?.username || '', email: app.user?.email || '' })
const profileErr = reactive({ username: '', email: '', form: '' })
const profileBusy = ref(false)
const profileDirty = computed(() => profile.username !== (app.user?.username || '') || profile.email !== (app.user?.email || ''))
// 账号信息晚到（或在别处被改了）而表单没动过：跟上
watch(() => app.user, (u, old) => {
  if (!u) return
  if (profile.username === (old?.username || '')) profile.username = u.username
  if (profile.email === (old?.email || '')) profile.email = u.email
})

async function saveProfile() {
  profileErr.form = ''
  profileErr.username = !profile.username ? t('auth.errors.usernameRequired')
    : USERNAME_RE.test(profile.username) ? '' : t('auth.errors.usernameInvalid')
  // 自动创建的管理员可以没有邮箱：本来就没有、这次也没填，就不拦（只改用户名）；有过邮箱的不能改成空
  profileErr.email = !profile.email ? (app.user?.email ? t('auth.errors.emailRequired') : '')
    : EMAIL_RE.test(profile.email) ? '' : t('auth.errors.emailInvalid')
  if (profileErr.username || profileErr.email) return
  // 只提交改了的那一项
  const body: { username?: string; email?: string } = {}
  if (profile.username !== app.user?.username) body.username = profile.username
  if (profile.email !== (app.user?.email || '')) body.email = profile.email
  if (!Object.keys(body).length) return
  profileBusy.value = true
  try {
    const u = unwrap(await authApi.updateProfile(body)).user
    app.setUser(u)
    profile.username = u.username
    profile.email = u.email
    MessagePlugin.success(t('account.profile.saved'))
  } catch (err) {
    const f = describeAuthError(err)
    profileErr.username = f.fields.username || ''
    profileErr.email = f.fields.email || ''
    profileErr.form = f.message
  } finally {
    profileBusy.value = false
  }
}

// ---- 修改密码 ----
const pw = reactive({ current: '', next: '', again: '' })
const pwErr = reactive({ current: '', next: '', again: '', form: '' })
const pwBusy = ref(false)

async function savePassword() {
  pwErr.form = ''
  pwErr.current = pw.current ? '' : t('account.password.currentRequired')
  pwErr.next = pw.next.length < PASSWORD_MIN ? t('auth.errors.passwordShort')
    : pw.next.length > PASSWORD_MAX ? t('auth.errors.passwordLong')
      : pw.next === pw.current ? t('account.password.same') : ''
  pwErr.again = pw.again === pw.next ? '' : t('auth.errors.confirmMismatch')
  if (pwErr.current || pwErr.next || pwErr.again) return
  pwBusy.value = true
  try {
    const out = unwrap(await authApi.changePassword({ currentPassword: pw.current, newPassword: pw.next }))
    // 先接上新令牌，再发别的请求：旧的那个此刻已经失效
    app.swapToken(out?.token || '')
    pw.current = pw.next = pw.again = ''
    MessagePlugin.success(t('account.password.saved'))
    // 其他设备上的会话已经被服务端下线了
    void loadSessions()
  } catch (err) {
    const code = apiErrorCode(err)
    if (code === 'auth.wrong_current_password' || code === 'auth.invalid_credentials') {
      pwErr.current = t('account.password.wrongCurrent')
    } else {
      const f = describeAuthError(err)
      pwErr.next = f.fields.password || ''
      pwErr.form = f.message
    }
  } finally {
    pwBusy.value = false
  }
}

// ---- 登录会话 ----
const sessions = ref<AuthSession[]>([])
const sessLoading = ref(true)
const sessError = ref('')
const revoking = ref('')
const revokingAll = ref(false)
const confirmAll = ref(false)

/** 当前这个排最前，其余按最近活跃 */
const sorted = computed(() => [...sessions.value].sort((a, b) => {
  if (a.current !== b.current) return a.current ? -1 : 1
  return String(b.lastSeenAt || b.createdAt).localeCompare(String(a.lastSeenAt || a.createdAt))
}))
const others = computed(() => sessions.value.filter(s => !s.current).length)

const device = (s: AuthSession) => parseUserAgent(s.userAgent)
function deviceName(s: AuthSession) {
  const d = device(s)
  return [d.os, d.browser].filter(Boolean).join(' · ') || t('account.sessions.unknownDevice')
}
/** IPv4 经由 IPv6 套接字进来时带的 ::ffff: 前缀不是给人看的 */
const ipText = (s: AuthSession) => String(s.ip || '').replace(/^::ffff:/i, '')
function seenText(s: AuthSession) {
  const seen = formatWhen(s.lastSeenAt, app.locale)
  if (seen) return t('account.sessions.lastActive', { time: seen })
  const created = formatWhen(s.createdAt, app.locale)
  return created ? t('account.sessions.signedIn', { time: created }) : ''
}

async function loadSessions() {
  sessLoading.value = true
  sessError.value = ''
  try {
    sessions.value = unwrap(await authApi.sessions()) || []
  } catch (err) {
    sessError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    sessLoading.value = false
  }
}
onMounted(loadSessions)

async function revoke(s: AuthSession) {
  revoking.value = s.id
  try {
    unwrap(await authApi.revokeSession(s.id))
    MessagePlugin.success(t('account.sessions.revoked'))
  } catch (err) {
    // 那个会话已经不在了（过期 / 在别处被下线）：结果一样，刷新列表就行
    if (apiErrorCode(err) !== 'auth.session_not_found') MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    revoking.value = ''
  }
  await loadSessions()
}

async function revokeOthers() {
  revokingAll.value = true
  try {
    unwrap(await authApi.revokeOtherSessions())
    MessagePlugin.success(t('account.sessions.revokedOthers'))
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    revokingAll.value = false
    confirmAll.value = false
  }
  await loadSessions()
}
</script>

<style scoped>
@import './section-shared.css';
.who { font-weight: 500; color: var(--text); margin-left: 2px; }
.act { margin-top: 12px; }
.msg { margin-top: 10px; }

.sess-list { list-style: none; }
.sess {
  display: grid; grid-template-columns: 36px minmax(0, 1fr) minmax(0, auto) 72px; gap: 16px; align-items: center;
  min-height: 56px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 13px;
}
.sess:first-child { border-top: 0; padding-top: 0; }
.dv { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: rgba(124, 160, 255, .1); color: var(--text-2); }
.who-dev { min-width: 0; }
.who-dev b { display: block; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who-dev small { display: block; color: var(--text-3); font: 12px var(--f-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seen { color: var(--text-2); text-align: right; }
.sess .lc-btn { justify-self: end; }
.all { margin-top: 8px; }
.sk.flat { border-top: 0; padding-top: 4px; }
.sess-state .lc-btn { margin-top: 10px; }

@media (max-width: 600px) {
  .sess { grid-template-columns: 36px minmax(0, 1fr) auto; gap: 4px 12px; }
  .sess .seen, .sess .lc-st { grid-column: 2; grid-row: 2; text-align: left; font-size: 12px; }
  .sess .lc-btn { grid-column: 3; grid-row: 1 / span 2; }
  .sess .pad { display: none; }
}
</style>
