<template>
  <AuthLayout>
    <template #aside>
      <span class="kick"><i />{{ t('auth.register.kick') }}</span>
      <h1>{{ t('auth.register.h1a') }}<br /><span class="lc-gt">{{ t('auth.register.h1b') }}</span></h1>
      <ul class="pts">
        <li><LcIcon name="canvas" /><span><b>{{ t('auth.register.pt1b') }}</b>{{ t('auth.register.pt1') }}</span></li>
        <li><LcIcon name="key" /><span><b>{{ t('auth.register.pt2b') }}</b>{{ t('auth.register.pt2') }}</span></li>
        <li><LcIcon name="shield" /><span><b>{{ t('auth.register.pt3b') }}</b>{{ t('auth.register.pt3') }}</span></li>
      </ul>
    </template>

    <!-- 注册已关闭 -->
    <template v-if="!app.registrationOpen">
      <h2>{{ t('auth.register.closedTitle') }}</h2>
      <div class="lc-alert info closed" role="status"><LcIcon name="lock" /><span>{{ t('auth.register.closedBody') }}</span></div>
      <router-link :to="{ name: 'login', query: route.query }" class="lc-btn primary lg block">{{ t('auth.register.closedLogin') }}</router-link>
    </template>

    <template v-else>
      <h2>{{ t('auth.register.title') }}</h2>
      <p class="sub">{{ t('auth.register.sub') }}</p>

      <form novalidate @submit.prevent="submit">
        <div v-if="formError" class="lc-alert" role="alert"><LcIcon name="warn" /><span>{{ formError }}</span></div>

        <div class="fld">
          <span id="rg-user-l">{{ t('auth.register.username') }}</span>
          <label class="lc-inp" :class="{ 'is-err': errors.username }">
            <LcIcon name="user" />
            <input
              ref="firstEl" v-model.trim="form.username" type="text" name="username" autocomplete="username"
              autocapitalize="none" spellcheck="false" maxlength="32" aria-labelledby="rg-user-l"
              :aria-invalid="!!errors.username" aria-describedby="rg-user-h" @input="errors.username = ''" @blur="touch('username')"
            />
          </label>
          <div id="rg-user-h" class="lc-help" :class="{ err: errors.username }">{{ errors.username || t('auth.register.usernameHint') }}</div>
        </div>

        <div class="fld">
          <span id="rg-email-l">{{ t('auth.register.email') }}</span>
          <label class="lc-inp" :class="{ 'is-err': errors.email }">
            <LcIcon name="mail" />
            <input
              v-model.trim="form.email" type="email" name="email" autocomplete="email" spellcheck="false" maxlength="254"
              aria-labelledby="rg-email-l" :aria-invalid="!!errors.email" aria-describedby="rg-email-h"
              @input="errors.email = ''" @blur="touch('email')"
            />
          </label>
          <div v-if="errors.email" id="rg-email-h" class="lc-help err">{{ errors.email }}</div>
        </div>

        <div class="fld">
          <span id="rg-pw-l">{{ t('auth.register.password') }}</span>
          <label class="lc-inp" :class="{ 'is-err': errors.password }">
            <LcIcon name="lock" />
            <input
              v-model="form.password" :type="showPw ? 'text' : 'password'" name="new-password" autocomplete="new-password" maxlength="128"
              aria-labelledby="rg-pw-l" :aria-invalid="!!errors.password" aria-describedby="rg-pw-h"
              @input="errors.password = ''" @blur="touch('password')"
            />
            <button type="button" class="lc-inp-btn" :aria-label="showPw ? t('auth.hidePassword') : t('auth.showPassword')" :aria-pressed="showPw" @click="showPw = !showPw">
              <LcIcon :name="showPw ? 'eyeoff' : 'eye'" />
            </button>
          </label>
          <div class="meter" aria-hidden="true"><i v-for="n in 4" :key="n" :class="{ on: n <= strength }" /></div>
          <div id="rg-pw-h" class="lc-help" :class="{ err: errors.password }">
            {{ errors.password || t('auth.register.passwordHint') }}<template v-if="!errors.password && strength"> · {{ t('auth.register.strength', { level: t('auth.register.strengthLevels.' + LEVELS[strength]) }) }}</template>
          </div>
        </div>

        <div class="fld">
          <span id="rg-pw2-l">{{ t('auth.register.confirm') }}</span>
          <label class="lc-inp" :class="{ 'is-err': errors.confirm }">
            <LcIcon name="lock" />
            <input
              v-model="form.confirm" :type="showPw ? 'text' : 'password'" name="confirm-password" autocomplete="new-password" maxlength="128"
              :placeholder="t('auth.register.confirmPlaceholder')" aria-labelledby="rg-pw2-l" :aria-invalid="!!errors.confirm" aria-describedby="rg-pw2-h"
              @input="errors.confirm = ''" @blur="touch('confirm')"
            />
          </label>
          <div v-if="errors.confirm" id="rg-pw2-h" class="lc-help err">{{ errors.confirm }}</div>
        </div>

        <p class="lic">{{ t('auth.register.licenseNote') }} <a :href="LINKS.license" target="_blank" rel="noopener">{{ t('auth.register.licenseLink') }}</a></p>

        <button type="submit" class="lc-btn primary lg block" :disabled="busy">
          {{ busy ? t('auth.register.submitting') : t('auth.register.submit') }}
        </button>
      </form>

      <div class="foot">
        {{ t('auth.register.hasAccount') }}<router-link :to="{ name: 'login', query: route.query }">{{ t('auth.register.toLogin') }}</router-link>
      </div>
    </template>
  </AuthLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { safeRedirect } from '@/router'
