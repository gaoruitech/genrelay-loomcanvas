<template>
  <AuthLayout>
    <template #aside>
      <span class="kick"><i />{{ t('auth.login.kick') }}</span>
      <h1>{{ t('auth.login.h1a') }}<br /><span class="lc-gt">{{ t('auth.login.h1b') }}</span></h1>
      <p class="lead">{{ t('auth.login.lead') }}</p>
    </template>

    <h2>{{ t('auth.login.title') }}</h2>
    <p class="sub">{{ t('auth.login.sub') }}</p>

    <form novalidate @submit.prevent="submit">
      <div v-if="app.firstRun" class="lc-alert info" role="status">
        <LcIcon name="star" />
        <span>{{ t('auth.login.firstRun') }} <router-link to="/register">{{ t('auth.login.firstRunLink') }}</router-link></span>
      </div>
      <div v-if="formError" class="lc-alert" role="alert">
        <LcIcon name="warn" /><span>{{ formError }}</span>
      </div>

      <div class="fld">
        <span id="lg-account-l">{{ t('auth.login.account') }}</span>
        <label class="lc-inp" :class="{ 'is-err': errors.account || credsWrong }">
          <LcIcon name="user" />
          <input
            ref="accountEl"
            v-model.trim="account"
            type="text"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            maxlength="254"
            aria-labelledby="lg-account-l"
            :aria-invalid="!!(errors.account || credsWrong)"
            aria-describedby="lg-account-h"
            @input="clear('account')"
          />
        </label>
        <div id="lg-account-h" class="lc-help" :class="{ err: errors.account }">{{ errors.account || t('auth.login.accountHint') }}</div>
      </div>

      <div class="fld">
        <span id="lg-pw-l">{{ t('auth.login.password') }}</span>
        <label class="lc-inp" :class="{ 'is-err': errors.password || credsWrong }">
          <LcIcon name="lock" />
          <input
            v-model="password"
            :type="showPw ? 'text' : 'password'"
            name="password"
            autocomplete="current-password"
            maxlength="128"
            aria-labelledby="lg-pw-l"
            :aria-invalid="!!(errors.password || credsWrong)"
            aria-describedby="lg-pw-h"
            @input="clear('password')"
          />
          <button type="button" class="lc-inp-btn" :aria-label="showPw ? t('auth.hidePassword') : t('auth.showPassword')" :aria-pressed="showPw" @click="showPw = !showPw">
            <LcIcon :name="showPw ? 'eyeoff' : 'eye'" />
          </button>
        </label>
        <div v-if="errors.password || credsWrong" id="lg-pw-h" class="lc-help err">{{ errors.password || t('auth.errors.checkCase') }}</div>
      </div>

      <div class="lc-row between">
        <label class="lc-check"><input v-model="remember" type="checkbox" /><span class="box" />{{ t('auth.login.remember') }}</label>
        <button type="button" class="linkish" @click="forgotOpen = true">{{ t('auth.login.forgot') }}</button>
      </div>

      <button type="submit" class="lc-btn primary lg block" :disabled="busy || waitLeft > 0">
        {{ waitLeft > 0 ? t('auth.login.waitSeconds', { n: waitLeft }) : busy ? t('auth.login.submitting') : t('auth.login.submit') }}
      </button>
    </form>

    <div class="foot">
      <template v-if="app.registrationOpen">
        {{ t('auth.login.noAccount') }}<router-link :to="{ name: 'register', query: route.query }">{{ t('auth.login.toRegister') }}</router-link>
      </template>
      <template v-else>{{ t('auth.login.closed') }}</template>
    </div>

    <Teleport to="body">
      <div v-if="forgotOpen" class="lc-mask" @mousedown.self="forgotOpen = false">
        <div class="lc-dialog forgot" role="dialog" aria-modal="true" aria-labelledby="forgot-title">
          <div class="lc-dialog-head">
            <span id="forgot-title">{{ t('auth.forgotDialog.title') }}</span>
            <button class="lc-x" :aria-label="t('common.close')" @click="forgotOpen = false">×</button>
          </div>
          <div class="lc-dialog-body">
            <p class="fg-lead">{{ t('auth.forgotDialog.lead') }}</p>
            <div class="fg-item"><LcIcon name="users" /><div><b>{{ t('auth.forgotDialog.ownerTitle') }}</b><p>{{ t('auth.forgotDialog.ownerBody') }}</p></div></div>
            <div class="fg-item"><LcIcon name="server" /><div><b>{{ t('auth.forgotDialog.cliTitle') }}</b><p>{{ t('auth.forgotDialog.cliBody') }} <a :href="LINKS.faq" target="_blank" rel="noopener">{{ t('auth.forgotDialog.faq') }}</a></p></div></div>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn primary quiet" @click="forgotOpen = false">{{ t('auth.forgotDialog.ok') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </AuthLayout>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { safeRedirect } from '@/router'
import { describeAuthError } from '@/utils/authErrors'
import { LINKS } from '@/utils/links'
import AuthLayout from '@/components/auth/AuthLayout.vue'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const app = useAppStore()

const account = ref('')
const password = ref('')
const remember = ref(true)
const showPw = ref(false)
const busy = ref(false)
const forgotOpen = ref(false)

const errors = reactive<{ account: string; password: string }>({ account: '', password: '' })
const formError = ref('')
/** 账号或密码不对：两个输入框都标红（后端不说是哪一个错） */
const credsWrong = ref(false)

/** 尝试过多被限流：倒计时结束前按钮不可点 */
const waitLeft = ref(0)
let waitTimer = 0
function startWait(seconds: number) {
  window.clearInterval(waitTimer)
  waitLeft.value = Math.ceil(seconds)
  waitTimer = window.setInterval(() => {
    waitLeft.value -= 1
    if (waitLeft.value <= 0) { window.clearInterval(waitTimer); formError.value = '' }
  }, 1000)
}
onBeforeUnmount(() => window.clearInterval(waitTimer))

const accountEl = ref<HTMLInputElement | null>(null)
onMounted(() => accountEl.value?.focus())

function clear(field: 'account' | 'password') {
  errors[field] = ''
  credsWrong.value = false
}

function validate(): boolean {
  errors.account = account.value ? '' : t('auth.errors.accountRequired')
  errors.password = password.value ? '' : t('auth.errors.passwordRequired')
  return !errors.account && !errors.password
}

async function submit() {
  if (busy.value || waitLeft.value > 0) return
  formError.value = ''
  credsWrong.value = false
  if (!validate()) return
  busy.value = true
  try {
    await app.login(account.value, password.value, remember.value)
    await router.replace(safeRedirect(route.query.redirect) || { name: 'home' })
  } catch (err) {
    const f = describeAuthError(err)
    formError.value = f.message
    credsWrong.value = f.code === 'auth.invalid_credentials'
    if (f.retryAfterSeconds) startWait(f.retryAfterSeconds)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.between { justify-content: space-between; flex-wrap: wrap; }
.linkish { border: 0; background: none; color: var(--cyan-soft); padding: 0; font-size: 14px; }
.linkish:hover { text-decoration: underline; }
.forgot { width: 480px; }
.fg-lead { color: var(--text-2); line-height: 1.7; margin-bottom: 16px; }
.fg-item { display: flex; gap: 12px; align-items: flex-start; padding: 14px 0; border-top: 1px solid var(--line); }
.fg-item > svg { color: var(--cyan); margin-top: 2px; }
.fg-item b { display: block; font-weight: 600; color: var(--text); }
.fg-item p { color: var(--text-2); font-size: 13px; line-height: 1.7; margin-top: 4px; }
</style>
