<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.models.title') }}</h2>
        <p class="tab-desc">{{ t('settings.models.desc') }}</p>
      </div>
    </div>

    <div v-if="loading" class="lc-empty">{{ t('common.loading') }}</div>
    <div v-else-if="loadError" class="lc-empty">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="!providers.length" class="lc-card lc-empty">{{ t('settings.models.empty') }}</div>

    <template v-else>
      <!-- 筛选条 + 分组方式：列表滚动时留在顶上 -->
      <div class="toolbar">
        <div class="filters" role="group" :aria-label="t('settings.models.filter.title')">
          <LcSelect v-model="filters.provider" class="f-provider" size="sm" :options="providerOptions" :aria-label="t('settings.models.filter.provider')" data-filter="provider" />
          <LcSelect v-model="filters.kind" class="f-select" size="sm" :options="kindOptions" :aria-label="t('settings.models.kind')" data-filter="kind" />
          <LcSelect v-model="filters.status" class="f-select" size="sm" :options="statusOptions" :aria-label="t('settings.models.filter.status')" data-filter="status" />
          <LcSelect v-model="filters.source" class="f-select" size="sm" :options="sourceOptions" :aria-label="t('settings.models.filter.source')" data-filter="source" />
          <LcSelect v-model="filters.price" class="f-select" size="sm" :options="priceOptions" :aria-label="t('settings.models.pricing')" data-filter="price" />
          <input
            v-model="keyword"
            class="lc-input sm search"
            type="search"
            :placeholder="t('settings.models.filter.search')"
            :aria-label="t('settings.models.filter.search')"
          />
        </div>

        <div class="viewbar">
          <div class="seg" role="radiogroup" :aria-label="t('settings.models.groupBy')" @keydown="onSegKey">
            <button
              v-for="g in MODES"
              :key="g"
              type="button"
              class="seg-item"
              :class="{ on: mode === g }"
              role="radio"
              :aria-checked="mode === g"
              :tabindex="mode === g ? 0 : -1"
              :data-mode="g"
              @click="mode = g"
            >{{ g === 'provider' ? t('settings.models.byProvider') : t('settings.models.byKind') }}</button>
          </div>
          <span class="result" aria-live="polite">{{ filtering ? t('settings.models.resultCount', { total: models.length, shown: shownCount }) : t('settings.models.totalCount', { total: models.length }) }}</span>
          <button v-if="filtering" type="button" class="link-btn clear-filters" @click="clearFilters">{{ t('settings.models.clearFilters') }}</button>
          <span class="viewbar-actions">
            <button type="button" class="link-btn" data-act="expand-all" @click="setAllCollapsed(false)">{{ t('settings.models.expandAll') }}</button>
            <button type="button" class="link-btn" data-act="collapse-all" @click="setAllCollapsed(true)">{{ t('settings.models.collapseAll') }}</button>
          </span>
        </div>
      </div>

      <div
        v-for="s in sections"
        :key="s.key"
        class="lc-card group"
        :class="{ collapsed: isCollapsed(s.key) }"
        :data-section="s.key"
        :data-provider="s.provider?.slug"
      >
        <!-- 整条标题都能点；里面的按钮是给键盘和读屏用的那一个 -->
        <div class="group-head" @click="toggle(s.key)">
          <button type="button" class="group-toggle" :aria-expanded="!isCollapsed(s.key)" :aria-controls="bodyId(s.key)">
            <svg class="chevron" :class="{ open: !isCollapsed(s.key) }" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <template v-if="s.provider">
              <span class="group-vendor">{{ titleOf(s.provider).vendor }}</span>
              <span v-if="titleOf(s.provider).name" class="group-name">{{ titleOf(s.provider).name }}</span>
            </template>
            <span v-else-if="s.kind" class="group-vendor">{{ kindLabel(s.kind) }}</span>
            <span class="group-count">{{ countText(s.shown, s.total) }}</span>
            <span v-if="s.provider && !s.provider.enabled" class="lc-tag">{{ t('settings.models.providerDisabled') }}</span>
          </button>
          <button v-if="addTargets(s).length" type="button" class="lc-btn sm add-custom" @click.stop="openAdd(s)">
            {{ t('settings.models.addCustom') }}
          </button>
        </div>

        <div v-show="!isCollapsed(s.key)" :id="bodyId(s.key)" class="rows" role="table">
          <div v-if="s.subs.length" class="row row-head" role="row">
            <span role="columnheader">{{ t('settings.models.enabled') }}</span>
            <span role="columnheader">{{ t('settings.models.label') }}</span>
            <span role="columnheader">{{ t('settings.models.sort') }}</span>
            <span role="columnheader">{{ t('settings.models.pricing') }}</span>
            <span role="columnheader"></span>
          </div>
          <template v-for="sub in s.subs" :key="sub.key">
            <div class="sub-head" role="row" :data-sub="sub.key">
              <span role="cell" class="sub-title">
                <span v-if="sub.kind" class="kind-badge" :class="sub.kind">{{ kindLabel(sub.kind) }}</span>
                <template v-else-if="sub.provider">
                  <span class="sub-vendor">{{ titleOf(sub.provider).vendor }}</span>
                  <span v-if="titleOf(sub.provider).name" class="sub-name">{{ titleOf(sub.provider).name }}</span>
                </template>
                <span class="sub-count">{{ sub.models.length }}</span>
                <span v-if="sub.provider && !sub.provider.enabled" class="lc-tag">{{ t('settings.models.providerDisabled') }}</span>
              </span>
            </div>
            <div v-for="m in sub.models" :key="m.id" class="row" :class="{ off: !m.enabled }" role="row" :data-model="m.id">
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
                <div class="model-meta">
                  <span class="model-id">{{ upstreamName(m) }}</span>
                  <span v-if="m.custom" class="lc-tag custom-tag">{{ t('settings.models.custom') }}</span>
                  <span v-if="kept.has(m.id) && !matches(m)" class="lc-tag kept-tag" :title="t('settings.models.keptHint')">{{ t('settings.models.kept') }}</span>
                </div>
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
              <div class="c-price" :class="{ none: !m.pricing }" role="cell">
                <template v-for="(part, i) in pricingSummary(m.pricing).split(' · ')" :key="i"><template v-if="i"> · </template><span class="price-part">{{ part }}</span></template>
              </div>
              <div class="c-ops" role="cell">
                <button class="lc-btn sm" :disabled="busy === m.id" @click="editing = m">{{ t('settings.models.editPricing') }}</button>
                <template v-if="m.custom && vendorOf(m.providerId)">
                  <button class="lc-btn sm" :disabled="busy === m.id" @click="openEditCustom(m)">{{ t('common.edit') }}</button>
                  <button class="lc-btn sm danger" :disabled="busy === m.id" @click="openRemove(m)">{{ t('common.delete') }}</button>
                </template>
              </div>
            </div>
          </template>
          <div v-if="!s.subs.length" class="lc-empty group-empty">{{ t('common.empty') }}</div>
        </div>
      </div>

      <div v-if="!sections.length" class="lc-card lc-empty no-match">
        <p>{{ filtering ? t('settings.models.noMatch') : t('common.empty') }}</p>
        <button v-if="filtering" type="button" class="lc-btn sm" @click="clearFilters">{{ t('settings.models.clearFilters') }}</button>
      </div>
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
      :choices="customDialog.choices"
      :preset-kind="customDialog.presetKind"
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
 * 「模型」页：全部模型，按服务商或按类型分组，上面一条筛选。
 *
 * - 每个模型的类型是明确的（来自服务商的模型清单，或自定义模型上用户选的），这里只是显示它。
 * - 「排序」的含义没变：同一个服务商实例里，数字小的排前面，数字相同按清单里的顺序。
 *   画布下拉先按服务商、再按这个数字排，所以两种分组下，同一小组里的行都按它排。
 * - 分组方式、收起了哪些组、五个下拉筛选记在这个浏览器里；搜索词不记。
 * - 筛选生效时改了某一行、它因此不再符合条件：这一行留在原地并标出来，
 *   等筛选条件变了再消失 —— 点一下开关行就没了，连撤销的机会都没有。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
