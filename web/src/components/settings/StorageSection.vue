<template>
  <SettingsSection id="storage" icon="disk" :title="t('settings.storage.title')" :desc="t('settings.storage.desc')">
    <div v-if="loading" class="sk" aria-busy="true"><i /><i /><i /></div>
    <div v-else-if="loadError" class="sec-state">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
    </div>

    <template v-else-if="status">
      <!-- 存到哪里：二选一 -->
      <div class="opt" role="radiogroup" :aria-label="t('settings.storage.title')">
        <button
          v-for="d in DRIVERS"
          :key="d"
          type="button"
          class="optc"
          :class="{ on: choice === d }"
          role="radio"
          :aria-checked="choice === d"
          :disabled="busy"
          :data-testid="'storage-opt-' + d"
          @click="choice = d"
        >
          <span class="rd" aria-hidden="true" />
          <span>
            <b>{{ t('settings.storage.driver.' + d) }}</b>
            <small>{{ t('settings.storage.optionHelp.' + d) }}</small>
          </span>
        </button>
      </div>

      <!-- 当前状态 -->
      <div class="srow top first" data-testid="storage-status">
        <div class="k">
          <b>{{ t('settings.storage.current') }}</b>
        </div>
        <div class="v">
          <div class="status-head">
            <span class="lc-st ok" data-testid="storage-driver">{{ t('settings.storage.driver.' + status.driver) }}</span>
            <span class="lc-chip o" data-testid="storage-source">{{ t('settings.storage.source.' + status.source) }}</span>
          </div>
          <dl v-if="status.driver === 's3' && status.s3" class="status-grid">
            <div><dt>{{ t('settings.storage.field.bucket') }}</dt><dd>{{ status.s3.bucket }}{{ status.s3.keyPrefix ? ' / ' + status.s3.keyPrefix : '' }}</dd></div>
            <div><dt>{{ t('settings.storage.endpointHost') }}</dt><dd>{{ status.s3.endpointHost }}</dd></div>
            <div><dt>{{ t('settings.storage.field.delivery') }}</dt><dd>{{ t('settings.storage.delivery.' + status.delivery) }}</dd></div>
          </dl>
          <p v-else class="status-line">{{ t('settings.storage.localLine') }}</p>
          <div v-if="status.secretUnreadable" class="lc-alert warn status-warn">
            <LcIcon name="warn" /><span>{{ t('settings.storage.secretUnreadable') }}</span>
          </div>
          <p v-if="alsoRead.length" class="status-line">
            {{ t('settings.storage.alsoRead') }}
            <span v-for="(b, i) in alsoRead" :key="i" class="lc-chip also">{{ b }}</span>
          </p>
          <p class="lc-help note">{{ t('settings.storage.notMoved') }}</p>
        </div>
      </div>

      <!-- 正在用对象存储、选回了本地 -->
      <div v-if="status.driver === 's3' && choice === 'local'" class="srow top">
        <div class="k">
          <b>{{ t('settings.storage.backToLocal') }}</b>
          <small>{{ t('settings.storage.backToLocalText') }}</small>
        </div>
        <div class="v">
          <button class="lc-btn" type="button" :disabled="busy" data-testid="storage-back-local" @click="confirmLocal = true">
            {{ t('settings.storage.backToLocal') }}
          </button>
        </div>
      </div>

      <!-- S3 配置：没选它时整体变淡但保留可见，提前知道要填什么 -->
      <form autocomplete="off" :class="{ dim: !s3On }" @submit.prevent="save(false)">
        <div class="srow top">
          <div class="k">
            <b>{{ t('settings.storage.s3Title') }}</b>
            <small>{{ t('settings.storage.s3Help') }}</small>
          </div>
          <div class="v">
            <div class="fld preset">
              <label for="st-preset">{{ t('settings.storage.field.preset') }}</label>
              <LcSelect id="st-preset" v-model="form.preset" :options="presetOptions" :disabled="off" @change="onPresetChange" />
            </div>
            <ul v-if="s3On" class="hints" data-testid="storage-hints">
              <li v-for="(line, i) in presetHints" :key="i">{{ line }}</li>
            </ul>

            <div class="g2">
              <div class="fld wide">
                <label for="st-endpoint">{{ t('settings.storage.field.endpoint') }}<span v-if="preset.endpointRequired" class="lc-required">*</span></label>
                <input id="st-endpoint" v-model.trim="form.endpoint" class="lc-input" :placeholder="preset.endpoint" :disabled="off" spellcheck="false" @blur="onEndpointBlur" />
                <span class="lc-help">{{ t('settings.storage.help.endpoint') }}</span>
              </div>
              <div class="fld">
                <label for="st-bucket">{{ t('settings.storage.field.bucket') }}<span class="lc-required">*</span></label>
                <input id="st-bucket" v-model.trim="form.bucket" class="lc-input" :disabled="off" spellcheck="false" />
              </div>
              <div class="fld">
                <label for="st-region">{{ t('settings.storage.field.region') }}<span v-if="regionRequired" class="lc-required">*</span></label>
                <input id="st-region" v-model.trim="form.region" class="lc-input" :placeholder="preset.regionExample" :disabled="off" spellcheck="false" />
              </div>
              <div class="fld">
                <label for="st-ak">{{ t('settings.storage.field.accessKeyId') }}<span class="lc-required">*</span></label>
                <input id="st-ak" v-model.trim="form.accessKeyId" class="lc-input" :disabled="off" autocomplete="off" spellcheck="false" />
              </div>
              <div class="fld">
                <label for="st-sk">{{ t('settings.storage.field.secretAccessKey') }}<span v-if="!hasSecret" class="lc-required">*</span></label>
                <input
                  id="st-sk"
                  v-model="form.secretAccessKey"
                  class="lc-input"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="secretPlaceholder"
                  :disabled="off"
                />
                <span class="lc-help">{{ hasSecret ? t('settings.storage.help.secretKeep') : t('settings.storage.help.secret') }}</span>
              </div>
              <div class="fld">
                <label for="st-prefix">{{ t('settings.storage.field.keyPrefix') }}</label>
                <input id="st-prefix" v-model.trim="form.keyPrefix" class="lc-input" placeholder="loomcanvas" :disabled="off" spellcheck="false" />
                <span class="lc-help">{{ t('settings.storage.help.keyPrefix') }}</span>
              </div>
              <div class="fld">
                <label for="st-acl">{{ t('settings.storage.field.acl') }}</label>
                <LcSelect id="st-acl" v-model="form.acl" :options="aclOptions" :disabled="off" />
                <span class="lc-help">{{ t('settings.storage.help.acl') }}</span>
              </div>
            </div>

            <div class="switch-row">
              <button
                type="button"
                class="lc-switch"
                :class="{ on: form.forcePathStyle }"
                :disabled="off"
                role="switch"
                :aria-checked="form.forcePathStyle"
                aria-labelledby="st-path-lbl"
                data-testid="storage-path-style"
                @click="form.forcePathStyle = !form.forcePathStyle"
              />
              <span>
                <span id="st-path-lbl">{{ t('settings.storage.field.forcePathStyle') }}</span>
                <span class="lc-help blk">{{ t('settings.storage.help.forcePathStyle') }}</span>
              </span>
            </div>
          </div>
        </div>

        <div class="srow top">
          <div class="k">
            <b>{{ t('settings.storage.deliveryTitle') }}</b>
            <small>{{ t('settings.storage.help.publicBaseUrl') }}</small>
          </div>
          <div class="v">
            <div class="fld">
              <label for="st-public">{{ t('settings.storage.field.publicBaseUrl') }}</label>
              <input id="st-public" v-model.trim="form.publicBaseUrl" class="lc-input" :placeholder="preset.publicExample" :disabled="off" spellcheck="false" @input="onPublicInput" />
            </div>
            <div class="opt delivery" role="radiogroup" :aria-label="t('settings.storage.field.delivery')">
              <button
                v-for="d in DELIVERIES"
                :key="d"
                type="button"
                class="optc flat"
                :class="{ on: form.delivery === d }"
                role="radio"
                :aria-checked="form.delivery === d"
                :disabled="off || (d === 'redirect' && !form.publicBaseUrl)"
                :data-testid="'storage-delivery-' + d"
                @click="form.delivery = d"
              >
                <span class="rd" aria-hidden="true" />
                <span>
                  <b>{{ t('settings.storage.delivery.' + d) }}</b>
                  <small>{{ t('settings.storage.deliveryHelp.' + d) }}</small>
                </span>
              </button>
            </div>
          </div>
        </div>

        <template v-if="s3On">
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
          <p v-if="error" class="lc-error-text sec-err" data-testid="storage-error">{{ error }}</p>

          <div class="sec-foot">
            <button class="lc-btn" type="button" :disabled="busy" data-testid="storage-test" @click="runTest">
              {{ testing ? t('settings.storage.testing') : t('settings.storage.test') }}
            </button>
            <button class="lc-btn primary quiet" type="submit" :disabled="busy" data-testid="storage-save">
              {{ saving ? t('common.saving') : (status.driver === 's3' ? t('common.save') : t('settings.storage.saveAndSwitch')) }}
            </button>
            <span class="note">{{ t('settings.storage.saveNote') }}</span>
          </div>
        </template>
      </form>
    </template>

    <!-- 测试没过，是否仍然保存 -->
    <div v-if="confirmForce" class="lc-mask" @click.self="confirmForce = false">
      <div class="lc-dialog dlg" role="dialog" aria-modal="true">
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
      <div class="lc-dialog dlg" role="dialog" aria-modal="true">
        <div class="lc-dialog-head"><span>{{ t('settings.storage.backToLocal') }}</span></div>
        <div class="lc-dialog-body">
          <p>{{ t('settings.storage.backToLocalText') }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="saving" @click="confirmLocal = false">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary quiet" :disabled="saving" data-testid="storage-back-local-ok" @click="switchToLocal">{{ t('settings.storage.backToLocal') }}</button>
        </div>
      </div>
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * 存储：当前用的是哪种存储、这个决定来自哪里，以及 S3 兼容对象存储的配置表单。
 *
 * 上面两张选项卡片只是「打算用哪种」：选了 S3 才能填表，真正切换发生在保存（先测后存）或确认切回本地的时候。
 * 密钥只写不读：后端只告诉我们「已设置」和末四位，留空提交表示沿用已保存的那一把。
 * 「预设」只是帮忙填默认值和给出提示的标签，真正起作用的是下面一项项明确的设置。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { useAppStore } from '@/stores/app'
import LcSelect from '@/components/LcSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import SettingsSection from './SettingsSection.vue'
import type { StoragePreset, StorageS3Form, StorageStatus, StorageTestResult } from '@/types'

const { t, tm, rt } = useI18n()

const DRIVERS = ['local', 's3'] as const
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
/** 选项卡片上选中的那一种；和当前生效的不一样时，下面给出对应的下一步 */
const choice = ref<'local' | 's3'>('local')
const loading = ref(true)
const loadError = ref('')
const testing = ref(false)
const saving = ref(false)
const error = ref('')
const testResult = ref<StorageTestResult | null>(null)
const confirmForce = ref(false)
const confirmLocal = ref(false)

const busy = computed(() => testing.value || saving.value)
const s3On = computed(() => choice.value === 's3')
/** 表单里的控件此刻不能动：正在测 / 存，或者没选 S3 */
const off = computed(() => busy.value || !s3On.value)
const preset = computed(() => PRESETS[form.preset])
/** AWS 和 OSS 的地域因桶而异，没有能替用户填的默认值 */
const regionRequired = computed(() => form.preset === 'aws' || form.preset === 'oss')
const presetHints = computed(() => (tm('settings.storage.hints.' + form.preset) as unknown[]).map((m) => rt(m as string)))
const hasSecret = computed(() => !!status.value?.s3?.hasSecret && !status.value.secretUnreadable)
const secretPlaceholder = computed(() => {
  if (!hasSecret.value) return ''
  const tail = status.value?.s3?.secretTail
  return tail ? t('settings.storage.secretSetTail', { tail }) : t('settings.storage.secretSet')
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
  choice.value = s.driver
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
  if (!s3On.value) return
  error.value = validate()
  if (error.value) return
  saving.value = true
  try {
    applyStatus(unwrap(await adminApi.saveStorage({ driver: 's3', s3: { ...form }, ...(force ? { force: true } : {}) })))
    confirmForce.value = false
    if (!force) testResult.value = null
    MessagePlugin.success(t('settings.storage.savedS3'))
    // 「上游能不能按地址读到文件」跟着存储变，画布上的提示要用新的
    void useAppStore().loadBootstrap()
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
    void useAppStore().loadBootstrap()
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
@import './section-shared.css';

.srow.first { margin-top: 16px; }
.status-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.status-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px 20px;
  margin: 12px 0 0;
}
.status-grid dt { font-size: 12px; color: var(--text-3); margin-bottom: 2px; }
.status-grid dd { margin: 0; font-size: 13px; color: var(--text); word-break: break-all; font-family: var(--f-mono); }
.status-line { margin-top: 8px; font-size: 13px; color: var(--text-2); line-height: 1.7; }
.status-warn { margin-top: 12px; }
.note { margin-top: 8px; max-width: 640px; }
.also { margin: 2px 0 2px 6px; height: auto; min-height: 22px; padding: 4px 8px; white-space: normal; word-break: break-all; line-height: 1.4; font-family: var(--f-mono); }

form.dim .srow { opacity: .55; }
.preset { max-width: 320px; margin-bottom: 12px; }
.hints {
  margin: 0 0 16px; padding: 12px 14px 12px 30px; border-radius: 10px;
  background: rgba(63, 216, 255, .06); border: 1px solid var(--line);
  font-size: 12px; color: var(--text-2); line-height: 1.75;
}
.hints li { word-break: break-word; }
.switch-row { display: flex; align-items: flex-start; gap: 12px; margin-top: 16px; font-size: 13px; color: var(--text); }
.switch-row .lc-switch { margin-top: 1px; }
.lc-help.blk { display: block; margin-top: 2px; }
.delivery { margin-top: 12px; }

.test { margin: 4px 0 16px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line-2); }
.test.ok { border-color: rgba(62, 230, 168, .45); background: var(--success-dim); }
.test.err { border-color: rgba(255, 107, 139, .45); background: var(--danger-dim); }
.test-message { font-size: 13px; line-height: 1.65; color: var(--text); word-break: break-word; }
.steps { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.steps li { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex: none; }
.steps li.ok .dot { background: var(--ok); }
.steps li.failed .dot { background: var(--err); }
.step-name { min-width: 0; }
.step-status { margin-left: auto; color: var(--text-3); white-space: nowrap; font: 12px var(--f-mono); }
</style>
