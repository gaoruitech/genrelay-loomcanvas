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
      <!-- 现在的情况：新文件存到哪、存不存得下来、怎样交给上游、读取时会去找的每一个存储 -->
      <StorageHealth
        :status="status" :refreshing="refreshing" :checked-at="checkedAt" :polling="polling ? POLL_SECONDS : 0"
        @refresh="refresh" @fix-secret="focusField('st-sk')" @go-presign="focusField('st-presign')" @changed="applyHealth"
      />

      <!-- 存到哪里：二选一。选哪个，下面就只出现那一种的内容 -->
      <SettingsCard :title="t('settings.storage.whereTitle')" :desc="t('settings.storage.whereDesc')">
        <div ref="whereEl" class="opt where" role="radiogroup" :aria-label="t('settings.storage.whereTitle')">
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
        <div class="srow low">
          <div class="k">{{ t('settings.storage.statusLabel') }}</div>
          <div class="v">
            <div class="inline">
              <span v-if="status.driver === 'local'" class="lc-st ok">{{ t('settings.storage.local.active') }}</span>
              <span v-else class="lc-st wait">{{ t('settings.storage.local.inactive') }}</span>
            </div>
          </div>
        </div>
        <div class="srow low">
          <div class="k">{{ t('settings.storage.local.whereLabel') }}</div>
          <div class="v"><p class="txt">{{ t('settings.storage.localLine') }}</p></div>
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
        <div v-if="status.driver !== 's3'" class="lc-alert info" data-testid="storage-pending">
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
              <input
                id="st-endpoint" v-model.trim="form.endpoint" class="lc-input long" :class="{ 'is-err': fieldError.endpoint }"
                :placeholder="preset.endpoint" :disabled="busy" spellcheck="false" inputmode="url"
                :aria-invalid="fieldError.endpoint ? true : undefined" aria-describedby="st-endpoint-help"
                @input="fieldError.endpoint = ''" @blur="onEndpointBlur"
              />
              <span v-if="fieldError.endpoint" class="lc-help err" role="alert" data-testid="storage-endpoint-error">{{ fieldError.endpoint }}</span>
              <span id="st-endpoint-help" class="lc-help">{{ t('settings.storage.help.endpoint') }}</span>
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
            <div class="k"><label for="st-sk">{{ t('settings.storage.field.secretAccessKey') }}<span v-if="!secretReusable" class="lc-required" data-testid="storage-secret-required">*</span></label></div>
            <div class="v">
              <input
                id="st-sk"
                ref="secretEl"
                v-model="form.secretAccessKey"
                class="lc-input"
                :class="{ 'is-err': secretError }"
                type="password"
                autocomplete="new-password"
                :placeholder="secretPlaceholder"
                :disabled="busy"
                :aria-invalid="secretError ? true : undefined"
                aria-describedby="st-sk-help"
                @input="secretError = ''"
              />
              <span v-if="secretError" class="lc-help err" role="alert" data-testid="storage-secret-error">{{ secretError }}</span>
              <!-- 报错说的就是这句话时不重复一遍 -->
              <span v-if="!(secretError && secretChanged)" id="st-sk-help" class="lc-help" :class="{ again: secretChanged }" data-testid="storage-secret-help">{{ secretHelp }}</span>
            </div>
          </div>
        </SettingsCard>

        <!-- 访问与分发 -->
        <SettingsCard :title="t('settings.storage.group.delivery.title')" :desc="t('settings.storage.group.delivery.desc')" data-group="delivery">
          <div class="srow">
            <div class="k"><label for="st-public">{{ t('settings.storage.field.publicBaseUrl') }}</label></div>
            <div class="v">
              <input
                id="st-public" v-model.trim="form.publicBaseUrl" class="lc-input long" :class="{ 'is-err': fieldError.publicBaseUrl }"
                :placeholder="preset.publicExample" :disabled="busy" spellcheck="false" inputmode="url"
                :aria-invalid="fieldError.publicBaseUrl ? true : undefined" aria-describedby="st-public-help"
                @input="onPublicInput"
              />
              <span v-if="fieldError.publicBaseUrl" class="lc-help err" role="alert" data-testid="storage-public-error">{{ fieldError.publicBaseUrl }}</span>
              <span id="st-public-help" class="lc-help">{{ t('settings.storage.help.publicBaseUrl') }}</span>
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
          <!-- 只影响「交给上游模型的签名地址」按哪个主机生成；本站自己读写文件始终走上面的 Endpoint -->
          <div class="srow">
            <div class="k"><label for="st-presign">{{ t('settings.storage.field.presignEndpoint') }}</label></div>
            <div class="v">
              <input
                id="st-presign" v-model.trim="form.presignEndpoint" class="lc-input long" :class="{ 'is-err': fieldError.presignEndpoint }"
                placeholder="https://s3.example.com" :disabled="busy" spellcheck="false" inputmode="url"
                :aria-invalid="fieldError.presignEndpoint ? true : undefined" aria-describedby="st-presign-help"
                data-testid="storage-presign" @input="fieldError.presignEndpoint = ''"
              />
              <span v-if="fieldError.presignEndpoint" class="lc-help err" role="alert" data-testid="storage-presign-error">{{ fieldError.presignEndpoint }}</span>
              <span id="st-presign-help" class="lc-help">{{ t('settings.storage.help.presignEndpoint') }}</span>
              <span class="lc-help host-note"><LcIcon name="warn" size="s" />{{ t('settings.storage.help.presignHost') }}</span>
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
          <button ref="saveBtn" class="lc-btn primary quiet" type="submit" :disabled="busy" data-testid="storage-save">
            {{ saving ? t('common.saving') : (status.driver === 's3' ? t('common.save') : t('settings.storage.saveAndSwitch')) }}
          </button>
        </SaveBar>
      </form>
    </template>

    <!-- 测试没过，是否仍然保存。它是保存的请求回来之后才弹的：那时「保存」按钮正灰着、焦点已经丢了，
         所以关掉后把焦点交回「保存」（fallback-focus），不让它落在页面上 -->
    <TeamDialog
      v-if="confirmForce" :title="t('settings.storage.forceTitle')" :width="440" :busy="saving" data-testid="storage-force-dialog"
      :fallback-focus="() => saveBtn"
      @close="confirmForce = false" @submit="save(true)"
    >
      <p class="lc-error-text">{{ testResult?.message }}</p>
      <p>{{ t('settings.storage.forceText') }}</p>
      <template #foot>
        <button class="lc-btn" type="button" :disabled="saving" data-autofocus @click="confirmForce = false">{{ t('common.cancel') }}</button>
        <button class="lc-btn danger" type="submit" :disabled="saving" data-testid="storage-force">{{ t('settings.storage.forceSave') }}</button>
      </template>
    </TeamDialog>

    <!-- 切回本地磁盘。切回去之后「切回本地磁盘」那颗按钮就没了：焦点交给上面选中的那一项（fallback-focus） -->
    <TeamDialog
      v-if="confirmLocal" :title="t('settings.storage.backToLocal')" :width="440" :busy="saving" data-testid="storage-back-local-dialog"
      :fallback-focus="pickedOption"
      @close="confirmLocal = false" @submit="switchToLocal"
    >
      <p>{{ t('settings.storage.backToLocalText') }}</p>
      <template #foot>
        <button class="lc-btn" type="button" :disabled="saving" @click="confirmLocal = false">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary quiet" type="submit" :disabled="saving" data-autofocus data-testid="storage-back-local-ok">{{ t('settings.storage.backToLocal') }}</button>
      </template>
    </TeamDialog>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * 存储（仅超级管理员）：上传和结果存在哪里。
 *
 * 最上面一张是现在的情况（StorageHealth）：新文件存到哪、存不存得下来、文件怎样交给上游模型，
 * 以及读取文件时会去找的每一个存储和它的状态。它是服务端此刻说的，和下面表单里改没改无关；
 * 有存储连不上的时候每隔几秒自己重取一次，也可以手动刷新 —— 刷新只换这张卡片，不动填了一半的表单。
 *
 * 接着两张选项卡片是「打算用哪种」，下面只出现选中那一种的内容：
 *  - 本地磁盘：现在是不是在用它、文件在哪、切换存储时已有文件怎么办；正在用对象存储时多一个「切回本地磁盘」。
 *  - S3 兼容对象存储：配置表单，按「服务商与地址 / 存储桶 / 凭证 / 访问与分发」分成四张卡片，底下一条是测试和保存。
 * 真正切换发生在保存（先测后存）或确认切回本地的时候，只点选项卡片不会改任何东西。
 * 密钥只写不读：后端只告诉我们「已设置」和末四位，留空提交表示沿用已保存的那一把 ——
 * 但已保存的那一把只用于保存时的 Endpoint 和 Access Key ID（后端 storageSettings.knownSecret）：
 * 这两项改了任何一项，密钥就成了必填，表单直接要，不等后端回 400 storage.secret_required。
 * 「预设」只是帮忙填默认值和给出提示的标签，真正起作用的是下面一项项明确的设置。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { adminApi, unwrap, apiErrorCode, apiErrorData, apiErrorMessage } from '@/utils/api'