const MODES = ['provider', 'kind'] as const
type Mode = typeof MODES[number]

interface Filters {
  /** 服务商实例的 id */
  provider: string
  kind: ModelKind | ''
  status: '' | 'on' | 'off'
  source: '' | 'builtin' | 'custom'
  price: '' | 'set' | 'unset'
}

// ---- 记在浏览器里的那一份 ----
const STORE_KEY = 'loomcanvas-models-view'
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : fallback

function readStored(): { mode: Mode; filters: Filters; collapsed: string[] } {
  let raw: any = null
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch { /* 读不到或不是 JSON：用默认 */ }
  const f = raw && typeof raw.filters === 'object' && raw.filters ? raw.filters : {}
  return {
    mode: oneOf(raw?.mode, MODES, 'provider'),
    filters: {
      provider: typeof f.provider === 'string' ? f.provider : '',
      kind: oneOf(f.kind, ['', ...KINDS] as const, ''),
      status: oneOf(f.status, ['', 'on', 'off'] as const, ''),
      source: oneOf(f.source, ['', 'builtin', 'custom'] as const, ''),
      price: oneOf(f.price, ['', 'set', 'unset'] as const, ''),
    },
    collapsed: Array.isArray(raw?.collapsed) ? raw.collapsed.filter((k: unknown) => typeof k === 'string').slice(0, 200) : [],
  }
}