import { describeAuthError, passwordStrength, USERNAME_RE, EMAIL_RE, PASSWORD_MIN, PASSWORD_MAX } from '@/utils/authErrors'
import { LINKS } from '@/utils/links'
import AuthLayout from '@/components/auth/AuthLayout.vue'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const app = useAppStore()

type Field = 'username' | 'email' | 'password' | 'confirm'
const form = reactive({ username: '', email: '', password: '', confirm: '' })
const errors = reactive<Record<Field, string>>({ username: '', email: '', password: '', confirm: '' })
const formError = ref('')
const showPw = ref(false)
const busy = ref(false)

const LEVELS = ['weak', 'weak', 'fair', 'good', 'strong'] as const
const strength = computed(() => passwordStrength(form.password))

const firstEl = ref<HTMLInputElement | null>(null)
onMounted(() => firstEl.value?.focus())

function check(field: Field): string {
  switch (field) {
    case 'username':
      if (!form.username) return t('auth.errors.usernameRequired')
      return USERNAME_RE.test(form.username) ? '' : t('auth.errors.usernameInvalid')
    case 'email':
      if (!form.email) return t('auth.errors.emailRequired')
      return EMAIL_RE.test(form.email) ? '' : t('auth.errors.emailInvalid')
    case 'password':
      if (!form.password) return t('auth.errors.passwordRequired')
      if (form.password.length < PASSWORD_MIN) return t('auth.errors.passwordShort')
      return form.password.length > PASSWORD_MAX ? t('auth.errors.passwordLong') : ''
    case 'confirm':
      return form.confirm === form.password ? '' : t('auth.errors.confirmMismatch')
  }
}

/** 离开一个填过的输入框时就地校验；空着离开不打扰，等提交时再说 */
function touch(field: Field) {
  if (form[field]) errors[field] = check(field)
}

function validate(): boolean {
  let ok = true
  for (const f of ['username', 'email', 'password', 'confirm'] as Field[]) {
    errors[f] = check(f)
    if (errors[f]) ok = false
  }
  return ok
}

async function submit() {
  if (busy.value) return
  formError.value = ''
  if (!validate()) return
  busy.value = true
  try {
    await app.register(form.username, form.email, form.password)
    await router.replace(safeRedirect(route.query.redirect) || { name: 'home' })
  } catch (err) {
    const f = describeAuthError(err)
    formError.value = f.message
    if (f.fields.username) errors.username = f.fields.username
    if (f.fields.email) errors.email = f.fields.email
    if (f.fields.password) errors.password = f.fields.password
    // 超级管理员刚关了注册：重取一次启动信息，页面跟着变
    if (f.code === 'auth.registration_closed') await app.loadBootstrap()
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.pts { margin: 32px 0 0; padding: 0; list-style: none; display: grid; gap: 14px; }
.pts li { display: flex; gap: 12px; align-items: flex-start; color: var(--text-2); }
.pts svg { color: var(--cyan); margin-top: 2px; }
.pts b { color: var(--text); font-weight: 500; }


.meter { display: flex; gap: 4px; margin-top: 8px; }
.meter i { flex: 1; height: 3px; border-radius: 2px; background: rgb(var(--c-film) / .18); }
.meter i.on { background: var(--grad); }
.lic { font-size: 13px; color: var(--text-2); line-height: 1.6; }
.closed { margin: 20px 0 24px; }
form { gap: 16px !important; }
</style>