import { useAppStore } from '@/stores/app'
import { setWritable } from '@/utils/storageHealth'
import LcSelect from '@/components/LcSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsCard from './SettingsCard.vue'
import SaveBar from './SaveBar.vue'
import StorageHealth from './StorageHealth.vue'
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
    forcePathStyle: false, keyPrefix: '', publicBaseUrl: '', presignEndpoint: '', delivery: 'proxy', acl: '',
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
/** 和后端 credentialHome 的比法一致：Endpoint 不分大小写、不带结尾的斜杠 */
function endpointKey(v: string): string {
  const s = String(v || '').trim()
  if (!s) return ''
  try { return new URL(s).origin.toLowerCase() } catch { return s.replace(/\/+$/, '').toLowerCase() }
}
/** 后端已经说过「这把存着的密钥用不上」：到下次读到服务端状态之前都当它不能沿用 */
const refused = ref(false)
/** 已保存的密钥还能不能沿用：只在 Endpoint 和 Access Key ID 都没动的时候 */
const secretReusable = computed(() => {
  const saved = status.value?.s3
  if (!hasSecret.value || !saved || refused.value) return false
  return endpointKey(form.endpoint) === endpointKey(saved.endpoint) && form.accessKeyId === saved.accessKeyId
})
/** 有一把存着的密钥，但它不属于现在填的这个地址 / 这个 Access Key ID */
const secretChanged = computed(() => hasSecret.value && !secretReusable.value)
const secretHelp = computed(() => {
  // 存着一把，但服务端解不开了（SECRET_KEY 变了）：只能重新填
  if (status.value?.secretUnreadable && status.value.s3?.hasSecret) return t('settings.storage.help.secretLost')
  if (secretChanged.value) return t('settings.storage.help.secretAgain')
  return hasSecret.value ? t('settings.storage.help.secretKeep') : t('settings.storage.help.secret')
})
const secretError = ref('')
const secretEl = ref<HTMLInputElement | null>(null)
const saveBtn = ref<HTMLButtonElement | null>(null)
const whereEl = ref<HTMLElement | null>(null)
/** 「保存位置」里选中的那一项 */
const pickedOption = () => whereEl.value?.querySelector<HTMLElement>('[aria-checked="true"]')
// 地址 / Access Key ID 又改了：之前报的那句不一定还成立
watch(secretReusable, (v) => { if (v) secretError.value = '' })
function flagSecret(message: string) {
  secretError.value = message
  void nextTick(() => secretEl.value?.focus())
}
const secretPlaceholder = computed(() => {
  if (!secretReusable.value) return ''
  const tail = status.value?.s3?.secretTail
  return tail ? t('settings.storage.secretSetTail', { tail }) : t('settings.storage.secretSet')
})
/* ---------- 三个地址栏的格式 ---------- */
// 和后端 storage/schema.js 的 httpUrl 是同一套规则。后端对「带了路径」「以桶名开头」只回一个错误码，
// 不说是哪一栏（Endpoint 和签名地址用的 Endpoint 共用），所以这里自己先查，报在出错的那一栏上。
type UrlField = 'endpoint' | 'publicBaseUrl' | 'presignEndpoint'
const URL_FIELDS: { key: UrlField; id: string; allowPath: boolean }[] = [
  { key: 'endpoint', id: 'st-endpoint', allowPath: false },
  { key: 'publicBaseUrl', id: 'st-public', allowPath: true },
  { key: 'presignEndpoint', id: 'st-presign', allowPath: false },
]
const fieldError = reactive<Record<UrlField, string>>({ endpoint: '', publicBaseUrl: '', presignEndpoint: '' })
function clearFieldErrors() {
  for (const f of URL_FIELDS) fieldError[f.key] = ''
}
function urlProblem(value: string, allowPath: boolean): '' | 'url' | 'path' | 'bucket' {
  if (!value) return ''
  let u: URL
  try { u = new URL(value) } catch { return 'url' }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash) return 'url'
  if (allowPath) return ''
  if (u.pathname !== '/') return 'path'
  return form.bucket && u.hostname.startsWith(form.bucket + '.') ? 'bucket' : ''
}
/** 查三个地址栏，把问题标在各自那一栏上，焦点送到第一处。有问题返回 true */
function flagUrls(): boolean {
  let first = ''
  for (const f of URL_FIELDS) {
    const kind = urlProblem(form[f.key], f.allowPath)
    fieldError[f.key] = kind ? t('settings.storage.invalid.' + kind) : ''
    if (kind && !first) first = f.id
  }
  if (first) void focusField(first)
  return !!first
}
// 桶名改了：「以桶名开头」那句不一定还成立，下次提交时再查
watch(() => form.bucket, () => { fieldError.endpoint = ''; fieldError.presignEndpoint = '' })

