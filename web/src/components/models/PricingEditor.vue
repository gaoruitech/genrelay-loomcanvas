<template>
  <div class="lc-mask" @click.self="emit('close')">
    <div class="lc-dialog pe" role="dialog" aria-modal="true">
      <div class="lc-dialog-head">
        <span>{{ t('modelsPage.pricing.title', { model: model.label || model.id }) }}</span>
        <button class="lc-x" :aria-label="t('common.close')" @click="emit('close')">×</button>
      </div>

      <div class="lc-dialog-body">
        <p class="hint">{{ t('modelsPage.pricing.hint') }}</p>

        <div class="grid">
          <div class="lc-field">
            <label for="pr-currency">{{ t('modelsPage.pricing.currency') }}</label>
            <input id="pr-currency" v-model.trim="currency" class="lc-input mono" maxlength="3" placeholder="CNY" :disabled="saving" />
          </div>
          <div class="lc-field">
            <label for="pr-unit">{{ t('modelsPage.pricing.unit') }}</label>
            <LcSelect id="pr-unit" v-model="unit" :options="unitOptions" :disabled="saving" />
          </div>
          <div v-if="isToken" class="lc-field">
            <label for="pr-token-mode">{{ t('modelsPage.pricing.tokenMode') }}</label>
            <LcSelect id="pr-token-mode" v-model="tokenMode" :options="tokenModeOptions" :disabled="saving" />
          </div>
          <div v-else class="lc-field">
            <label for="pr-by">{{ t('modelsPage.pricing.by') }}</label>
            <LcSelect id="pr-by" v-model="by" :options="byOptions" :disabled="saving" @change="onByChange" />
          </div>
        </div>

        <div v-if="isToken && tokenMode === 'split'" class="token-grid">
          <div class="lc-field">
            <label for="pr-input">{{ t('modelsPage.pricing.inputPrice') }}</label>
            <input id="pr-input" v-model="inputPrice" class="lc-input" type="number" min="0" step="any" :disabled="saving" />
          </div>
          <div class="lc-field">
            <label for="pr-output">{{ t('modelsPage.pricing.outputPrice') }}</label>
            <input id="pr-output" v-model="outputPrice" class="lc-input" type="number" min="0" step="any" :disabled="saving" />
          </div>
        </div>

        <div v-else-if="isToken || !by" class="lc-field">
          <label for="pr-price">{{ t('modelsPage.pricing.price') }}</label>
          <input id="pr-price" v-model="price" class="lc-input" type="number" min="0" step="any" :disabled="saving" />
        </div>

        <template v-else>
          <div class="lc-label rows-title">{{ t('modelsPage.pricing.table') }}</div>
          <div v-for="(row, i) in rows" :key="i" class="row">
            <input v-model.trim="row.key" class="lc-input mono" :placeholder="keyPlaceholder" :aria-label="t('modelsPage.pricing.tier')" :disabled="saving" />
            <input v-model="row.price" class="lc-input" type="number" min="0" step="any" :placeholder="t('modelsPage.pricing.price')" :aria-label="t('modelsPage.pricing.price')" :disabled="saving" />
            <button class="lc-tb sm" :disabled="saving" :aria-label="t('common.remove')" :title="t('common.remove')" @click="rows.splice(i, 1)"><LcIcon name="trash" size="s" /></button>
          </div>
          <button class="lc-btn sm" :disabled="saving" @click="rows.push({ key: '', price: '' })"><LcIcon name="plus" size="s" />{{ t('modelsPage.pricing.addRow') }}</button>
        </template>

        <p v-if="error" class="lc-error-text err">{{ error }}</p>
      </div>

      <div class="lc-dialog-foot">
        <button class="lc-btn ghost clear" :disabled="saving || !model.pricing" @click="emit('save', null)">
          {{ t('modelsPage.pricing.clear') }}
        </button>
        <button class="lc-btn" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary quiet" :disabled="saving" @click="submit">
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
 *
 * 按 token 计价有两种存法，后端两种都认（runner/pricing.js 的 tokenCost）：
 *   统一单价   { unit: 'per_1m_tokens', price }
 *   输入输出分开 { unit: 'per_1m_tokens', table: { input, output } }
 * 这里两种都能显示、都能改；打开一个分开计价的价格再保存，不会被压成一个数。
 * 按 token 计价没有「随分辨率 / 时长变化」这回事，所以那个下拉换成「输入和输出」。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcSelect from '@/components/LcSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import type { AdminModel, ModelPricing } from '@/types'

