<template>
  <AuthLayout :back="false">
    <template #aside>
      <span class="kick"><i />{{ t('auth.forced.kick') }}</span>
      <h1>{{ t('auth.forced.h1a') }}<br /><span class="lc-gt">{{ t('auth.forced.h1b') }}</span></h1>
      <p class="lead">{{ t('auth.forced.lead') }}</p>
      <ul class="pts">
        <li><LcIcon name="shield" /><span>{{ t('auth.forced.pt1') }}</span></li>
        <li><LcIcon name="monitor" /><span>{{ t('auth.forced.pt2') }}</span></li>
      </ul>
    </template>

    <h2>{{ t('auth.forced.title') }}</h2>
    <p class="sub">{{ t('auth.forced.sub') }}<b class="who">{{ app.user?.username }}</b></p>

    <form novalidate @submit.prevent="submit">
      <!-- 窄屏上左栏的说明排在卡片下面，所以卡片里自己也说一句为什么 -->
      <div class="lc-alert info" role="status"><LcIcon name="shield" /><span>{{ t('auth.forced.notice') }}</span></div>
      <div v-if="formError" class="lc-alert" role="alert"><LcIcon name="warn" /><span>{{ formError }}</span></div>

      <!-- 浏览器的密码管理器靠这个知道新密码是哪个账号的 -->
      <input class="ghost-user" type="text" name="username" autocomplete="username" :value="app.user?.username" readonly tabindex="-1" aria-hidden="true" />

      <!-- 刚登录用的那个临时密码还在内存里就不用再输；刷新过页面就得自己填 -->
      <div v-if="askCurrent" class="fld">
        <span id="cp-cur-l">{{ t('auth.forced.current') }}</span>
        <label class="lc-inp" :class="{ 'is-err': errors.current }">
          <LcIcon name="key" />
          <input
            ref="currentEl" v-model="form.current" :type="showPw ? 'text' : 'password'" name="current-password" autocomplete="current-password" maxlength="128"
            aria-labelledby="cp-cur-l" :aria-invalid="!!errors.current" aria-describedby="cp-cur-h" @input="errors.current = ''"
          />
        </label>
        <div id="cp-cur-h" class="lc-help" :class="{ err: errors.current }">{{ errors.current || t('auth.forced.currentHint') }}</div>
      </div>

      <div class="fld">
        <span id="cp-new-l">{{ t('auth.forced.next') }}</span>
        <label class="lc-inp" :class="{ 'is-err': errors.next }">
          <LcIcon name="lock" />
          <input
            ref="nextEl" v-model="form.next" :type="showPw ? 'text' : 'password'" name="new-password" autocomplete="new-password" maxlength="128"
            aria-labelledby="cp-new-l" :aria-invalid="!!errors.next" aria-describedby="cp-new-h" @input="errors.next = ''" @blur="touch('next')"
          />
          <button type="button" class="lc-inp-btn" :aria-label="showPw ? t('auth.hidePassword') : t('auth.showPassword')" :aria-pressed="showPw" @click="showPw = !showPw">
            <LcIcon :name="showPw ? 'eyeoff' : 'eye'" />
          </button>
        </label>
        <div class="meter" aria-hidden="true"><i v-for="n in 4" :key="n" :class="{ on: n <= strength }" /></div>
        <div id="cp-new-h" class="lc-help" :class="{ err: errors.next }">
          {{ errors.next || t('auth.register.passwordHint') }}<template v-if="!errors.next && strength"> · {{ t('auth.register.strength', { level: t('auth.register.strengthLevels.' + LEVELS[strength]) }) }}</template>
        </div>
      </div>

      <div class="fld">
        <span id="cp-again-l">{{ t('auth.forced.confirm') }}</span>
        <label class="lc-inp" :class="{ 'is-err': errors.again }">
          <LcIcon name="lock" />
          <input
            v-model="form.again" :type="showPw ? 'text' : 'password'" name="confirm-password" autocomplete="new-password" maxlength="128"
            :placeholder="t('auth.register.confirmPlaceholder')" aria-labelledby="cp-again-l" :aria-invalid="!!errors.again" aria-describedby="cp-again-h"
            @input="errors.again = ''" @blur="touch('again')"
          />
        </label>
        <div v-if="errors.again" id="cp-again-h" class="lc-help err">{{ errors.again }}</div>
      </div>

      <button type="submit" class="lc-btn primary lg block" :disabled="busy || waitLeft > 0" data-testid="forced-password-submit">
        {{ waitLeft > 0 ? t('auth.login.waitSeconds', { n: waitLeft }) : busy ? t('common.saving') : t('auth.forced.submit') }}
      </button>
    </form>

    <div class="foot">
      {{ t('auth.forced.notYou') }}<button type="button" class="linkish" :disabled="busy" @click="leave">{{ t('shell.logout') }}</button>
    </div>
  </AuthLayout>