/** 把人送到表单里的某一栏：先切到对象存储那一面（这一栏只在那里有），再把它滚到眼前并聚焦 */
async function focusField(id: string) {
  choice.value = 's3'
  await nextTick()
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.focus({ preventScroll: true })
}

/* ---------- 现在的情况：刷新与轮询 ---------- */
const POLL_SECONDS = 10
const refreshing = ref(false)
const checkedAt = ref(0)
/** 有存储连不上：隔几秒重取一次状态，它恢复了（或者被从列表里去掉了）页面自己跟上 */
const polling = computed(() => !!status.value?.buckets?.some((b) => b.state === 'unreachable'))
let pollTimer: ReturnType<typeof setInterval> | null = null
function stopPoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
watch(polling, (on) => {
  stopPoll()
  // 页面在后台、正在保存 / 测试、弹着确认框的时候不取
  if (on) pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !busy.value && !confirmForce.value && !confirmLocal.value) void refresh(true)
  }, POLL_SECONDS * 1000)
})
onBeforeUnmount(stopPoll)

/**
 * 换上服务端此刻的状态，不丢表单里填了一半的东西：表单没动过就整个按新状态来
 * （去掉的正好是表单里那个存储桶时，表单随之清空），动过就只换状态。选中的那一面不变。
 */