const stored = readStored()
const mode = ref<Mode>(stored.mode)
const filters = reactive<Filters>(stored.filters)
const collapsed = ref<Set<string>>(new Set(stored.collapsed))
const keyword = ref('')

watch([mode, filters, collapsed], () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ mode: mode.value, filters: { ...filters }, collapsed: [...collapsed.value] }))
  } catch { /* 隐私模式下写不进去：这次打开照常用 */ }
}, { deep: true })

// ---- 数据 ----
const models = ref<AdminModel[]>([])
const providers = ref<ProviderInstance[]>([])
const vendors = ref<Vendor[]>([])
const loading = ref(true)
const loadError = ref('')
const busy = ref('')
const editing = ref<AdminModel | null>(null)

async function fetchAll() {
  const [ms, ps, vs] = await Promise.all([adminApi.models(), adminApi.providers(), adminApi.vendors()])
  models.value = unwrap(ms) || []
  providers.value = unwrap(ps) || []
  vendors.value = unwrap(vs) || []
  // 记着的那个服务商已经被删了：这一项筛选作废
  if (filters.provider && !providers.value.some(p => p.id === filters.provider)) filters.provider = ''
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
const kindLabel = (k: ModelKind) => t('settings.models.kinds.' + k)
const providerOf = (id: string) => providers.value.find(p => p.id === id) || null
const vendorOfProvider = (p: ProviderInstance) => vendors.value.find(v => v.type === p.type) || null
function vendorOf(providerId: string): Vendor | null {
  const p = providerOf(providerId)
  return p ? vendorOfProvider(p) : null
}
/** 服务商名；实例名是用户自己起的（比如同一家加了两个）才另外带上 */
function titleOf(p: ProviderInstance): { vendor: string; name: string } {
  const v = vendorOfProvider(p)
  if (!v) return { vendor: p.type, name: p.name || '' }
  return { vendor: vendorLabel(v), name: isVendorDefaultName(v, p.name) ? '' : p.name }
}
function providerText(p: ProviderInstance): string {
  const { vendor, name } = titleOf(p)
  return name ? `${vendor} · ${name}` : vendor
}

// ---- 筛选 ----
const providerOptions = computed(() => [
  { value: '', label: t('settings.models.filter.allProviders') },
  ...providers.value.map(p => ({ value: p.id, label: providerText(p) })),
])
const kindOptions = computed<{ value: ModelKind | ''; label: string }[]>(() => [
  { value: '', label: t('settings.models.filter.allKinds') },
  ...KINDS.map(k => ({ value: k, label: kindLabel(k) })),
])
const statusOptions = computed<{ value: Filters['status']; label: string }[]>(() => [
  { value: '', label: t('settings.models.filter.allStatus') },
  { value: 'on', label: t('settings.models.filter.on') },
  { value: 'off', label: t('settings.models.filter.off') },
])
const sourceOptions = computed<{ value: Filters['source']; label: string }[]>(() => [
  { value: '', label: t('settings.models.filter.allSources') },
  { value: 'builtin', label: t('settings.models.filter.builtin') },
  { value: 'custom', label: t('settings.models.custom') },
])
const priceOptions = computed<{ value: Filters['price']; label: string }[]>(() => [
  { value: '', label: t('settings.models.filter.allPrices') },
  { value: 'set', label: t('settings.models.filter.priced') },
  { value: 'unset', label: t('settings.models.filter.unpriced') },
])

const kw = computed(() => keyword.value.trim().toLowerCase())
const filtering = computed(() => !!(filters.provider || filters.kind || filters.status || filters.source || filters.price || kw.value))

function matches(m: AdminModel): boolean {
  if (filters.provider && m.providerId !== filters.provider) return false
  if (filters.kind && m.kind !== filters.kind) return false
  if (filters.status && (filters.status === 'on') !== !!m.enabled) return false
  if (filters.source && (filters.source === 'custom') !== !!m.custom) return false
  if (filters.price && (filters.price === 'set') !== !!m.pricing) return false
  if (kw.value && !m.id.toLowerCase().includes(kw.value) && !(m.label || '').toLowerCase().includes(kw.value)) return false
  return true
}

/** 刚改过、因此不再符合筛选的那几行：留到筛选条件变了为止 */
const kept = ref<Set<string>>(new Set())
watch([filters, kw], () => { kept.value = new Set() }, { deep: true })
const visible = (m: AdminModel) => matches(m) || kept.value.has(m.id)
function keep(id: string) {
  kept.value = new Set(kept.value).add(id)
}

function clearFilters() {
  filters.provider = ''
  filters.kind = ''
  filters.status = ''
  filters.source = ''
  filters.price = ''
  keyword.value = ''
}

// ---- 分组 ----
interface SubGroup {
  key: string
  /** 按服务商分组时，小组是类型 */
  kind?: ModelKind
  /** 按类型分组时，小组是服务商实例 */
  provider?: ProviderInstance
  models: AdminModel[]
}
interface Section {
  key: string
  provider?: ProviderInstance
  kind?: ModelKind
  /** 这一组的模型总数（不受筛选影响） */
  total: number
  shown: number
  subs: SubGroup[]
}

const bySort = (a: AdminModel, b: AdminModel) => (Number(a.sort) || 0) - (Number(b.sort) || 0)

const sections = computed<Section[]>(() => {
  const out: Section[] = []
  const pick = (provider: ProviderInstance, kind: ModelKind) => models.value
    .filter(m => m.providerId === provider.id && m.kind === kind && visible(m))
    .sort(bySort)
  const push = (s: Omit<Section, 'shown'>) => {
    const shown = s.subs.reduce((n, sub) => n + sub.models.length, 0)
    // 筛选时，一条都不剩的组整个不显示
    if (filtering.value && !shown) return
    out.push({ ...s, shown })
  }
  if (mode.value === 'provider') {
    for (const provider of providers.value) {
      const subs: SubGroup[] = KINDS
        .map(kind => ({ key: `p:${provider.id}/${kind}`, kind, models: pick(provider, kind) }))
        .filter(sub => sub.models.length)
      push({ key: `p:${provider.id}`, provider, total: models.value.filter(m => m.providerId === provider.id).length, subs })
    }
  } else {
    for (const kind of KINDS) {
      const subs: SubGroup[] = providers.value
        .map(provider => ({ key: `k:${kind}/${provider.id}`, provider, models: pick(provider, kind) }))
        .filter(sub => sub.models.length)
      push({ key: `k:${kind}`, kind, total: models.value.filter(m => m.kind === kind).length, subs })
    }
  }
  return out
})

const shownCount = computed(() => sections.value.reduce((n, s) => n + s.shown, 0))

function countText(shown: number, total: number): string {
  return filtering.value && shown !== total
    ? t('settings.models.shownOf', { shown, total })
    : t('settings.providers.modelCount', { n: total })
}

// ---- 收起 / 展开 ----
const isCollapsed = (key: string) => collapsed.value.has(key)
const bodyId = (key: string) => 'models-sec-' + key.replace(/[^\w-]/g, '-')
function toggle(key: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) next.add(key)
  collapsed.value = next
}
function setAllCollapsed(v: boolean) {
  const next = new Set(collapsed.value)
  for (const s of sections.value) {
    if (v) next.add(s.key)
    else next.delete(s.key)
  }
  collapsed.value = next
}

