<template>
  <div class="pf">
    <div v-if="showName" class="lc-field">
      <label :for="uid + '-name'">{{ t('settings.providers.name') }}</label>
      <input :id="uid + '-name'" v-model="form.name" class="lc-input" :placeholder="providerTypeLabel(type)" :disabled="disabled" />
    </div>

    <div v-for="f in type.fields" :key="f.key" class="lc-field">
      <label :for="uid + '-' + f.key">
        {{ providerFieldLabel(type, f) }}<span v-if="f.required && !secretAlreadySet(f)" class="lc-required">*</span>
      </label>
      <input
        :id="uid + '-' + f.key"
        v-model="form[f.key]"
        class="lc-input"
        :type="f.secret ? 'password' : 'text'"
        :autocomplete="f.secret ? 'new-password' : 'off'"
        :placeholder="placeholderOf(f)"
        :disabled="disabled"
      />
      <span v-if="f.secret && secretAlreadySet(f)" class="lc-help">{{ t('settings.providers.secretKeep') }}</span>
      <span v-else-if="providerFieldHelp(type, f)" class="lc-help">{{ providerFieldHelp(type, f) }}</span>
    </div>

    <div v-if="showBaseUrl" class="lc-field">
      <label :for="uid + '-baseUrl'">{{ t('settings.providers.baseUrl') }}</label>
      <input
        :id="uid + '-baseUrl'"
        v-model="form.baseUrl"
        class="lc-input"
        :placeholder="type.defaultBaseUrl || 'https://'"
        :disabled="disabled"
      />
      <span class="lc-help">{{ t('settings.providers.baseUrlHelp') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 一个接入实例的表单，字段由接入类型的 fields 声明驱动。设置页与引导页共用。
 *
 * 密钥类字段只写不读：后端从不返回明文，已保存过的只给 hasKey / keyTail，
 * 这里显示成「已设置 ····1234」的占位；留空提交表示不修改。
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderField, ProviderInstance, ProviderType } from '@/types'
import { providerTypeLabel, providerFieldLabel, providerFieldHelp } from '@/utils/providerMeta'

const props = withDefaults(defineProps<{
  type: ProviderType
  /** 编辑已有实例时传入，用于显示密钥占位 */
  existing?: ProviderInstance | null
  /** 精简模式（引导页）：只渲染类型声明的字段，不显示名称和地址 */
  compact?: boolean
  disabled?: boolean
}>(), { existing: null, compact: false, disabled: false })

const form = defineModel<Record<string, any>>({ required: true })

const { t } = useI18n()
const uid = useId()

const declaredKeys = computed(() => new Set(props.type.fields.map(f => f.key)))
const showName = computed(() => !props.compact && !declaredKeys.value.has('name'))
// 类型自己声明了 baseUrl 字段就用它的；否则非精简模式下给一个可选的地址覆盖
const showBaseUrl = computed(() => !props.compact && !declaredKeys.value.has('baseUrl'))

function secretAlreadySet(f: ProviderField): boolean {
  return !!f.secret && !!props.existing?.hasKey
}

function placeholderOf(f: ProviderField): string {
  if (secretAlreadySet(f)) {
    const tail = props.existing?.keyTail
    return tail ? t('settings.providers.secretSetTail', { tail }) : t('settings.providers.secretSet')
  }
  if (f.key === 'baseUrl' && props.type.defaultBaseUrl) return props.type.defaultBaseUrl
  return f.placeholder || ''
}
</script>