</template>

<script setup lang="ts">
/**
 * 设置新密码（强制）。账号的密码是别人知道的 —— 部署时自动生成、写在启动日志里的超级管理员初始密码，
 * 或者超级管理员 / 命令行重置出来的临时密码 —— 改掉之前服务端只放行改密码，路由守卫也只让人待在这一屏。
 * 改完去原本要去的地方（redirect），没有就回工作台。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { useAppStore } from '@/stores/app'
import { safeRedirect } from '@/router'
import { describeAuthError, passwordStrength, PASSWORD_MIN, PASSWORD_MAX } from '@/utils/authErrors'
import AuthLayout from '@/components/auth/AuthLayout.vue'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const app = useAppStore()

type Field = 'current' | 'next' | 'again'
const form = reactive({ current: '', next: '', again: '' })
const errors = reactive<Record<Field, string>>({ current: '', next: '', again: '' })
const formError = ref('')
const showPw = ref(false)
const busy = ref(false)
/** 内存里没有刚才登录用的密码（刷新过页面，或者是用着用着被要求改的）：让人自己填 */
const askCurrent = ref(!app.signInPassword)

const LEVELS = ['weak', 'weak', 'fair', 'good', 'strong'] as const
const strength = computed(() => passwordStrength(form.next))

const currentEl = ref<HTMLInputElement | null>(null)
const nextEl = ref<HTMLInputElement | null>(null)
onMounted(() => (askCurrent.value ? currentEl.value : nextEl.value)?.focus())

/** 试错太多被限流：倒计时结束前按钮不可点 */
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

const currentPassword = () => (askCurrent.value ? form.current : app.signInPassword)

function check(field: Field): string {
  switch (field) {
    case 'current':
      return !askCurrent.value || form.current ? '' : t('auth.forced.currentRequired')
    case 'next':
      if (!form.next) return t('auth.errors.passwordRequired')
      if (form.next.length < PASSWORD_MIN) return t('auth.errors.passwordShort')
      if (form.next.length > PASSWORD_MAX) return t('auth.errors.passwordLong')
      return form.next === currentPassword() ? t('auth.errors.samePassword') : ''
    case 'again':
      return form.again === form.next ? '' : t('auth.errors.confirmMismatch')
  }
}

/** 离开一个填过的输入框时就地校验；空着离开不打扰，等提交时再说 */
function touch(field: Field) {
  if (form[field]) errors[field] = check(field)
}

async function submit() {
  if (busy.value || waitLeft.value > 0) return
  formError.value = ''
  let ok = true
  for (const f of ['current', 'next', 'again'] as Field[]) {
    errors[f] = check(f)
    if (errors[f]) ok = false
  }
  if (!ok) return
  busy.value = true
  try {
    await app.replaceTemporaryPassword(currentPassword(), form.next)
    form.current = form.next = form.again = ''
    MessagePlugin.success(t('auth.forced.saved'))
    await router.replace(safeRedirect(route.query.redirect) || { name: 'home' })
  } catch (err) {
    const f = describeAuthError(err)
    if (f.fields.currentPassword) {
      // 记在内存里的那个不对了（比如期间又被重置过一次）：把输入框亮出来让人自己填
      const hidden = !askCurrent.value
      askCurrent.value = true
      errors.current = hidden ? t('auth.forced.currentRequired') : f.fields.currentPassword
      await nextTick()
      currentEl.value?.focus()
    }
    if (f.fields.password) errors.next = f.fields.password
    formError.value = f.message
    if (f.retryAfterSeconds) startWait(f.retryAfterSeconds)
  } finally {
    busy.value = false
  }
}

async function leave() {
  if (busy.value) return
  await app.logout()
}
</script>

<style scoped>
.who { color: var(--text); font-weight: 600; margin-left: 4px; }
.pts { margin: 32px 0 0; padding: 0; list-style: none; display: grid; gap: 14px; max-width: 520px; }
.pts li { display: flex; gap: 12px; align-items: flex-start; color: var(--text-2); line-height: 1.7; }
.pts svg { color: var(--cyan); margin-top: 3px; flex: none; }
.meter { display: flex; gap: 4px; margin-top: 8px; }
.meter i { flex: 1; height: 3px; border-radius: 2px; background: rgba(124, 160, 255, .18); }
.meter i.on { background: var(--grad); }
.linkish { border: 0; background: none; color: var(--cyan-soft); padding: 0; font-size: 14px; margin-left: 6px; }
.linkish:hover:not(:disabled) { text-decoration: underline; }
/* 只给密码管理器看的用户名：不占位、不可见，但不能 display:none（那样它们就不读了） */
.ghost-user { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
form { gap: 16px !important; }
</style>