/** 分组方式是一组单选：左右 / 上下键换一个，焦点跟过去 */
function onSegKey(e: KeyboardEvent) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = MODES[(MODES.indexOf(mode.value) + step + MODES.length) % MODES.length]
  mode.value = next
  const group = e.currentTarget as HTMLElement
  requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus())
}

// ---- 一行里的操作 ----
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
    if (i >= 0) {
      const was = visible(models.value[i])
      const next = { ...models.value[i], ...data, ...(updated || {}) }
      models.value[i] = next
      if (was && !matches(next)) keep(next.id)
    }
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
interface AddTarget { provider: ProviderInstance; vendor: Vendor }
const customDialog = ref<{
  provider: ProviderInstance
  vendor: Vendor
  existing: CustomModel | null
  /** 按类型分组时从类型那一组里添加：可以选加到哪个服务商 */
  choices?: AddTarget[]
  presetKind?: ModelKind
} | null>(null)
const removing = ref<{ provider: ProviderInstance; model: AdminModel } | null>(null)
const deleting = ref(false)

/** 这一组的「添加自定义模型」能加到哪些服务商上；空 = 不显示按钮 */
function addTargets(s: Section): AddTarget[] {
  const out: AddTarget[] = []
  for (const provider of s.provider ? [s.provider] : providers.value) {
    const vendor = vendorOfProvider(provider)
    if (!vendor || !vendor.customKinds.length) continue
    if (s.kind && !vendor.customKinds.includes(s.kind)) continue
    if (!s.provider && filters.provider && provider.id !== filters.provider) continue
    out.push({ provider, vendor })
  }
  return out
}