function applyHealth(s: StorageStatus) {
  if (dirty.value) {
    status.value = s
    noteWritable(s)
    checkedAt.value = Date.now()
    return
  }
  const picked = choice.value
  applyStatus(s)
  choice.value = picked
}

/** 存不存得了新文件：画布上运行前的提示用的是同一份（见 utils/storageHealth） */
function noteWritable(s: StorageStatus) {
  if (typeof s.writable === 'boolean') setWritable(s.writable)
}

async function refresh(quiet = false) {
  if (refreshing.value) return
  refreshing.value = true
  try {
    // 带上 probe：服务端先把每个存储桶问一遍（最多等几秒），拿回来的是此刻的状态
    applyHealth(unwrap(await adminApi.storage(true)))
  } catch (err) {
    // 自动刷新取不到就等下一次，不打扰
    if (quiet !== true) MessagePlugin.error(apiErrorMessage(err, t('common.loadFailed')))
  } finally {
    refreshing.value = false
  }
}

function applyStatus(s: StorageStatus) {
  status.value = s
  noteWritable(s)
  choice.value = s.driver
  const next = emptyForm()
  if (s.s3) {
    const { hasSecret: _h, secretTail: _t, endpointHost: _e, ...saved } = s.s3
    Object.assign(next, saved)
  }
  Object.assign(form, next)
  stored.value = JSON.stringify(form)
  secretError.value = ''
  refused.value = false
  clearFieldErrors()
  checkedAt.value = Date.now()
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    // 先按服务端已经知道的画出来（立刻返回），再悄悄问一遍各个存储桶此刻连不连得上
    applyStatus(unwrap(await adminApi.storage()))
    void refresh(true)
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
  fieldError.publicBaseUrl = ''
  if (!form.publicBaseUrl) form.delivery = 'proxy'
}

