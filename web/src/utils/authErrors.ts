import { apiErrorCode, apiErrorData, apiErrorMessage } from '@/utils/api'
import { t } from '@/locales'

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

/** 把秒数写成人话：不到一分钟用秒，否则进位到分钟 */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds))
  return s < 60 ? t('auth.errors.seconds', { n: s }) : t('auth.errors.minutes', { n: Math.ceil(s / 60) })
}

export interface AuthFailure {
  /** 整个表单层面的提示（放在表单顶部的提示条里） */
  message: string
  /** 落在具体字段上的提示 */
  fields: Partial<Record<'account' | 'username' | 'email' | 'password' | 'currentPassword', string>>
  /** auth.too_many_attempts 时：还要等多少秒 */
  retryAfterSeconds?: number
  code: string
}

/**
 * 把登录 / 注册 / 改密码 / 改资料接口的失败翻成界面文案。
 * 后端的 message 是按 X-Locale 给的，但错误码更稳，所以认得的码一律用本地文案。
 */
export function describeAuthError(err: any): AuthFailure {
  const code = apiErrorCode(err)
  const out: AuthFailure = { message: '', fields: {}, code }
  switch (code) {
    case 'auth.credentials_required':
      out.message = t('auth.errors.credentialsRequired')
      break
    case 'auth.wrong_current_password':
      out.fields.currentPassword = t('auth.errors.wrongCurrentPassword')
      break
    case 'auth.invalid_credentials':
      out.message = t('auth.errors.invalidCredentials')
      break
    case 'auth.account_disabled':
      out.message = t('auth.errors.accountDisabled')
      break
    case 'auth.too_many_attempts': {
      const n = Number(apiErrorData(err).retryAfterSeconds)
      if (Number.isFinite(n) && n > 0) {
        out.retryAfterSeconds = n
        out.message = t('auth.errors.tooManyAttempts', { time: formatWait(n) })
      } else {
        out.message = t('auth.errors.tooManyAttemptsNoTime')
      }
      break
    }
    case 'auth.registration_closed':
      out.message = t('auth.errors.registrationClosed')
      break
    case 'auth.username_taken':
      out.fields.username = t('auth.errors.usernameTaken')
      break
    case 'auth.email_taken':
      out.fields.email = t('auth.errors.emailTaken')
      break
    case 'auth.invalid_username':
      out.fields.username = t('auth.errors.usernameInvalid')
      break
    case 'auth.invalid_email':
      out.fields.email = t('auth.errors.emailInvalid')
      break
    case 'auth.weak_password':
      out.fields.password = t('auth.errors.weakPassword')
      break
    case 'auth.same_password':
      out.fields.password = t('auth.errors.samePassword')
      break
    default:
      out.message = err?.response
        ? t('auth.errors.unknown', { message: apiErrorMessage(err, code || String(err.response.status)) })
        : t('auth.errors.network')
  }
  return out
}

/** 0-4 的密码强度：只是给人一个参考，真正的规则（8–128 位）由后端把关 */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0
  let kinds = 0
  if (/[a-z]/.test(pw)) kinds++
  if (/[A-Z]/.test(pw)) kinds++
  if (/\d/.test(pw)) kinds++
  if (/[^A-Za-z0-9]/.test(pw)) kinds++
  if (pw.length < PASSWORD_MIN) return 1
  if (kinds <= 1) return 1
  if (pw.length >= 14 && kinds >= 3) return 4
  if (pw.length >= 10 && kinds >= 3) return 3
  if (kinds >= 3 || pw.length >= 12) return 3
  return 2
}