function openAdd(s: Section) {
  const targets = addTargets(s)
  if (!targets.length) return
  customDialog.value = {
    ...targets[0],
    existing: null,
    choices: targets.length > 1 ? targets : undefined,
    presetKind: s.kind,
  }
}

function openEditCustom(m: AdminModel) {
  const provider = providerOf(m.providerId)
  const vendor = vendorOf(m.providerId)
  if (!provider || !vendor) return
  const name = upstreamName(m)
  const saved = provider.customModels.find(c => c.model === name)
  customDialog.value = { provider, vendor, existing: saved || { model: name, kind: m.kind, label: '' } }
}

function openRemove(m: AdminModel) {
  const provider = providerOf(m.providerId)
  if (provider) removing.value = { provider, model: m }
}

/**
 * 自定义模型变了：这一页和画布用的模型清单都重新取。
 * 新加的、或者改完之后不符合当前筛选的那一个留在列表里（见文件头），它所在的组也展开。
 */
async function refreshAfterCustom(touched?: string) {
  const before = new Set(models.value.map(m => m.id))
  await fetchAll().catch(() => undefined)
  loadModels().catch(() => undefined)
  const open = new Set(collapsed.value)
  for (const m of models.value) {
    if (before.has(m.id) && m.id !== touched) continue
    if (!matches(m)) keep(m.id)
    open.delete(mode.value === 'provider' ? `p:${m.providerId}` : `k:${m.kind}`)
  }
  if (open.size !== collapsed.value.size) collapsed.value = open
}

