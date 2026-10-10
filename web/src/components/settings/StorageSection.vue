<template>
  <SettingsSection id="storage" icon="disk" :title="t('settings.storage.title')" :desc="t('settings.storage.desc')">
    <SettingsCard v-if="loading">
      <div class="sk" aria-busy="true"><i /><i /><i /></div>
    </SettingsCard>
    <SettingsCard v-else-if="loadError">
      <div class="sec-state">
        <p class="lc-error-text">{{ loadError }}</p>
        <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
      </div>
    </SettingsCard>

    <template v-else-if="status">
      <!-- 存到哪里：二选一。选哪个，下面就只出现那一种的内容 -->
      <SettingsCard :title="t('settings.storage.whereTitle')" :desc="t('settings.storage.whereDesc')">
        <div class="opt where" role="radiogroup" :aria-label="t('settings.storage.whereTitle')">
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
              <b>{{ t('settings.storage.driver.' + d) }}<span v-if="status.driver === d" class="lc-tag ok" data-testid="storage-in-use">{{ t('settings.storage.inUse') }}</span></b>
              <small>{{ t('settings.storage.optionHelp.' + d) }}</small>
            </span>
          </button>
        </div>
      </SettingsCard>

      <!-- ========== 本地磁盘 ========== -->
      <SettingsCard v-if="choice === 'local'" :title="t('settings.storage.driver.local')" :desc="t('settings.storage.local.desc')" data-testid="storage-local">
        <div class="srow low" data-testid="storage-status">
          <div class="k">{{ t('settings.storage.statusLabel') }}</div>
          <div class="v">
            <div v-if="status.driver === 'local'" class="inline">
              <span class="lc-st ok" data-testid="storage-driver">{{ t('settings.storage.local.active') }}</span>
              <span class="lc-chip o" data-testid="storage-source">{{ t('settings.storage.source.' + status.source) }}</span>
            </div>
            <div v-else class="inline">
              <span class="lc-st wait">{{ t('settings.storage.local.inactive') }}</span>
            </div>
          </div>
        </div>
        <div class="srow low">
          <div class="k">{{ t('settings.storage.local.whereLabel') }}</div>
          <div class="v"><p class="txt">{{ t('settings.storage.localLine') }}</p></div>
        </div>
        <div v-if="alsoRead.length" class="srow low">
          <div class="k">{{ t('settings.storage.alsoRead') }}</div>
          <div class="v">
            <div class="chips"><span v-for="(b, i) in alsoRead" :key="i" class="lc-chip also">{{ b }}</span></div>
            <span class="lc-help">{{ t('settings.storage.alsoReadHelp') }}</span>
          </div>
        </div>
        <div class="srow low">
          <div class="k">{{ t('settings.storage.switchLabel') }}</div>
          <div class="v">
            <p class="txt">{{ t('settings.storage.notMoved') }}</p>
            <template v-if="status.driver === 's3'">
              <p class="txt gap">{{ t('settings.storage.backToLocalText') }}</p>
              <button class="lc-btn back" type="button" :disabled="busy" data-testid="storage-back-local" @click="confirmLocal = true">
                {{ t('settings.storage.backToLocal') }}
              </button>
            </template>
          </div>
        </div>
      </SettingsCard>

      <!-- ========== S3 兼容对象存储：选了它才出现 ========== -->
      <form v-else class="stack" autocomplete="off" novalidate data-testid="storage-s3-form" @submit.prevent="save(false)">
        <!-- 现在的情况 -->
        <SettingsCard v-if="status.driver === 's3' && status.s3" :title="t('settings.storage.current')" data-testid="storage-status">
          <template #aside>
            <span class="lc-st ok" data-testid="storage-driver">{{ t('settings.storage.driver.s3') }}</span>
            <span class="lc-chip o" data-testid="storage-source">{{ t('settings.storage.source.' + status.source) }}</span>
          </template>
          <dl class="status-grid">
            <div><dt>{{ t('settings.storage.field.bucket') }}</dt><dd>{{ status.s3.bucket }}{{ status.s3.keyPrefix ? ' / ' + status.s3.keyPrefix : '' }}</dd></div>
            <div><dt>{{ t('settings.storage.endpointHost') }}</dt><dd>{{ status.s3.endpointHost }}</dd></div>
            <div><dt>{{ t('settings.storage.field.delivery') }}</dt><dd class="plain">{{ t('settings.storage.delivery.' + status.delivery) }}</dd></div>
          </dl>
          <p v-if="alsoRead.length" class="txt also-line">
            {{ t('settings.storage.alsoRead') }}
            <span v-for="(b, i) in alsoRead" :key="i" class="lc-chip also">{{ b }}</span>
          </p>
          <div v-if="status.secretUnreadable" class="lc-alert warn status-warn">
            <LcIcon name="warn" /><span>{{ t('settings.storage.secretUnreadable') }}</span>
          </div>
        </SettingsCard>
        <div v-else class="lc-alert info" data-testid="storage-pending">
          <LcIcon name="info" /><span>{{ t('settings.storage.pendingSwitch') }}</span>
        </div>

        <!-- 服务商与地址 -->
        <SettingsCard :title="t('settings.storage.group.provider.title')" :desc="t('settings.storage.group.provider.desc')" data-group="provider">
          <div class="srow">
            <div id="st-preset-lbl" class="k">{{ t('settings.storage.field.preset') }}</div>
            <div class="v">
              <div class="ctl"><LcSelect id="st-preset" v-model="form.preset" :options="presetOptions" :disabled="busy" aria-labelledby="st-preset-lbl" @change="onPresetChange" /></div>
              <ul class="hints" data-testid="storage-hints">
                <li v-for="(line, i) in presetHints" :key="i">{{ line }}</li>
              </ul>
            </div>
          </div>
          <div class="srow">
            <div class="k"><label for="st-endpoint">{{ t('settings.storage.field.endpoint') }}<span v-if="preset.endpointRequired" class="lc-required">*</span></label></div>
            <div class="v">
              <input id="st-endpoint" v-model.trim="form.endpoint" class="lc-input long" :placeholder="preset.endpoint" :disabled="busy" spellcheck="false" @blur="onEndpointBlur" />
              <span class="lc-help">{{ t('settings.storage.help.endpoint') }}</span>
            </div>
          </div>
          <div class="srow">
            <div class="k"><label for="st-region">{{ t('settings.storage.field.region') }}<span v-if="regionRequired" class="lc-required">*</span></label></div>
            <div class="v">
              <input id="st-region" v-model.trim="form.region" class="lc-input" :placeholder="preset.regionExample" :disabled="busy" spellcheck="false" />
            </div>
          </div>
          <div class="srow low">
            <div id="st-path-lbl" class="k">{{ t('settings.storage.field.forcePathStyle') }}</div>
            <div class="v">
              <button
                type="button"
                class="lc-switch"
                :class="{ on: form.forcePathStyle }"
                :disabled="busy"
                role="switch"
                :aria-checked="form.forcePathStyle"
                aria-labelledby="st-path-lbl"
                data-testid="storage-path-style"
                @click="form.forcePathStyle = !form.forcePathStyle"
              />
              <span class="lc-help">{{ t('settings.storage.help.forcePathStyle') }}</span>
            </div>
          </div>
        </SettingsCard>

        <!-- 存储桶 -->
        <SettingsCard :title="t('settings.storage.group.bucket.title')" :desc="t('settings.storage.group.bucket.desc')" data-group="bucket">
          <div class="srow">
            <div class="k"><label for="st-bucket">{{ t('settings.storage.field.bucket') }}<span class="lc-required">*</span></label></div>
            <div class="v">
              <input id="st-bucket" v-model.trim="form.bucket" class="lc-input" :disabled="busy" spellcheck="false" />
            </div>
          </div>
          <div class="srow">
            <div class="k"><label for="st-prefix">{{ t('settings.storage.field.keyPrefix') }}</label></div>
            <div class="v">
              <input id="st-prefix" v-model.trim="form.keyPrefix" class="lc-input" placeholder="loomcanvas" :disabled="busy" spellcheck="false" />
              <span class="lc-help">{{ t('settings.storage.help.keyPrefix') }}</span>
            </div>
          </div>
        </SettingsCard>

        <!-- 凭证 -->
        <SettingsCard :title="t('settings.storage.group.credentials.title')" :desc="t('settings.storage.group.credentials.desc')" data-group="credentials">
          <div class="srow">
            <div class="k"><label for="st-ak">{{ t('settings.storage.field.accessKeyId') }}<span class="lc-required">*</span></label></div>
            <div class="v">
              <input id="st-ak" v-model.trim="form.accessKeyId" class="lc-input" :disabled="busy" autocomplete="off" spellcheck="false" />
            </div>
          </div>
          <div class="srow">
            <div class="k"><label for="st-sk">{{ t('settings.storage.field.secretAccessKey') }}<span v-if="!hasSecret" class="lc-required">*</span></label></div>
            <div class="v">
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
          </div>
        </SettingsCard>

        <!-- 访问与分发 -->
        <SettingsCard :title="t('settings.storage.group.delivery.title')" :desc="t('settings.storage.group.delivery.desc')" data-group="delivery">
          <div class="srow">
            <div class="k"><label for="st-public">{{ t('settings.storage.field.publicBaseUrl') }}</label></div>
            <div class="v">
              <input id="st-public" v-model.trim="form.publicBaseUrl" class="lc-input long" :placeholder="preset.publicExample" :disabled="busy" spellcheck="false" @input="onPublicInput" />
              <span class="lc-help">{{ t('settings.storage.help.publicBaseUrl') }}</span>
            </div>
          </div>
          <div class="srow">
            <div class="k">{{ t('settings.storage.field.delivery') }}</div>
            <div class="v">
              <div class="opt delivery" role="radiogroup" :aria-label="t('settings.storage.field.delivery')">
                <button
                  v-for="d in DELIVERIES"
                  :key="d"
                  type="button"
                  class="optc flat"
                  :class="{ on: form.delivery === d }"
                  role="radio"
                  :aria-checked="form.delivery === d"
                  :disabled="busy || (d === 'redirect' && !form.publicBaseUrl)"
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
              <span v-if="!form.publicBaseUrl" class="lc-help">{{ t('settings.storage.redirectNeedsUrl') }}</span>
            </div>
          </div>
          <div class="srow">
            <div id="st-acl-lbl" class="k">{{ t('settings.storage.field.acl') }}</div>
            <div class="v">
              <div class="ctl"><LcSelect id="st-acl" v-model="form.acl" :options="aclOptions" :disabled="busy" aria-labelledby="st-acl-lbl" /></div>
              <span class="lc-help">{{ t('settings.storage.help.acl') }}</span>
            </div>
          </div>
        </SettingsCard>

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
        <div v-if="error" class="lc-alert" role="alert" data-testid="storage-error"><LcIcon name="warn" /><span>{{ error }}</span></div>

        <SaveBar :dirty="dirty" :note="t('settings.storage.saveNote')">
          <button class="lc-btn" type="button" :disabled="busy" data-testid="storage-test" @click="runTest">
            {{ testing ? t('settings.storage.testing') : t('settings.storage.test') }}
          </button>
          <button class="lc-btn primary quiet" type="submit" :disabled="busy" data-testid="storage-save">
            {{ saving ? t('common.saving') : (status.driver === 's3' ? t('common.save') : t('settings.storage.saveAndSwitch')) }}
          </button>
        </SaveBar>
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
 * 存储（仅超级管理员）：上传和结果存在哪里。
 *
 * 最上面两张选项卡片是「打算用哪种」，下面只出现选中那一种的内容：
 *  - 本地磁盘：现在是不是在用它、文件在哪、切换存储时已有文件怎么办；正在用对象存储时多一个「切回本地磁盘」。
 *  - S3 兼容对象存储：配置表单，按「服务商与地址 / 存储桶 / 凭证 / 访问与分发」分成四张卡片，底下一条是测试和保存。
 * 真正切换发生在保存（先测后存）或确认切回本地的时候，只点选项卡片不会改任何东西。
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
import SettingsCard from './SettingsCard.vue'
import SaveBar from './SaveBar.vue'
import { useSectionDirty } from './dirty'
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
/** 表单上次从服务端拿到时的样子，用来判断有没有改了没存的东西 */
const stored = ref(JSON.stringify(emptyForm()))
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
/** S3 表单里有改了没保存的内容。选回本地磁盘时表单不显示，但填过的还留着，照样算 */
const dirty = computed(() => !!status.value && JSON.stringify(form) !== stored.value)
useSectionDirty(() => dirty.value)
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
  stored.value = JSON.stringify(form)
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