function validate(): string {
  const need = (key: keyof StorageS3Form) => t('settings.storage.required', { field: t('settings.storage.field.' + key) })
  if (preset.value.endpointRequired && !form.endpoint) return need('endpoint')
  if (!form.bucket) return need('bucket')
  if (!form.region && regionRequired.value) return need('region')
  if (!form.accessKeyId) return need('accessKeyId')
  return ''
}

/** 表单能不能交：别的必填项报在底下那一条里，密钥报在它自己那一格上 */
function ready(): boolean {
  error.value = validate()
  secretError.value = ''
  clearFieldErrors()
  if (error.value) return false
  if (flagUrls()) return false
  if (!form.secretAccessKey && !secretReusable.value) {
    flagSecret(secretChanged.value
      ? t('settings.storage.help.secretAgain')
      : t('settings.storage.required', { field: t('settings.storage.field.secretAccessKey') }))
    return false
  }
  return true
}

/** 后端说密钥得重填（它认得的「已保存的那一把」比我们多一个环境变量来源）：标在密钥那一格上 */
function secretRefused(err: unknown): boolean {
  if (apiErrorCode(err) !== 'storage.secret_required') return false
  refused.value = true
  flagSecret(apiErrorMessage(err, t('settings.storage.help.secretAgain')))
  return true
}

/** 表单里每一栏对应的输入框（后端在 data.field 里说的是这些名字） */
const FIELD_INPUT: Record<string, string> = {
  endpoint: 'st-endpoint', region: 'st-region', bucket: 'st-bucket', keyPrefix: 'st-prefix',
  accessKeyId: 'st-ak', secretAccessKey: 'st-sk', publicBaseUrl: 'st-public', presignEndpoint: 'st-presign',
}
/**
 * 后端拒绝了这份表单，而且说了是哪一栏（data.field；那句话里用的是页面上的叫法，不是接口里的名字）：
 * 标在那一栏上，焦点送过去。提交前这里已经按同样的规则查过三个地址栏，正常走不到这一步。
 * 不属于某一栏的错误返回 false，由调用处写在底下那一条里。
 */
function fieldRefused(err: unknown): boolean {
  if (secretRefused(err)) return true
  const field = String(apiErrorData(err).field || '')
  const input = FIELD_INPUT[field]
  if (!input) return false
  const said = apiErrorMessage(err, t('common.operationFailed'))
  if (field === 'secretAccessKey') flagSecret(said)
  else if (field in fieldError) fieldError[field as UrlField] = said
  else error.value = said
  if (field !== 'secretAccessKey') void focusField(input)
  return true
}

async function runTest() {
  testResult.value = null
  if (!ready()) return
  testing.value = true
  try {
    testResult.value = unwrap(await adminApi.testStorage({ ...form }))
  } catch (err) {
    if (!fieldRefused(err)) error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    testing.value = false
  }
}

/** 保存并立即生效。后端会先测一遍；没过就不保存，除非 force。 */
async function save(force: boolean) {
  if (!s3On.value) return
  if (!ready()) { confirmForce.value = false; return }
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
      if (!fieldRefused(err)) error.value = apiErrorMessage(err, t('common.operationFailed'))
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

.gap { margin-top: 10px; }
.back { margin-top: 12px; }

.srow > .v > .lc-input.long { max-width: 560px; }
.hints {
  margin: 12px 0 0; padding: 12px 14px 12px 30px; border-radius: 10px; max-width: 600px;
  background: rgb(var(--c-cyan) / .06); border: 1px solid var(--line);
  font-size: 12px; color: var(--text-2); line-height: 1.75;
}
.hints li { word-break: break-word; }
.hints li + li { margin-top: 2px; }
.srow > .v > .lc-switch { display: block; }
.lc-help.again { color: var(--warn); }
/* 签名地址用的 Endpoint 底下那句「代理必须保留 Host」：不照做就全部失败，所以单独一行、带个提醒标 */
.srow > .v > .lc-help.host-note { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; color: var(--text-2); }
.host-note :deep(.lc-ic) { color: var(--warn); flex: none; margin-top: 2px; }

.test { padding: 14px 16px; border-radius: var(--r-md); border: 1px solid var(--line-2); }
.test.ok { border-color: rgb(var(--c-ok) / .45); background: var(--success-dim); }
.test.err { border-color: rgb(var(--c-err) / .45); background: var(--danger-dim); }
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
