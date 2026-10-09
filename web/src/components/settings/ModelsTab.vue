<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.models.title') }}</h2>
        <p class="tab-desc">{{ t('settings.models.desc') }}</p>
      </div>
      <div class="head-tools">
        <LcSelect v-model="kindFilter" class="kind-filter" size="sm" :options="kindOptions" :aria-label="t('settings.models.kind')" />
        <input v-model="keyword" class="lc-input sm search" :placeholder="t('common.search')" />
      </div>
    </div>

    <div v-if="loading" class="lc-empty">{{ t('common.loading') }}</div>
    <div v-else-if="loadError" class="lc-empty">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="!models.length" class="lc-card lc-empty">{{ t('settings.models.empty') }}</div>

    <div v-else class="lc-card lc-table-wrap">
      <table class="lc-table">
        <thead>
          <tr>
            <th>{{ t('settings.models.enabled') }}</th>
            <th>{{ t('settings.models.label') }}</th>
            <th>{{ t('settings.models.kind') }}</th>
            <th>{{ t('settings.models.sort') }}</th>
            <th>{{ t('settings.models.pricing') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in filtered" :key="m.id">
            <td>
              <button
                class="lc-switch"
                :class="{ on: m.enabled }"
                :disabled="busy === m.id"
                role="switch"
                :aria-checked="m.enabled"
                :aria-label="t('settings.models.enabled')"
                @click="patch(m, { enabled: !m.enabled })"
              />
            </td>
            <td class="cell-label">
              <input
                class="lc-input sm"
                :value="m.label"
                :disabled="busy === m.id"
                @change="onLabel(m, $event)"
              />
              <div class="model-id">{{ m.id }}</div>
            </td>
            <td><span class="lc-tag">{{ t('settings.models.kinds.' + m.kind) }}</span></td>
            <td>
              <input
                class="lc-input sm sort-input"
                type="number"
                :value="m.sort ?? 0"
                :disabled="busy === m.id"
                @change="onSort(m, $event)"
              />
            </td>
            <td class="cell-price">{{ pricingSummary(m.pricing) }}</td>
            <td class="cell-ops">
              <button class="lc-btn sm" :disabled="busy === m.id" @click="editing = m">{{ t('settings.models.editPricing') }}</button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="6" class="lc-empty">{{ t('common.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <PricingEditor
      v-if="editing"
      :model="editing"
      :saving="busy === editing.id"
      @close="editing = null"
      @save="savePricing"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { loadModels } from '@/utils/canvasModels'
import { formatMoney } from '@/utils/cost'
import LcSelect from '@/components/LcSelect.vue'
import PricingEditor from './PricingEditor.vue'
import type { AdminModel, ModelKind, ModelPricing } from '@/types'

const { t } = useI18n()

const KINDS: ModelKind[] = ['image', 'video', 'chat']
const kindOptions = computed<{ value: ModelKind | ''; label: string }[]>(() => [
  { value: '', label: t('common.all') },
  ...KINDS.map(k => ({ value: k, label: t('settings.models.kinds.' + k) })),
])

const models = ref<AdminModel[]>([])
const loading = ref(true)
const loadError = ref('')
const kindFilter = ref<ModelKind | ''>('')
const keyword = ref('')
const busy = ref('')
const editing = ref<AdminModel | null>(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    models.value = unwrap(await adminApi.models()) || []
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return models.value
    .filter(m => !kindFilter.value || m.kind === kindFilter.value)
    .filter(m => !kw || m.id.toLowerCase().includes(kw) || (m.label || '').toLowerCase().includes(kw))
    .slice()
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
})

function pricingSummary(p?: ModelPricing | null): string {
  if (!p) return t('settings.models.noPricing')
  const unit = t('settings.pricing.units.' + p.unit)
  if (!p.by) return `${formatMoney(Number(p.price) || 0, p.currency)} / ${unit}`
  const values = Object.values(p.table || {}).map(Number).filter(v => Number.isFinite(v))
  if (!values.length) return t('settings.models.noPricing')
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = min === max
    ? formatMoney(min, p.currency)
    : `${formatMoney(min, p.currency)} – ${formatMoney(max, p.currency)}`
  return `${range} / ${unit}`
}

/** 改一项就存一项。成功后用后端返回的那一行替换本地的，并刷新画布用的模型清单 */
async function patch(m: AdminModel, data: Parameters<typeof adminApi.updateModel>[1]): Promise<boolean> {
  busy.value = m.id
  try {
    const updated = unwrap(await adminApi.updateModel(m.id, data))
    const i = models.value.findIndex(x => x.id === m.id)
    if (i >= 0) models.value[i] = { ...models.value[i], ...data, ...(updated || {}) }
    loadModels().catch(() => undefined)
    return true
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
    return false
  } finally {
    busy.value = ''
  }
}

function onLabel(m: AdminModel, e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value.trim()
  if (!v) { el.value = m.label; return }
  if (v !== m.label) patch(m, { label: v })
}

function onSort(m: AdminModel, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v) && v !== (m.sort ?? 0)) patch(m, { sort: v })
}

async function savePricing(pricing: ModelPricing | null) {
  const m = editing.value
  if (!m) return
  if (await patch(m, { pricing })) {
    editing.value = null
    MessagePlugin.success(t('common.saved'))
  }
}
</script>

<style scoped>
@import './tab-shared.css';

.head-tools { display: flex; gap: 8px; flex: none; }
.kind-filter { width: 110px; }
.search { width: 180px; }
.cell-label { min-width: 220px; }
.model-id { margin-top: 4px; font-size: 11.5px; color: var(--t-dim); word-break: break-all; }
.sort-input { width: 76px; }
.cell-price { white-space: nowrap; color: var(--t-strong); }
.cell-ops { text-align: right; white-space: nowrap; }
.retry { margin-top: 12px; }
</style>