.stack { display: grid; gap: 24px; min-width: 0; }
.where { margin-top: 8px; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.also { height: auto; min-height: 22px; padding: 4px 8px; white-space: normal; word-break: break-all; line-height: 1.4; font-family: var(--f-mono); }
.also-line { margin-top: 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.gap { margin-top: 10px; }
.back { margin-top: 12px; }

.status-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px 24px;
  margin: 8px 0 0;
}
.status-grid dt { font-size: 12px; color: var(--text-3); margin-bottom: 4px; }
.status-grid dd { margin: 0; font-size: 13px; color: var(--text); word-break: break-all; font-family: var(--f-mono); }
.status-grid dd.plain { font-family: inherit; }
.status-warn { margin-top: 14px; }

.srow > .v > .lc-input.long { max-width: 560px; }
.hints {
  margin: 12px 0 0; padding: 12px 14px 12px 30px; border-radius: 10px; max-width: 600px;
  background: rgba(63, 216, 255, .06); border: 1px solid var(--line);
  font-size: 12px; color: var(--text-2); line-height: 1.75;
}
.hints li { word-break: break-word; }
.hints li + li { margin-top: 2px; }
.srow > .v > .lc-switch { display: block; }

.test { padding: 14px 16px; border-radius: var(--r-md); border: 1px solid var(--line-2); }
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

@media (max-width: 720px) {
  .srow > .v > .lc-input.long { max-width: none; }
}
@media (max-width: 600px) { .stack { gap: 16px; } }
</style>
