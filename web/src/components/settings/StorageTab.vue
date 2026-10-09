<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.storage.title') }}</h2>
        <p class="tab-desc">{{ t('settings.storage.desc') }}</p>
      </div>
    </div>

    <div v-if="loading" class="lc-empty">{{ t('common.loading') }}</div>
    <div v-else-if="loadError" class="lc-empty">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <template v-else-if="status">
      <!-- 当前状态 -->
      <div class="lc-card status" data-testid="storage-status">
        <div class="status-head">
          <span class="status-title">{{ t('settings.storage.current') }}</span>
          <span class="lc-tag accent" data-testid="storage-driver">{{ t('settings.storage.driver.' + status.driver) }}</span>
          <span class="lc-tag" data-testid="storage-source">{{ t('settings.storage.source.' + status.source) }}</span>
          <button
            v-if="status.driver === 's3'"
            class="lc-btn sm back-local"
            data-testid="storage-back-local"
            @click="confirmLocal = true"
          >{{ t('settings.storage.backToLocal') }}</button>
        </div>
        <dl v-if="status.driver === 's3' && status.s3" class="status-grid">
          <div><dt>{{ t('settings.storage.field.bucket') }}</dt><dd>{{ status.s3.bucket }}{{ status.s3.keyPrefix ? ' / ' + status.s3.keyPrefix : '' }}</dd></div>
          <div><dt>{{ t('settings.storage.endpointHost') }}</dt><dd>{{ status.s3.endpointHost }}</dd></div>
          <div><dt>{{ t('settings.storage.field.delivery') }}</dt><dd>{{ t('settings.storage.delivery.' + status.delivery) }}</dd></div>
        </dl>
        <p v-else class="status-line">{{ t('settings.storage.localLine') }}</p>
        <p v-if="status.secretUnreadable" class="lc-error-text status-warn">{{ t('settings.storage.secretUnreadable') }}</p>
        <p v-if="alsoRead.length" class="status-line">
          {{ t('settings.storage.alsoRead') }}
          <span v-for="(b, i) in alsoRead" :key="i" class="lc-tag also">{{ b }}</span>
        </p>
        <p class="status-note">{{ t('settings.storage.notMoved') }}</p>
      </div>

      <!-- S3 配置 -->
      <form class="lc-card" autocomplete="off" @submit.prevent="save(false)">
        <h3 class="card-title">{{ t('settings.storage.s3Title') }}</h3>

        <div class="lc-field preset">
          <label for="st-preset">{{ t('settings.storage.field.preset') }}</label>
          <LcSelect id="st-preset" v-model="form.preset" :options="presetOptions" :disabled="busy" @change="onPresetChange" />
        </div>
        <ul class="hints" data-testid="storage-hints">
          <li v-for="(line, i) in presetHints" :key="i">{{ line }}</li>
        </ul>

        <div class="form-grid">
          <div class="lc-field wide">
            <label for="st-endpoint">{{ t('settings.storage.field.endpoint') }}<span v-if="preset.endpointRequired" class="lc-required">*</span></label>
            <input id="st-endpoint" v-model.trim="form.endpoint" class="lc-input" :placeholder="preset.endpoint" :disabled="busy" spellcheck="false" @blur="onEndpointBlur" />
            <span class="lc-help">{{ t('settings.storage.help.endpoint') }}</span>
          </div>
          <div class="lc-field">
            <label for="st-bucket">{{ t('settings.storage.field.bucket') }}<span class="lc-required">*</span></label>
            <input id="st-bucket" v-model.trim="form.bucket" class="lc-input" :disabled="busy" spellcheck="false" />
          </div>
          <div class="lc-field">
            <label for="st-region">{{ t('settings.storage.field.region') }}<span v-if="regionRequired" class="lc-required">*</span></label>
            <input id="st-region" v-model.trim="form.region" class="lc-input" :placeholder="preset.regionExample" :disabled="busy" spellcheck="false" />
          </div>
          <div class="lc-field">
            <label for="st-ak">{{ t('settings.storage.field.accessKeyId') }}<span class="lc-required">*</span></label>
            <input id="st-ak" v-model.trim="form.accessKeyId" class="lc-input" :disabled="busy" autocomplete="off" spellcheck="false" />
          </div>
          <div class="lc-field">
            <label for="st-sk">{{ t('settings.storage.field.secretAccessKey') }}<span v-if="!hasSecret" class="lc-required">*</span></label>
            <input
              id="st-sk"
              v-model="form.secretAccessKey"
              class="lc-input"
              type="password"
              autocomplete="new-password"
              :placeholder="secretPlaceholder"
              :disabled="busy"
            />
            <span class="lc-help">{{ hasSecret ? t('settings.storage.help.secretKeep') : t('settings.storage.help.secret') }}</span>
          </div>
          <div class="lc-field">
            <label for="st-prefix">{{ t('settings.storage.field.keyPrefix') }}</label>
            <input id="st-prefix" v-model.trim="form.keyPrefix" class="lc-input" placeholder="loomcanvas" :disabled="busy" spellcheck="false" />
            <span class="lc-help">{{ t('settings.storage.help.keyPrefix') }}</span>
          </div>
          <div class="lc-field">
            <label for="st-acl">{{ t('settings.storage.field.acl') }}</label>
            <LcSelect id="st-acl" v-model="form.acl" :options="aclOptions" :disabled="busy" />
            <span class="lc-help">{{ t('settings.storage.help.acl') }}</span>
          </div>
        </div>

        <label class="switch-row">
          <button
            type="button"
            class="lc-switch"
            :class="{ on: form.forcePathStyle }"
            :disabled="busy"
            role="switch"
            :aria-checked="form.forcePathStyle"
            data-testid="storage-path-style"
            @click="form.forcePathStyle = !form.forcePathStyle"
          />
          <span>
            {{ t('settings.storage.field.forcePathStyle') }}
            <span class="lc-help inline">{{ t('settings.storage.help.forcePathStyle') }}</span>
          </span>
        </label>

        <h4 class="section-title">{{ t('settings.storage.deliveryTitle') }}</h4>
        <div class="form-grid">
          <div class="lc-field wide">
            <label for="st-public">{{ t('settings.storage.field.publicBaseUrl') }}</label>
            <input id="st-public" v-model.trim="form.publicBaseUrl" class="lc-input" :placeholder="preset.publicExample" :disabled="busy" spellcheck="false" @input="onPublicInput" />
            <span class="lc-help">{{ t('settings.storage.help.publicBaseUrl') }}</span>
          </div>
        </div>
        <div class="delivery" role="radiogroup" :aria-label="t('settings.storage.field.delivery')">
          <label v-for="d in DELIVERIES" :key="d" class="delivery-opt" :class="{ on: form.delivery === d, off: d === 'redirect' && !form.publicBaseUrl }">
            <input v-model="form.delivery" type="radio" name="st-delivery" :value="d" :disabled="busy || (d === 'redirect' && !form.publicBaseUrl)" />
            <span class="delivery-text">
              <strong>{{ t('settings.storage.delivery.' + d) }}</strong>
              <span>{{ t('settings.storage.deliveryHelp.' + d) }}</span>
            </span>
          </label>
        </div>

        <!-- 连接测试结果 -->
        <div v-if="testResult" class="test" :class="testResult.ok ? 'ok' : 'err'" data-testid="storage-test-result">
          <p class="test-message">{{ testResult.message }}</p>
          <ol v-if="testResult.steps.length" class="steps">
            <li v-for="s in testResult.steps" :key="s.step" :class="s.status">
              <span class="dot" aria-hidden="true" />
              <span class="step-name">{{ t('settings.storage.step.' + s.step) }}</span>
              <span class="step-status">{{ t('settings.storage.stepStatus.' + s.status) }}<template v-if="s.status !== 'skipped' && typeof s.ms === 'number'"> · {{ s.ms }} ms</template></span>
            </li>
          </ol>
        </div>
        <p v-if="error" class="lc-error-text form-error" data-testid="storage-error">{{ error }}</p>

        <div class="tab-foot">
          <button class="lc-btn" type="button" :disabled="busy" data-testid="storage-test" @click="runTest">
            {{ testing ? t('settings.storage.testing') : t('settings.storage.test') }}
          </button>
          <button class="lc-btn primary" type="submit" :disabled="busy" data-testid="storage-save">
            {{ saving ? t('common.saving') : (status.driver === 's3' ? t('common.save') : t('settings.storage.saveAndSwitch')) }}
          </button>
          <span class="foot-note">{{ t('settings.storage.saveNote') }}</span>
        </div>
      </form>
    </template>

    <!-- 测试没过，是否仍然保存 -->
    <div v-if="confirmForce" class="lc-mask" @click.self="confirmForce = false">
      <div class="lc-dialog confirm">
        <div class="lc-dialog-head"><span>{{ t('settings.storage.forceTitle') }}</span></div>
        <div class="lc-dialog-body">
          <p class="lc-error-text">{{ testResult?.message }}</p>
          <p>{{ t('settings.storage.forceText') }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="saving" @click="confirmForce = false">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" :disabled="saving" data-testid="storage-force" @click="save(true)">{{ t('settings.storage.forceSave') }}</button>
        </div>
      </div>
    </div>

    <!-- 切回本地磁盘 -->
    <div v-if="confirmLocal" class="lc-mask" @click.self="confirmLocal = false">
      <div class="lc-dialog confirm">
        <div class="lc-dialog-head"><span>{{ t('settings.storage.backToLocal') }}</span></div>
        <div class="lc-dialog-body">
          <p>{{ t('settings.storage.backToLocalText') }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="saving" @click="confirmLocal = false">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary" :disabled="saving" data-testid="storage-back-local-ok" @click="switchToLocal">{{ t('settings.storage.backToLocal') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 存储设置：当前用的是哪种存储、这个决定来自哪里，以及 S3 兼容对象存储的配置表单。
 *
 * 密钥只写不读：后端只告诉我们「已设置」和末四位，留空提交表示沿用已保存的那一把。
 * 「预设」只是帮忙填默认值和给出提示的标签，真正起作用的是下面一项项明确的设置。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import LcSelect from '@/components/LcSelect.vue'
import type { StoragePreset, StorageS3Form, StorageStatus, StorageTestResult } from '@/types'

const { t, tm, rt } = useI18n()

const PRESET_KEYS: StoragePreset[] = ['aws', 'r2', 'oss', 'minio', 'custom']
const DELIVERIES = ['proxy', 'redirect'] as const
const presetOptions = computed(() => PRESET_KEYS.map(p => ({ value: p, label: t('settings.storage.preset.' + p) })))
/** private / public-read 是 S3 的取值本身，不翻译 */
const aclOptions = computed<{ value: StorageS3Form['acl']; label: string }[]>(() => [
  { value: '', label: t('settings.storage.acl.none') },
  { value: 'private', label: 'private' },
  { value: 'public-read', label: 'public-read' },
])

/** 各家的地址写法与默认值。占位里的示例是格式，不是能直接用的值。 */
const PRESETS: Record<StoragePreset, {
  endpoint: string; endpointRequired: boolean; region: string; regionExample: string; forcePathStyle: boolean; publicExample: string
}> = {
  aws: { endpoint: 'https://s3.eu-west-1.amazonaws.com', endpointRequired: false, region: '', regionExample: 'eu-west-1', forcePathStyle: false, publicExample: 'https://cdn.example.com' },
  r2: { endpoint: 'https://<accountid>.r2.cloudflarestorage.com', endpointRequired: true, region: 'auto', regionExample: 'auto', forcePathStyle: false, publicExample: 'https://pub-xxxxxxxx.r2.dev' },
  oss: { endpoint: 'https://oss-cn-hangzhou.aliyuncs.com', endpointRequired: true, region: '', regionExample: 'oss-cn-hangzhou', forcePathStyle: false, publicExample: 'https://cdn.example.com' },
  minio: { endpoint: 'http://127.0.0.1:9000', endpointRequired: true, region: 'us-east-1', regionExample: 'us-east-1', forcePathStyle: true, publicExample: 'http://127.0.0.1:9000/my-bucket' },
  custom: { endpoint: 'https://s3.example.com', endpointRequired: true, region: 'us-east-1', regionExample: 'us-east-1', forcePathStyle: false, publicExample: 'https://cdn.example.com' },
}

function emptyForm(): StorageS3Form {
  return {
    preset: 'aws', endpoint: '', region: '', bucket: '', accessKeyId: '', secretAccessKey: '',
    forcePathStyle: false, keyPrefix: '', publicBaseUrl: '', delivery: 'proxy', acl: '',
  }
}

const status = ref<StorageStatus | null>(null)
const form = reactive<StorageS3Form>(emptyForm())
const loading = ref(true)
const loadError = ref('')
const testing = ref(false)
const saving = ref(false)
const error = ref('')
const testResult = ref<StorageTestResult | null>(null)
const confirmForce = ref(false)
const confirmLocal = ref(false)

const busy = computed(() => testing.value || saving.value)
const preset = computed(() => PRESETS[form.preset])
/** AWS 和 OSS 的地域因桶而异，没有能替用户填的默认值 */
const regionRequired = computed(() => form.preset === 'aws' || form.preset === 'oss')
const presetHints = computed(() => (tm('settings.storage.hints.' + form.preset) as unknown[]).map((m) => rt(m as string)))
const hasSecret = computed(() => !!status.value?.s3?.hasSecret && !status.value.secretUnreadable)
const secretPlaceholder = computed(() => {
  if (!hasSecret.value) return ''
  const tail = status.value?.s3?.secretTail
  return tail ? t('settings.providers.secretSetTail', { tail }) : t('settings.providers.secretSet')
})
/** 不再写入、但仍在读取的存储桶 */
const alsoRead = computed(() => {
  const s = status.value
  if (!s) return []
  const list = s.previous.map((p) => `${p.endpointHost} / ${p.bucket}${p.keyPrefix ? ' / ' + p.keyPrefix : ''}`)
  if (s.driver === 'local' && s.s3) list.unshift(`${s.s3.endpointHost} / ${s.s3.bucket}${s.s3.keyPrefix ? ' / ' + s.s3.keyPrefix : ''}`)
  return list
})

function applyStatus(s: StorageStatus) {
  status.value = s
  const next = emptyForm()
  if (s.s3) {
    const { hasSecret: _h, secretTail: _t, endpointHost: _e, ...saved } = s.s3
    Object.assign(next, saved)
  }
  Object.assign(form, next)
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    applyStatus(unwrap(await adminApi.storage()))
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 换预设：Endpoint 是各家自己的，清掉重填；地域和路径风格换成这一家的默认值；其余填过的不动 */
function onPresetChange() {
  form.endpoint = ''
  form.region = preset.value.region
  form.forcePathStyle = preset.value.forcePathStyle
  testResult.value = null
}

/** 阿里云 OSS 的地域就写在 Endpoint 里，没填地域时顺手带出来 */
function onEndpointBlur() {
  if (form.preset !== 'oss' || form.region) return
  const m = /^https?:\/\/(oss-[a-z0-9-]+?)(-internal)?\.aliyuncs\.com\/?$/i.exec(form.endpoint)
  if (m) form.region = m[1].toLowerCase()
}

/** 公开地址清空后只能由本站转发 */
function onPublicInput() {
  if (!form.publicBaseUrl) form.delivery = 'proxy'
}

function validate(): string {
  const need = (key: keyof StorageS3Form) => t('settings.storage.required', { field: t('settings.storage.field.' + key) })
  if (preset.value.endpointRequired && !form.endpoint) return need('endpoint')
  if (!form.bucket) return need('bucket')
  if (!form.region && regionRequired.value) return need('region')
  if (!form.accessKeyId) return need('accessKeyId')
  if (!form.secretAccessKey && !hasSecret.value) return need('secretAccessKey')
  return ''
}

async function runTest() {
  error.value = validate()
  testResult.value = null
  if (error.value) return
  testing.value = true
  try {
    testResult.value = unwrap(await adminApi.testStorage({ ...form }))
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    testing.value = false
  }
}

/** 保存并立即生效。后端会先测一遍；没过就不保存，除非 force。 */
async function save(force: boolean) {
  error.value = validate()
  if (error.value) return
  saving.value = true
  try {
    applyStatus(unwrap(await adminApi.saveStorage({ driver: 's3', s3: { ...form }, ...(force ? { force: true } : {}) })))
    confirmForce.value = false
    if (!force) testResult.value = null
    MessagePlugin.success(t('settings.storage.savedS3'))
  } catch (err: any) {
    const data = err?.response?.data
    if (data?.code === 'storage.save_needs_test' && data.data?.test) {
      testResult.value = data.data.test as StorageTestResult
      confirmForce.value = true
    } else {
      confirmForce.value = false
      error.value = apiErrorMessage(err, t('common.operationFailed'))
    }
  } finally {
    saving.value = false
  }
}

async function switchToLocal() {
  saving.value = true
  try {
    applyStatus(unwrap(await adminApi.saveStorage({ driver: 'local' })))
    confirmLocal.value = false
    testResult.value = null
    error.value = ''
    MessagePlugin.success(t('settings.storage.savedLocal'))
  } catch (err) {
    confirmLocal.value = false
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
@import './tab-shared.css';
.retry { margin-top: 12px; }

.status { margin-bottom: 16px; }
.status-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.status-title { font-size: 14.5px; font-weight: 600; color: var(--t-max); margin-right: 4px; }
.back-local { margin-left: auto; }
.status-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px 20px;
  margin: 14px 0 0;
}
.status-grid dt { font-size: 12px; color: var(--t-dim); margin-bottom: 3px; }
.status-grid dd { margin: 0; font-size: 13.5px; color: var(--t-strong); word-break: break-all; }
.status-line { margin-top: 12px; font-size: 13px; color: var(--t-body); line-height: 1.7; }
.status-warn { margin-top: 12px; }
.status-note {
  margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--n-5);
  font-size: 12.5px; color: var(--t-dim); line-height: 1.7;
}
.also { margin-left: 6px; word-break: break-all; }

.card-title { font-size: 14.5px; font-weight: 600; color: var(--t-max); margin-bottom: 14px; }
.preset { max-width: 320px; }
.hints {
  margin: 0 0 18px; padding: 12px 14px 12px 30px; border-radius: 8px;
  background: var(--accent-ghost); border: 1px solid var(--n-5);
  font-size: 12.5px; color: var(--t-body); line-height: 1.75;
}
.hints li { word-break: break-word; }
.wide { grid-column: 1 / -1; }
.switch-row { display: flex; align-items: flex-start; gap: 10px; margin: 4px 0 6px; font-size: 13px; color: var(--t-body); cursor: pointer; }
.switch-row .lc-switch { flex: none; margin-top: 1px; }
.lc-help.inline { display: block; margin-top: 3px; font-size: 12px; color: var(--t-dim); line-height: 1.6; }

.delivery { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
.delivery-opt {
  display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px;
  border: 1px solid var(--n-5); border-radius: 8px; cursor: pointer;
}
.delivery-opt.on { border-color: var(--accent-line); background: var(--accent-ghost); }
.delivery-opt.off { opacity: .55; cursor: not-allowed; }
.delivery-opt input { margin-top: 3px; accent-color: var(--accent-text); }
.delivery-text { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--t-dim); line-height: 1.6; }
.delivery-text strong { font-size: 13px; font-weight: 600; color: var(--t-strong); }

.test { margin-top: 18px; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--n-5); }
.test.ok { border-color: var(--success); background: var(--success-dim); }
.test.err { border-color: var(--danger); background: var(--danger-dim); }
.test-message { font-size: 13px; line-height: 1.65; color: var(--t-max); word-break: break-word; }
.steps { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.steps li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--t-body); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--t-dim); flex: none; }
.steps li.ok .dot { background: var(--success); }
.steps li.failed .dot { background: var(--danger); }
.step-name { min-width: 0; }
.step-status { margin-left: auto; color: var(--t-dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
.form-error { margin-top: 14px; }
.tab-foot { flex-wrap: wrap; }
.foot-note { font-size: 12px; color: var(--t-dim); line-height: 1.6; flex: 1 1 220px; }

.confirm { width: 440px; }
.confirm p { line-height: 1.65; }
.confirm p + p { margin-top: 10px; }
</style>