async function onCustomSaved() {
  const d = customDialog.value
  // 编辑的是哪一个：靠它去掉前缀的模型名和所属服务商认
  const touched = d?.existing
    ? models.value.find(m => m.providerId === d.provider.id && upstreamName(m) === d.existing!.model)?.id
    : undefined
  customDialog.value = null
  MessagePlugin.success(t('common.saved'))
  await refreshAfterCustom(touched)
}

async function confirmRemove() {
  const r = removing.value
  if (!r) return
  deleting.value = true
  try {
    unwrap(await adminApi.removeCustomModel(r.provider.id, upstreamName(r.model)))
    removing.value = null
    await fetchAll().catch(() => undefined)
    loadModels().catch(() => undefined)
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
@import './tab-shared.css';

.retry { margin-top: 12px; }

/* ---- 筛选条 ---- */
.toolbar {
  position: sticky; top: 0; z-index: 20;
  margin: -6px -8px 12px; padding: 8px 8px 10px;
  background: var(--n-0);
}
/* 吸顶时，滚到它下面去的行在边上淡出，不是被一刀切掉 */
.toolbar::after {
  content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 10px; pointer-events: none;
  background: linear-gradient(var(--n-0), transparent);
}
.filters { display: flex; align-items: center; gap: 8px; }
.f-provider { flex: none; width: 168px; }
.f-select { flex: none; width: 124px; }
.search { flex: 1; min-width: 140px; }
.search::-webkit-search-cancel-button { cursor: pointer; }

.viewbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; margin-top: 10px; min-height: 28px; }
.seg {
  display: inline-flex; flex: none; padding: 2px; gap: 2px;
  border: 1px solid var(--n-5); border-radius: 8px; background: var(--n-3);
}
.seg-item {
  height: 24px; padding: 0 12px; border: 0; border-radius: 6px; background: transparent;
  color: var(--t-body); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.seg-item:hover { color: var(--t-max); }
.seg-item.on { background: var(--n-6); color: var(--t-max); font-weight: 600; }
.seg-item:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 1px; }
.result { font-size: 12.5px; color: var(--t-dim); white-space: nowrap; }
.viewbar-actions { display: flex; gap: 12px; margin-left: auto; }
.link-btn {
  height: 24px; padding: 0 4px; border: 0; border-radius: 4px; background: none;
  color: var(--t-body); font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer;
}
.link-btn:hover { color: var(--t-max); text-decoration: underline; }
.link-btn:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 1px; }
.clear-filters, .clear-filters:hover { color: var(--accent-text); }

