<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.models.title') }}</h2>
        <p class="tab-desc">{{ t('settings.models.desc') }}</p>
        <p v-if="anyVerified" class="tab-desc verified-note">{{ t('settings.providers.verifiedHint') }}</p>
      </div>
      <div class="head-tools">
        <LcSelect v-model="kindFilter" class="kind-filter" size="sm" :options="kindOptions" :aria-label="t('settings.models.kind')" />
        <input v-model="keyword" class="lc-input sm search" :placeholder="t('common.search')" :aria-label="t('common.search')" />
      </div>
    </div>

    <div v-if="loading" class="lc-empty">{{ t('common.loading') }}</div>
    <div v-else-if="loadError" class="lc-empty">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="!providers.length" class="lc-card lc-empty">{{ t('settings.models.empty') }}</div>

    <template v-else>
      <div v-for="g in groups" :key="g.provider.id" class="lc-card group" :data-provider="g.provider.slug">
        <div class="group-head">
          <div class="group-title">
            <span class="group-vendor">{{ g.vendor ? vendorLabel(g.vendor) : g.provider.type }}</span>
            <span v-if="g.vendor ? !isVendorDefaultName(g.vendor, g.provider.name) : !!g.provider.name" class="group-name">{{ g.provider.name }}</span>
            <span class="group-count">{{ t('settings.providers.modelCount', { n: g.total }) }}</span>
            <span v-if="!g.provider.enabled" class="lc-tag">{{ t('settings.models.providerDisabled') }}</span>
          </div>
          <button v-if="g.vendor?.customKinds.length" class="lc-btn sm" @click="customDialog = { provider: g.provider, vendor: g.vendor, existing: null }">
            {{ t('settings.models.addCustom') }}
          </button>
        </div>

        <div class="rows" role="table">
          <div class="row row-head" role="row">
            <span role="columnheader">{{ t('settings.models.enabled') }}</span>
            <span role="columnheader">{{ t('settings.models.label') }}</span>
            <span role="columnheader">{{ t('settings.models.kind') }}</span>
            <span role="columnheader">{{ t('settings.models.sort') }}</span>
            <span role="columnheader">{{ t('settings.models.pricing') }}</span>
            <span role="columnheader"></span>
          </div>
          <div v-for="m in g.models" :key="m.id" class="row" role="row" :data-model="m.id">
            <div class="c-switch" role="cell">
              <button
                class="lc-switch"
                :class="{ on: m.enabled }"
                :disabled="busy === m.id"
                role="switch"
                :aria-checked="m.enabled"
                :aria-label="t('settings.models.enabled')"
                @click="patch(m, { enabled: !m.enabled })"
              />
            </div>
            <div class="c-label" role="cell">
              <input
                class="lc-input sm"
                :value="m.label"
                :disabled="busy === m.id"
                :aria-label="t('settings.models.label')"
                @change="onLabel(m, $event)"
              />
              <div class="model-id">{{ upstreamName(m) }}</div>
            </div>
            <div class="c-kind" role="cell">
              <span class="kind-badge" :class="m.kind">{{ t('settings.models.kinds.' + m.kind) }}</span>
              <span v-if="m.custom" class="lc-tag custom-tag">{{ t('settings.models.custom') }}</span>
              <span v-if="m.verified" class="verified-tag" :title="t('settings.providers.verifiedOn', { date: m.verified })">{{ t('settings.providers.verified') }}</span>
            </div>
            <div class="c-sort" role="cell">
              <span class="cell-cap">{{ t('settings.models.sort') }}</span>
              <input
                class="lc-input sm sort-input"
                type="number"
                :value="m.sort ?? 0"
                :disabled="busy === m.id"
                :aria-label="t('settings.models.sort')"
                @change="onSort(m, $event)"
              />
            </div>
            <!-- 「输入 … / 输出 … · 每百万 token」放不下一行时，在「·」处换行，不把一截价格或单位拆开 -->
            <div class="c-price" role="cell">
              <template v-for="(part, i) in pricingSummary(m.pricing).split(' · ')" :key="i"><template v-if="i"> · </template><span class="price-part">{{ part }}</span></template>
            </div>
            <div class="c-ops" role="cell">
              <button class="lc-btn sm" :disabled="busy === m.id" @click="editing = m">{{ t('settings.models.editPricing') }}</button>
              <template v-if="m.custom && g.vendor">
                <button class="lc-btn sm" :disabled="busy === m.id" @click="openEditCustom(g, m)">{{ t('common.edit') }}</button>
                <button class="lc-btn sm danger" :disabled="busy === m.id" @click="removing = { provider: g.provider, model: m }">{{ t('common.delete') }}</button>
              </template>
            </div>
          </div>
          <div v-if="!g.models.length" class="lc-empty group-empty">{{ t('common.empty') }}</div>
        </div>
      </div>
      <div v-if="!groups.length" class="lc-card lc-empty">{{ t('common.empty') }}</div>
    </template>

    <PricingEditor
      v-if="editing"
      :model="editing"
      :saving="busy === editing.id"
      @close="editing = null"
      @save="savePricing"
    />

    <CustomModelDialog
      v-if="customDialog"
      :provider="customDialog.provider"
      :vendor="customDialog.vendor"
      :existing="customDialog.existing"
      @close="customDialog = null"
      @saved="onCustomSaved"
    />

    <!-- 删除自定义模型 -->
    <div v-if="removing" class="lc-mask" @click.self="removing = null">
      <div class="lc-dialog confirm">
        <div class="lc-dialog-head"><span>{{ t('settings.models.customDeleteTitle') }}</span></div>
        <div class="lc-dialog-body">
          <p>{{ t('settings.models.customDeleteText', { name: removing.model.label || upstreamName(removing.model) }) }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="deleting" @click="removing = null">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" :disabled="deleting" @click="confirmRemove">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 「模型」页：按服务商实例分组列出全部模型。
 * 每个模型的类型是明确的（来自服务商的模型清单，或自定义模型上用户选的），这里只是显示它。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { loadModels } from '@/utils/canvasModels'
import { formatMoney } from '@/utils/cost'
import { vendorLabel, isVendorDefaultName } from '@/utils/providerMeta'
import LcSelect from '@/components/LcSelect.vue'
import PricingEditor from './PricingEditor.vue'
import CustomModelDialog from './CustomModelDialog.vue'
import type { AdminModel, CustomModel, ModelKind, ModelPricing, ProviderInstance, Vendor } from '@/types'

const { t } = useI18n()

const KINDS: ModelKind[] = ['image', 'video', 'chat']
const kindOptions = computed<{ value: ModelKind | ''; label: string }[]>(() => [
  { value: '', label: t('common.all') },
  ...KINDS.map(k => ({ value: k, label: t('settings.models.kinds.' + k) })),
])

const models = ref<AdminModel[]>([])
const providers = ref<ProviderInstance[]>([])
const vendors = ref<Vendor[]>([])
const loading = ref(true)
const loadError = ref('')
const kindFilter = ref<ModelKind | ''>('')
const keyword = ref('')
const busy = ref('')
const editing = ref<AdminModel | null>(null)

async function fetchAll() {
  const [ms, ps, vs] = await Promise.all([adminApi.models(), adminApi.providers(), adminApi.vendors()])
  models.value = unwrap(ms) || []
  providers.value = unwrap(ps) || []
  vendors.value = unwrap(vs) || []
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    await fetchAll()
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 模型标识去掉「服务商实例:」前缀，剩下的就是发给上游的模型名 */
function upstreamName(m: AdminModel): string {
  return m.id.slice(m.id.indexOf(':') + 1)
}

interface Group {
  provider: ProviderInstance
  vendor: Vendor | null
  /** 这个服务商的模型总数（不受筛选影响） */
  total: number
  models: AdminModel[]
}

/** 清单里有带实测日期的模型时，才解释这个标记 */
const anyVerified = computed(() => models.value.some(m => !!m.verified))

const filtering = computed(() => !!kindFilter.value || !!keyword.value.trim())

const groups = computed<Group[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  const out: Group[] = []
  for (const provider of providers.value) {
    const own = models.value.filter(m => m.providerId === provider.id)
    const shown = own
      .filter(m => !kindFilter.value || m.kind === kindFilter.value)
      .filter(m => !kw || m.id.toLowerCase().includes(kw) || (m.label || '').toLowerCase().includes(kw))
      .slice()
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
    // 筛选时，一条都不剩的服务商整组不显示
    if (filtering.value && !shown.length) continue
    out.push({ provider, vendor: vendors.value.find(v => v.type === provider.type) || null, total: own.length, models: shown })
  }
  return out
})

function pricingSummary(p?: ModelPricing | null): string {
  if (!p) return t('settings.models.noPricing')
  const unit = t('settings.pricing.units.' + p.unit)
  // 按 token 计价可以输入、输出各一个单价（存在 table.input / table.output 里）
  if (p.unit === 'per_1m_tokens' && p.table) {
    const input = Number(p.table.input)
    const output = Number(p.table.output)
    if (!Number.isFinite(input) || !Number.isFinite(output)) return t('settings.models.noPricing')
    return t('settings.models.tokenPricing', { input: formatMoney(input, p.currency), output: formatMoney(output, p.currency), unit })
  }
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

// ---- 自定义模型 ----
const customDialog = ref<{ provider: ProviderInstance; vendor: Vendor; existing: CustomModel | null } | null>(null)
const removing = ref<{ provider: ProviderInstance; model: AdminModel } | null>(null)
const deleting = ref(false)

function openEditCustom(g: Group, m: AdminModel) {
  if (!g.vendor) return
  const name = upstreamName(m)
  const stored = g.provider.customModels.find(c => c.model === name)
  customDialog.value = { provider: g.provider, vendor: g.vendor, existing: stored || { model: name, kind: m.kind, label: '' } }
}

/** 自定义模型变了：这一页和画布用的模型清单都重新取 */
async function refreshAfterCustom() {
  await fetchAll().catch(() => undefined)
  loadModels().catch(() => undefined)
}

async function onCustomSaved() {
  customDialog.value = null
  MessagePlugin.success(t('common.saved'))
  await refreshAfterCustom()
}

async function confirmRemove() {
  const r = removing.value
  if (!r) return
  deleting.value = true
  try {
    unwrap(await adminApi.removeCustomModel(r.provider.id, upstreamName(r.model)))
    removing.value = null
    await refreshAfterCustom()
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
@import './tab-shared.css';

.head-tools { display: flex; gap: 8px; flex: none; }
.kind-filter { width: 110px; }
.search { width: 180px; }
.retry { margin-top: 12px; }
.verified-note { margin-top: 4px; }

.group { padding: 0; margin-bottom: 14px; }
.group-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid var(--n-5);
}
.group-title { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.group-vendor { font-size: 14.5px; font-weight: 600; color: var(--t-max); }
.group-name { font-size: 13px; color: var(--t-body); word-break: break-all; }
.group-count { font-size: 12px; color: var(--t-dim); }
.group-head .lc-btn { flex: none; }
.group-empty { padding: 20px 12px; }

.rows { padding: 0 16px; }
.row {
  display: grid; align-items: center; gap: 4px 12px;
  grid-template-columns: 44px minmax(0, 1fr) 132px 84px 190px 200px;
  padding: 10px 0; border-bottom: 1px solid var(--line-1); font-size: 13px; color: var(--t-body);
}
.row:last-child { border-bottom: 0; }
.row-head { padding: 8px 0; font-size: 12px; color: var(--t-dim); border-bottom-color: var(--n-5); }
.model-id { margin-top: 4px; font-size: 11.5px; color: var(--t-dim); word-break: break-all; }
.c-kind { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.custom-tag { border: 1px dashed var(--n-8); background: none; color: var(--t-strong); }
.sort-input { width: 76px; }
.cell-cap { display: none; }
.c-price { color: var(--t-strong); line-height: 1.5; }
.price-part { display: inline-block; }
.c-ops { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.confirm { width: 420px; }
.confirm p { line-height: 1.6; }

/* 窄屏：每个模型一张小卡片 —— 开关和名称一行，类型一行，排序和价格一行，按钮一行 */
@media (max-width: 760px) {
  .tab-head { flex-direction: column; }
  .head-tools { width: 100%; }
  .search { flex: 1; width: auto; min-width: 0; }
  .group-head { align-items: flex-start; flex-direction: column; }
  .rows { padding: 0 12px; }
  .row-head { display: none; }
  .row {
    grid-template-columns: 44px minmax(0, 1fr);
    grid-template-areas:
      'switch label'
      '. kind'
      '. sort'
      '. price'
      '. ops';
    align-items: start; padding: 12px 0;
  }
  .c-switch { grid-area: switch; padding-top: 5px; }
  .c-label { grid-area: label; }
  .c-kind { grid-area: kind; }
  .c-sort { grid-area: sort; display: flex; align-items: center; gap: 8px; }
  .cell-cap { display: inline; font-size: 12px; color: var(--t-dim); }
  .c-price { grid-area: price; font-size: 12.5px; }
  .c-ops { grid-area: ops; justify-content: flex-start; }
}
</style>
