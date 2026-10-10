<template>
  <div class="pf">
    <div class="lc-field">
      <label :for="uid + '-key'">
        {{ t('modelsPage.provider.apiKey') }}<span v-if="!existing?.hasKey" class="lc-required">*</span>
      </label>
      <input
        :id="uid + '-key'"
        v-model="form.apiKey"
        class="lc-input"
        type="password"
        autocomplete="new-password"
        :placeholder="keyPlaceholder"
        :disabled="disabled"
      />
      <span v-if="existing?.hasKey" class="lc-help">{{ t('modelsPage.provider.secretKeep') }}</span>
      <span v-else-if="vendor.keyUrl && !compact" class="lc-help">
        <a :href="vendor.keyUrl" target="_blank" rel="noopener noreferrer">{{ t('modelsPage.provider.getKey') }}</a>
      </span>
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
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderInstance, Vendor } from '@/types'
import { vendorLabel } from '@/utils/providerMeta'
import LcIcon from '@/components/LcIcon.vue'
import type { ProviderFormState } from './providerForm'

const props = withDefaults(defineProps<{
  vendor: Vendor
  /** 编辑已有实例时传入，用于显示 Key 占位 */
  existing?: ProviderInstance | null
  /** 精简模式（引导页）：不显示名称；「获取 API Key」的链接由引导页自己放在标题旁 */
  compact?: boolean
  disabled?: boolean
}>(), { existing: null, compact: false, disabled: false })

const form = defineModel<ProviderFormState>({ required: true })

const { t } = useI18n()
const uid = useId()

const trim = (v: string) => v.trim().replace(/\/+$/, '')
const isCustomAddress = computed(() => !!trim(form.value.baseUrl) && trim(form.value.baseUrl) !== trim(props.vendor.defaultBaseUrl))
// 已经改过地址的实例，打开时直接展开，免得人找不到那个非官方地址在哪
const advanced = ref(isCustomAddress.value)

const keyPlaceholder = computed(() => {
  if (!props.existing?.hasKey) return ''
  const tail = props.existing.keyTail
  return tail ? t('modelsPage.provider.secretSetTail', { tail }) : t('modelsPage.provider.secretSet')
})
</script>

<style scoped>
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
