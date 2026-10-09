<template>
  <div class="lc-mask" @click.self="emit('close')">
    <div class="lc-dialog">
      <div class="lc-dialog-head">
        <span>{{ t('settings.pricing.title', { model: model.label || model.id }) }}</span>
        <button class="lc-x" :aria-label="t('common.close')" @click="emit('close')">×</button>
      </div>

      <div class="lc-dialog-body">
        <p class="hint">{{ t('settings.pricing.hint') }}</p>

        <div class="grid">
          <div class="lc-field">
            <label>{{ t('settings.pricing.currency') }}</label>
            <input v-model.trim="currency" class="lc-input" maxlength="3" placeholder="CNY" :disabled="saving" />
          </div>
          <div class="lc-field">
            <label for="pr-unit">{{ t('settings.pricing.unit') }}</label>
            <LcSelect id="pr-unit" v-model="unit" :options="unitOptions" :disabled="saving" />
          </div>
          <div class="lc-field">
            <label for="pr-by">{{ t('settings.pricing.by') }}</label>
            <LcSelect id="pr-by" v-model="by" :options="byOptions" :disabled="saving" @change="onByChange" />
          </div>
        </div>

        <div v-if="!by" class="lc-field">
          <label>{{ t('settings.pricing.price') }}</label>
          <input v-model="price" class="lc-input" type="number" min="0" step="any" :disabled="saving" />
        </div>

        <template v-else>
          <div class="lc-label rows-title">{{ t('settings.pricing.table') }}</div>
          <div v-for="(row, i) in rows" :key="i" class="row">
            <input v-model.trim="row.key" class="lc-input" :placeholder="keyPlaceholder" :disabled="saving" />
            <input v-model="row.price" class="lc-input" type="number" min="0" step="any" :placeholder="t('settings.pricing.price')" :disabled="saving" />
            <button class="lc-btn sm ghost" :disabled="saving" :aria-label="t('common.remove')" @click="rows.splice(i, 1)">×</button>
          </div>
          <button class="lc-btn sm" :disabled="saving" @click="rows.push({ key: '', price: '' })">{{ t('settings.pricing.addRow') }}</button>
        </template>

        <p v-if="error" class="lc-error-text err">{{ error }}</p>
      </div>

      <div class="lc-dialog-foot">
        <button class="lc-btn ghost clear" :disabled="saving || !model.pricing" @click="emit('save', null)">
          {{ t('settings.pricing.clear') }}
        </button>
        <button class="lc-btn" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary" :disabled="saving" @click="submit">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 单个模型的价格覆盖项编辑器。
 * 价格只用于在画布上显示预估成本、统计用量，不影响实际向上游的计费。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcSelect from '@/components/LcSelect.vue'
import type { AdminModel, ModelPricing } from '@/types'

const props = defineProps<{ model: AdminModel; saving?: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  /** null = 清除价格（画布上显示「成本未知」） */
  (e: 'save', pricing: ModelPricing | null): void
}>()

const { t } = useI18n()

const UNITS: ModelPricing['unit'][] = ['per_image', 'per_video', 'per_second', 'per_1m_tokens']
const unitOptions = computed(() => UNITS.map(u => ({ value: u, label: t('settings.pricing.units.' + u) })))
const byOptions = computed<{ value: NonNullable<ModelPricing['by']>; label: string }[]>(() => [
  { value: '', label: t('settings.pricing.byNone') },
  { value: 'resolution', label: t('settings.pricing.byResolution') },
  { value: 'duration', label: t('settings.pricing.byDuration') },
  { value: 'resolution_duration', label: t('settings.pricing.byResolutionDuration') },
])

function defaultUnit(): ModelPricing['unit'] {
  if (props.model.kind === 'video') return 'per_video'
  if (props.model.kind === 'chat') return 'per_1m_tokens'
  return 'per_image'
}

const init = props.model.pricing
const currency = ref(init?.currency || 'CNY')
const unit = ref<ModelPricing['unit']>(init?.unit || defaultUnit())
const by = ref<NonNullable<ModelPricing['by']>>(init?.by || '')
const price = ref<number | string>(init?.price ?? '')
const rows = ref<{ key: string; price: number | string }[]>(
  Object.entries(init?.table || {}).map(([key, v]) => ({ key, price: v })),
)
const error = ref('')

const keyPlaceholder = computed(() => {
  if (by.value === 'resolution') return '1K'
  if (by.value === 'duration') return '5'
  return '720p:5'
})

/** 换计价维度时，按模型声明的可选项预填一组键，省得手敲 */
function suggestedKeys(): string[] {
  const o = props.model.options || {}
  const res = o.resolutions || []
  const dur = (o.durations || []).map(String)
  if (by.value === 'resolution') return res
  if (by.value === 'duration') return dur
  if (by.value === 'resolution_duration') return res.flatMap(r => dur.map(d => `${r}:${d}`))
  return []
}

function onByChange() {
  if (!by.value) return
  const old = new Map(rows.value.map(r => [r.key, r.price]))
  const keys = suggestedKeys()
  rows.value = keys.length
    ? keys.map(key => ({ key, price: old.get(key) ?? '' }))
    : [{ key: '', price: '' }]
}

function submit() {
  error.value = ''
  const cur = currency.value.toUpperCase()
  if (!/^[A-Z]{3}$/.test(cur)) {
    error.value = t('settings.pricing.errCurrency')
    return
  }
  if (!by.value) {
    const p = Number(price.value)
    if (price.value === '' || !Number.isFinite(p) || p < 0) {
      error.value = t('settings.pricing.errPrice')
      return
    }
    emit('save', { currency: cur, unit: unit.value, price: p })
    return
  }
  const table: Record<string, number> = {}
  for (const r of rows.value) {
    if (!r.key && r.price === '') continue
    const p = Number(r.price)
    if (!r.key || r.price === '' || !Number.isFinite(p) || p < 0) {
      error.value = t('settings.pricing.errRow')
      return
    }
    table[r.key] = p
  }
  if (!Object.keys(table).length) {
    error.value = t('settings.pricing.errEmpty')
    return
  }
  emit('save', { currency: cur, unit: unit.value, by: by.value, table })
}
</script>

<style scoped>
.hint { font-size: 12.5px; color: var(--t-dim); line-height: 1.6; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: 90px 1fr 1fr; gap: 0 12px; }
.rows-title { margin-bottom: 8px; }
.row { display: grid; grid-template-columns: 1fr 1fr 32px; gap: 8px; margin-bottom: 8px; align-items: center; }
.err { margin-top: 12px; }
.clear { margin-right: auto; }

@media (max-width: 520px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