const props = defineProps<{ model: AdminModel; saving?: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  /** null = 清除价格（画布上显示「成本未知」） */
  (e: 'save', pricing: ModelPricing | null): void
}>()

const { t } = useI18n()

const UNITS: ModelPricing['unit'][] = ['per_image', 'per_video', 'per_second', 'per_1m_tokens']
const unitOptions = computed(() => UNITS.map(u => ({ value: u, label: t('modelsPage.pricing.units.' + u) })))
const byOptions = computed<{ value: NonNullable<ModelPricing['by']>; label: string }[]>(() => [
  { value: '', label: t('modelsPage.pricing.byNone') },
  { value: 'resolution', label: t('modelsPage.pricing.byResolution') },
  { value: 'duration', label: t('modelsPage.pricing.byDuration') },
  { value: 'resolution_duration', label: t('modelsPage.pricing.byResolutionDuration') },
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

// ---- 按 token 计价 ----
const isToken = computed(() => unit.value === 'per_1m_tokens')
const initToken = init?.unit === 'per_1m_tokens' ? init : null
// 已有价格：照它原来的存法；新填的：分开计价（上游的对话模型大多输入输出不同价）
const tokenMode = ref<'same' | 'split'>(initToken && !initToken.table ? 'same' : 'split')
const tokenModeOptions = computed<{ value: 'same' | 'split'; label: string }[]>(() => [
  { value: 'split', label: t('modelsPage.pricing.tokenSplit') },
  { value: 'same', label: t('modelsPage.pricing.tokenSame') },
])
const inputPrice = ref<number | string>(initToken?.table?.input ?? '')
const outputPrice = ref<number | string>(initToken?.table?.output ?? '')
// input / output 是 token 价格的两个键，不是价格表的档位
const rows = ref<{ key: string; price: number | string }[]>(
  initToken ? [] : Object.entries(init?.table || {}).map(([key, v]) => ({ key, price: v })),
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
    error.value = t('modelsPage.pricing.errCurrency')
    return
  }
  const valid = (v: number | string) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0
  if (isToken.value && tokenMode.value === 'split') {
    if (!valid(inputPrice.value) || !valid(outputPrice.value)) {
      error.value = t('modelsPage.pricing.errToken')
      return
    }
    emit('save', { currency: cur, unit: unit.value, table: { input: Number(inputPrice.value), output: Number(outputPrice.value) } })
    return
  }
  if (isToken.value || !by.value) {
    const p = Number(price.value)
    if (price.value === '' || !Number.isFinite(p) || p < 0) {
      error.value = t('modelsPage.pricing.errPrice')
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
      error.value = t('modelsPage.pricing.errRow')
      return
    }
    table[r.key] = p
  }
  if (!Object.keys(table).length) {
    error.value = t('modelsPage.pricing.errEmpty')
    return
  }
  emit('save', { currency: cur, unit: unit.value, by: by.value, table })
}
</script>

<style scoped>
.pe { width: 560px; color-scheme: dark; }
.hint { font-size: 13px; color: var(--text-3); line-height: 1.6; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: 96px 1fr 1fr; gap: 0 12px; }
.token-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.mono { font-family: var(--f-mono); font-size: 13px; }
.rows-title { margin-bottom: 8px; }
.row { display: grid; grid-template-columns: 1fr 1fr 28px; gap: 8px; margin-bottom: 8px; align-items: center; }
.err { margin-top: 12px; }
.clear { margin-right: auto; }

@media (max-width: 560px) {
  .grid { grid-template-columns: 1fr 1fr; }
  .grid > :first-child { grid-column: 1 / -1; }
  .token-grid { grid-template-columns: 1fr; }
  .pe .lc-dialog-foot { flex-wrap: wrap; }
}
</style>
