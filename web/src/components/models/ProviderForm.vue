<template>
  <div class="pf">
    <div class="lc-field">
      <div class="key-head">
        <label :for="uid + '-key'">
          {{ t('modelsPage.provider.apiKey') }}<span v-if="!existing?.hasKey || keyRequired" class="lc-required">*</span>
        </label>
        <!-- 去服务商网站注册、申请 Key：会离开本产品，集成方关了站外链接（features.externalLinks）就不出 -->
        <a
          v-if="vendor.keyUrl && $feat.externalLinks"
          class="key-signup"
          :href="vendor.keyUrl"
          target="_blank"
          rel="noopener noreferrer"
          data-role="key-signup"
        >{{ t('modelsPage.provider.signupAt', { site: siteName(vendor.keyUrl) }) }}<LcIcon name="external" size="s" /></a>
      </div>
      <input
        :id="uid + '-key'"
        v-model="form.apiKey"
        class="lc-input"
        :class="{ 'is-err': keyRequired && !form.apiKey.trim() }"
        type="password"
        autocomplete="new-password"
        :placeholder="keyPlaceholder"
        :disabled="disabled"
        :required="keyRequired"
        :aria-required="keyRequired || !existing?.hasKey"
        :aria-invalid="keyRequired && !form.apiKey.trim()"
        :aria-describedby="uid + '-key-help'"
        data-field="api-key"
      />
      <span v-if="keyRequired" :id="uid + '-key-help'" class="lc-help key-again" :class="{ err: !form.apiKey.trim() }" role="status" data-role="key-again">
        {{ keyError || t('modelsPage.provider.keyAgain') }}
      </span>
      <!-- 存着一把、但服务端解不开了（SECRET_KEY 变了）：不能再说「留空表示不修改」 -->
      <span v-else-if="keyLost" :id="uid + '-key-help'" class="lc-help key-lost" data-role="key-lost">{{ t('modelsPage.provider.keyLost') }}</span>
      <span v-else-if="existing?.hasKey" :id="uid + '-key-help'" class="lc-help">{{ t('modelsPage.provider.secretKeep') }}</span>
    </div>

    <div v-if="!compact" class="lc-field">
      <label :for="uid + '-name'">{{ t('modelsPage.provider.name') }}</label>
      <input
        :id="uid + '-name'"
        v-model="form.name"
        class="lc-input"
        :placeholder="vendorLabel(vendor)"
        :disabled="disabled"
      />
    </div>

    <div class="adv">
      <button type="button" class="adv-toggle" :aria-expanded="advanced" @click="advanced = !advanced">
        <LcIcon name="chev" size="s" class="adv-chevron" :class="{ open: advanced }" />
        <span>{{ t('modelsPage.provider.advanced') }}</span>
        <span v-if="!advanced && isCustomAddress" class="lc-tag warn">{{ t('modelsPage.provider.customAddress') }}</span>
      </button>
      <div v-if="advanced" class="lc-field adv-body">
        <label :for="uid + '-baseUrl'">{{ t('modelsPage.provider.baseUrl') }}</label>
        <input
          :id="uid + '-baseUrl'"
          v-model="form.baseUrl"
          class="lc-input"
          :placeholder="vendor.defaultBaseUrl"
          :disabled="disabled"
        />
        <span class="lc-help">
          {{ vendor.recommended ? t('modelsPage.provider.baseUrlHelpGaorui') : t('modelsPage.provider.baseUrlHelp', { vendor: vendorLabel(vendor) }) }}
          <button v-if="isCustomAddress" type="button" class="link-btn" :disabled="disabled" @click="form.baseUrl = vendor.defaultBaseUrl">
            {{ t('modelsPage.provider.baseUrlReset') }}
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 一个服务商实例的表单：API Key，（非精简模式下）名称，以及收在「高级」里的接口地址。
 * 「模型管理」页与引导页共用。没有填模型的地方 —— 模型来自服务商的清单和「模型管理」页的自定义模型。
 *
 * Key 只写不读：后端从不返回明文，已保存过的只给 hasKey / keyTail，
 * 这里显示成「已设置 ····1234」的占位；留空提交表示不修改。
 *
 * 例外：改了接口地址（包括从自定义地址改回官方地址）。已保存的 Key 只会发往保存时的那个地址，
 * 所以这时 Key 变成必填，占位和说明也跟着换，不再说「留空表示不修改」。
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderInstance, Vendor } from '@/types'
import { vendorLabel } from '@/utils/providerMeta'
import LcIcon from '@/components/LcIcon.vue'
import { keyNeededForAddress, type ProviderFormState } from './providerForm'

const props = withDefaults(defineProps<{
  vendor: Vendor
  /** 编辑已有实例时传入，用于显示 Key 占位 */
  existing?: ProviderInstance | null
  /** 精简模式（引导页）：不显示名称 */
  compact?: boolean
  disabled?: boolean
  /** 后端说「改地址要重新填 Key」时的原话（别人刚改过这个服务商，本地看不出地址变了） */
  keyError?: string
}>(), { existing: null, compact: false, disabled: false, keyError: '' })

const form = defineModel<ProviderFormState>({ required: true })

const { t } = useI18n()
const uid = useId()

const trim = (v: string) => v.trim().replace(/\/+$/, '')
const isCustomAddress = computed(() => !!trim(form.value.baseUrl) && trim(form.value.baseUrl) !== trim(props.vendor.defaultBaseUrl))
// 已经改过地址的实例，打开时直接展开，免得人找不到那个非官方地址在哪
const advanced = ref(isCustomAddress.value)

/** 改了地址而存着 Key，或者后端这么说了：Key 必须重新填 */
const keyRequired = computed(() => !!props.keyError || keyNeededForAddress(props.vendor, form.value, props.existing))

/** 存着的 Key 读不出来了：留空保存不会让它恢复 */
const keyLost = computed(() => !!props.existing?.hasKey && props.existing.keyUnreadable === true)

/** 链接上显示的站点名：去掉协议和 www，比如 https://gaorui.cc → gaorui.cc */
function siteName(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return url }
}

const keyPlaceholder = computed(() => {
  if (!props.existing?.hasKey) return ''
  if (keyRequired.value) return t('modelsPage.provider.keyAgainPlaceholder')
  if (keyLost.value) return t('modelsPage.provider.keyLostPlaceholder')
  const tail = props.existing.keyTail
  return tail ? t('modelsPage.provider.secretSetTail', { tail }) : t('modelsPage.provider.secretSet')
})
</script>

<style scoped>
/* 「API Key」标题和右侧的「去服务商网站注册」同一行；窄了就让链接换到下一行 */
.key-head { display: flex; align-items: baseline; justify-content: space-between; gap: 4px 12px; flex-wrap: wrap; }
.key-head > label { font-size: 13px; color: var(--text-2); }
.key-signup { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--cyan-soft); }
.key-signup:hover { color: var(--cyan); }
.key-again { display: block; }
.key-lost { color: var(--warn); }
.adv { margin-bottom: 16px; }
.adv-toggle {
  display: inline-flex; align-items: center; gap: 6px; padding: 2px 0;
  border: 0; background: none; color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; border-radius: 6px;
}
.adv-toggle:hover { color: var(--text); }
.adv-chevron { color: var(--text-3); transition: transform .15s ease; }
.adv-chevron.open { transform: rotate(90deg); }
.adv-body { margin: 10px 0 0; }
.link-btn { border: 0; background: none; color: var(--cyan-soft); font: inherit; cursor: pointer; padding: 0; margin-left: 6px; }
.link-btn:hover:not(:disabled) { text-decoration: underline; }
</style>