/* ---- 一组 ---- */
.group { padding: 0; margin-bottom: 12px; }
.group-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 0 16px 0 0; min-height: 50px; border-bottom: 1px solid var(--n-5); cursor: pointer;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}
.group.collapsed .group-head { border-bottom-color: transparent; border-radius: var(--radius-lg); }
.group-head:hover { background: var(--n-3); }
.group-toggle {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; flex: 1; min-width: 0;
  padding: 12px 0 12px 16px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
  border-radius: var(--radius-lg);
}
.group-toggle:focus-visible { outline: 2px solid var(--accent-line); outline-offset: -2px; }
.chevron { width: 12px; height: 12px; flex: none; color: var(--t-dim); transition: transform .15s ease; }
.chevron.open { transform: rotate(90deg); }
.group-vendor { font-size: 14.5px; font-weight: 600; color: var(--t-max); }
.group-name { font-size: 13px; color: var(--t-body); word-break: break-all; }
.group-count { font-size: 12px; color: var(--t-dim); }
.add-custom { flex: none; }
.group-empty { padding: 20px 12px; }
.no-match p { margin-bottom: 12px; }

/* ---- 行 ----
   列宽写死，各组之间的行才能对齐。类型不单独占一列：它要么是小组标题（按服务商），要么是组标题（按类型）。 */
.rows { padding: 0 16px; }
.row {
  display: grid; align-items: center; gap: 4px 12px;
  grid-template-columns: 44px minmax(0, 1fr) 84px 256px 196px;
  padding: 8px 0; border-bottom: 1px solid var(--line-1); font-size: 13px; color: var(--t-body);
}
.rows > :last-child { border-bottom: 0; }
.row-head { padding: 8px 0; font-size: 12px; color: var(--t-dim); border-bottom-color: var(--n-5); }
.sub-head {
  display: flex; align-items: center; margin: 0 -16px; padding: 7px 16px;
  background: var(--n-1); border-bottom: 1px solid var(--line-1);
}
.sub-title { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.sub-vendor { font-size: 12.5px; font-weight: 600; color: var(--t-strong); }
.sub-name { font-size: 12.5px; color: var(--t-body); word-break: break-all; }
.sub-count { font-size: 12px; color: var(--t-dim); font-variant-numeric: tabular-nums; }
.model-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin-top: 4px; min-height: 18px; }
.model-id { font-size: 11.5px; color: var(--t-dim); word-break: break-all; }
.model-meta .lc-tag { height: 18px; padding: 0 7px; flex: none; }
.custom-tag { border: 1px dashed var(--n-8); background: none; color: var(--t-strong); }
.kept-tag { background: var(--warning-dim); color: var(--warning); cursor: help; }
.sort-input { width: 76px; }
.cell-cap { display: none; }
.c-price { color: var(--t-strong); line-height: 1.5; }
.c-price.none { color: var(--t-dim); }
.price-part { display: inline-block; }
.c-ops { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.confirm { width: 420px; }
.confirm p { line-height: 1.6; }

/* 窄屏：筛选条两个一行、不再吸顶（它自己就有三行高）；每个模型一张小卡片 ——
   开关和名称一行，排序和价格一行，按钮一行 */
@media (max-width: 760px) {
  .toolbar { position: static; margin: 0 0 12px; padding: 0; }
  .toolbar::after { display: none; }
  .filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .f-provider, .f-select, .search { width: auto; min-width: 0; }
  .viewbar { gap: 8px 12px; }
  .group-head { padding-right: 12px; gap: 8px; }
  .group-toggle { padding-left: 12px; }
  .rows { padding: 0 12px; }
  .sub-head { margin: 0 -12px; padding: 7px 12px; }
  .row-head { display: none; }
  .row {
    grid-template-columns: 44px auto minmax(0, 1fr);
    grid-template-areas:
      'switch label label'
      '. sort price'
      '. ops ops';
    align-items: center; gap: 8px 12px; padding: 12px 0;
  }
  .c-switch { grid-area: switch; align-self: start; padding-top: 5px; }
  .c-label { grid-area: label; }
  .c-sort { grid-area: sort; display: flex; align-items: center; gap: 8px; }
  .sort-input { width: 64px; }
  .cell-cap { display: inline; font-size: 12px; color: var(--t-dim); }
  .c-price { grid-area: price; font-size: 12.5px; }
  .c-ops { grid-area: ops; justify-content: flex-start; }
}
</style>
