<template>
  <div class="lc-page">
    <div class="lc-page-inner">
      <div class="lc-page-head">
        <div class="mp-head">
          <h1 class="lc-ph1">{{ t('modelsPage.title') }}</h1>
          <p class="lc-ph-sub">{{ t('modelsPage.sub') }}</p>
        </div>
        <span class="lc-sp"></span>
        <button v-if="!loading && !loadError" class="lc-btn" :disabled="!vendors.length" data-act="add-provider" @click="openAdd()">
          <LcIcon name="plus" />{{ t('modelsPage.addProvider') }}
        </button>
      </div>

      <!-- 冷启动：骨架 -->
      <div v-if="loading" class="mm" aria-busy="true" :aria-label="t('common.loading')">
        <div class="mm-side">
          <div class="mm-provs">
            <div v-for="n in 2" :key="n" class="lc-card pc sk-card" aria-hidden="true">
              <div class="pc-top"><span class="sk sk-pi"></span><div class="sk-lines"><span class="sk" style="width: 96px; height: 14px"></span><span class="sk" style="width: 168px; height: 10px"></span></div></div>
              <span v-for="i in 3" :key="i" class="sk" style="height: 12px"></span>
              <span class="sk" style="height: 28px"></span>
            </div>
          </div>
        </div>
        <div class="lc-card mpanel" aria-hidden="true">
          <div class="mp-top"><span class="sk sk-pi"></span><div class="sk-lines"><span class="sk" style="width: 160px; height: 16px"></span><span class="sk" style="width: 220px; height: 10px"></span></div></div>
          <div class="sk-bar"><span class="sk" style="height: 32px"></span></div>
          <div v-for="n in 7" :key="n" class="sk-row">
            <span class="sk" style="width: 36px; height: 20px; border-radius: 10px"></span>
            <div class="sk-lines"><span class="sk" style="width: 140px; height: 13px"></span><span class="sk" style="width: 110px; height: 10px"></span></div>
            <span class="sk sk-grow" style="height: 22px"></span>
          </div>
        </div>
      </div>

      <!-- 取不到数据 -->
      <div v-else-if="loadError" class="lc-card mp-state" role="alert">
        <LcIcon name="warn" size="xl" class="mp-state-ic err" />
        <p class="mp-state-title">{{ t('common.loadFailed') }}</p>
        <p class="mp-state-text">{{ loadError }}</p>
        <button class="lc-btn" @click="load"><LcIcon name="refresh" size="s" />{{ t('common.retry') }}</button>
      </div>

      <!-- 一个服务商都还没有 -->
      <template v-else-if="!providers.length">
        <div class="lc-card lc-gb mp-state mp-empty">
          <span class="mp-empty-ic"><LcIcon name="server" size="xl" /></span>
          <p class="mp-state-title">{{ t('modelsPage.empty.title') }}</p>
          <p class="mp-state-text">{{ t('modelsPage.empty.text') }}</p>
          <button class="lc-btn primary" :disabled="!vendors.length" data-act="add-first-provider" @click="openAdd()">
            <LcIcon name="plus" />{{ t('modelsPage.addProvider') }}
          </button>
        </div>
        <div class="lc-card mm-about mp-empty-about">
          <div class="lc-row"><LcIcon name="key" class="about-ic" /><b>{{ t('modelsPage.about.title') }}</b></div>
          <p>{{ t('modelsPage.about.text') }}</p>
        </div>
      </template>

      <div v-else class="mm">
        <!-- 左列：服务商 -->
        <div class="mm-side">
          <div class="mm-provs" role="list" :aria-label="t('modelsPage.providersLabel')">
            <article
              v-for="p in providers"
              :key="p.id"
              class="lc-card pc"
              :class="{ 'sel lc-gb': p.id === current?.id }"
              role="listitem"
              :data-provider="p.id"
              @click="select(p.id)"
            >
              <div class="pc-top">
                <span class="pi" aria-hidden="true">{{ initialOf(p) }}</span>
                <div class="pc-tt">
                  <div class="pc-name-row">
                    <h3>
                      <button type="button" class="pc-name" :aria-pressed="p.id === current?.id" :title="t('modelsPage.card.select', { name: p.name })" @click.stop="select(p.id)">{{ p.name }}</button>
                    </h3>
                    <span v-if="vendorOf(p)?.recommended" class="lc-bd rec">{{ t('modelsPage.provider.recommended') }}</span>
                  </div>
                  <span class="pc-sub" :title="taglineOf(p)">{{ taglineOf(p) }}</span>
                </div>
              </div>
              <dl>
                <dt>{{ t('modelsPage.card.status') }}</dt>
                <dd><span class="lc-st" :class="statusOf(p).cls" data-role="status">{{ statusOf(p).text }}</span></dd>
                <dt>{{ t('modelsPage.card.apiKey') }}</dt>
                <dd v-if="p.hasKey">{{ t('modelsPage.card.keySet') }}<span v-if="p.keyTail" class="lc-mono key-tail"> ····{{ p.keyTail }}</span></dd>
                <dd v-else class="lc-t3">{{ t('modelsPage.card.keyUnset') }}</dd>
                <dt>{{ t('modelsPage.card.models') }}</dt>
                <dd>{{ t('modelsPage.card.count', countsOf(p.id)) }}</dd>
                <template v-if="p.customBaseUrl && p.baseUrl">
                  <dt>{{ t('modelsPage.card.address') }}</dt>
                  <dd class="pc-url lc-mono" :title="t('modelsPage.provider.customAddress') + ' · ' + p.baseUrl">{{ p.baseUrl }}</dd>
                </template>
              </dl>
              <p v-if="testResult[p.id] && !testResult[p.id].ok && testResult[p.id].message && testing !== p.id" class="pc-msg" role="status">{{ testResult[p.id].message }}</p>
              <div class="pc-ops">
                <template v-if="p.hasKey">
                  <button class="lc-btn sm" :disabled="testing === p.id" data-act="test" @click.stop="test(p)">
                    <LcIcon name="refresh" size="s" :class="{ spinning: testing === p.id }" />{{ t('modelsPage.card.test') }}
                  </button>
                  <button class="lc-btn sm" data-act="edit" @click.stop="openEdit(p)"><LcIcon name="edit" size="s" />{{ t('common.edit') }}</button>
                </template>
                <button v-else class="lc-btn sm fill-key" data-act="edit" @click.stop="openEdit(p)"><LcIcon name="key" size="s" />{{ t('modelsPage.card.fillKey') }}</button>
              </div>
            </article>

            <!-- 清单里有、但还没添加的服务商 -->
            <article v-for="v in idleVendors" :key="'v-' + v.type" class="lc-card pc idle" role="listitem" :data-vendor="v.type">
              <div class="pc-top">
                <span class="pi" aria-hidden="true">{{ initial(vendorLabel(v)) }}</span>
                <div class="pc-tt">
                  <div class="pc-name-row">
                    <h3>{{ vendorLabel(v) }}</h3>
                    <span v-if="v.recommended" class="lc-bd rec">{{ t('modelsPage.provider.recommended') }}</span>
                  </div>
                  <span class="pc-sub" :title="vendorDesc(v)">{{ vendorDesc(v) }}</span>
                </div>
              </div>
              <dl>
                <dt>{{ t('modelsPage.card.status') }}</dt>
                <dd><span class="lc-st wait">{{ t('modelsPage.st.unconfigured') }}</span></dd>
                <dt>{{ t('modelsPage.card.apiKey') }}</dt>
                <dd class="lc-t3">{{ t('modelsPage.card.keyUnset') }}</dd>
                <dt>{{ t('modelsPage.card.models') }}</dt>
                <dd>{{ t('modelsPage.card.afterKey') }}</dd>
              </dl>
              <div class="pc-ops">
                <button class="lc-btn sm fill-key" @click="openAdd(v.type)"><LcIcon name="key" size="s" />{{ t('modelsPage.card.fillKey') }}</button>
              </div>
            </article>

            <button type="button" class="padd" :disabled="!vendors.length" data-act="add-tile" @click="openAdd()">
              <LcIcon name="plus" /><span>{{ t('modelsPage.addTile') }}</span>
            </button>
          </div>

          <div class="lc-card mm-about">
            <div class="lc-row"><LcIcon name="key" class="about-ic" /><b>{{ t('modelsPage.about.title') }}</b></div>
            <p>{{ t('modelsPage.about.text') }}</p>
          </div>
        </div>

        <!-- 右侧：当前服务商的模型 -->
        <section v-if="current" class="lc-card mpanel" :aria-labelledby="'mp-title'">
          <div class="mp-top">
            <span class="pi" aria-hidden="true">{{ initialOf(current) }}</span>
            <div class="mp-tt">
              <h2 id="mp-title">{{ t('modelsPage.panel.title', { name: current.name }) }}</h2>
              <span class="mp-counts" aria-live="polite">
                {{ t('modelsPage.panel.counts', { n: providerModels.length, ...kindCounts }) }}
                <template v-if="filtering"> · {{ t('modelsPage.panel.shown', { shown: shownCount, total: providerModels.length }) }}</template>
              </span>
            </div>
            <span class="lc-sp"></span>
            <button v-if="canAddCustom" class="lc-btn primary" data-act="add-custom" @click="openAddCustom">
              <LcIcon name="plus" />{{ t('modelsPage.custom.add') }}
            </button>
          </div>

          <div v-if="!current.hasKey || !current.enabled" class="lc-alert warn mp-alert">
            <LcIcon name="warn" size="s" />
            <span>{{ !current.hasKey ? t('modelsPage.panel.noKeyHint') : t('modelsPage.panel.disabledHint') }}</span>
          </div>

          <div class="lc-fbar mp-fbar" role="group" :aria-label="t('modelsPage.filter.title')">
            <div class="lc-seg" role="radiogroup" :aria-label="t('modelsPage.filter.kind')" @keydown="onSegKey">
              <button
                v-for="k in KIND_TABS"
                :key="k || 'all'"
                type="button"
                :class="{ on: filters.kind === k }"
                role="radio"
                :aria-checked="filters.kind === k"
                :tabindex="filters.kind === k ? 0 : -1"
                :data-kind="k || 'all'"
                @click="filters.kind = k"
              >{{ k ? kindLabel(k) : t('modelsPage.filter.all') }}</button>
            </div>
            <LcSelect v-model="filters.status" class="f-select" size="sm" :options="statusOptions" :aria-label="t('modelsPage.filter.status')" data-filter="status" />
            <LcSelect v-model="filters.source" class="f-select" size="sm" :options="sourceOptions" :aria-label="t('modelsPage.filter.source')" data-filter="source" />
            <LcSelect v-model="filters.price" class="f-select" size="sm" :options="priceOptions" :aria-label="t('modelsPage.filter.price')" data-filter="price" />
            <label class="lc-inp sm grow f-search">
              <LcIcon name="search" size="s" />
              <input v-model="keyword" type="search" :placeholder="t('modelsPage.filter.search')" :aria-label="t('modelsPage.filter.search')" />
            </label>
            <button v-if="filtering" type="button" class="lc-btn sm text" data-act="clear-filters" @click="clearFilters">{{ t('modelsPage.filter.clear') }}</button>
          </div>

          <div class="mtable" role="table" :aria-labelledby="'mp-title'">
            <div class="mcols" role="row">
              <span role="columnheader">{{ t('modelsPage.cols.enabled') }}</span>
              <span role="columnheader">{{ t('modelsPage.cols.model') }}</span>
              <span role="columnheader">{{ t('modelsPage.cols.caps') }}</span>
              <span role="columnheader">{{ t('modelsPage.cols.price') }}</span>
              <span role="columnheader" class="c-act-h">{{ t('modelsPage.cols.actions') }}</span>
            </div>

            <template v-for="g in groups" :key="g.kind">
              <div class="mgrp" role="row" :data-group="g.kind">
                <span role="cell" class="mgrp-in"><span class="lc-bd" :class="g.kind">{{ kindLabel(g.kind) }}</span>{{ t('modelsPage.groupCount', { n: g.models.length }) }}</span>
              </div>
              <div v-for="m in g.models" :key="m.id" class="mrow" :class="{ off: !m.enabled }" role="row" :data-model="m.id">
                <div class="c-sw" role="cell">
                  <button
                    class="lc-switch"
                    :class="{ on: m.enabled }"
                    :disabled="busy === m.id"
                    role="switch"
                    :aria-checked="m.enabled"
                    :aria-label="t('modelsPage.row.enable', { name: m.label || upstreamName(m) })"
                    @click="patch(m, { enabled: !m.enabled })"
                  />
                </div>
                <div class="c-name" role="cell">
                  <b :title="m.label">{{ m.label || upstreamName(m) }}</b>
                  <small :title="upstreamName(m)">{{ upstreamName(m) }}</small>
                </div>
                <div class="c-caps" role="cell" :title="capsSummary(m).join(' · ')">
                  <span v-if="m.custom" class="lc-chip o">{{ t('modelsPage.row.custom') }}</span>
                  <span v-for="c in capChips(m)" :key="c" class="lc-chip">{{ c }}</span>
                  <span v-if="kept.has(m.id) && !matches(m)" class="lc-tag warn kept-tag" :title="t('modelsPage.row.keptHint')">{{ t('modelsPage.row.kept') }}</span>
                </div>
                <div class="c-price" role="cell" data-role="price">
                  <span v-if="!pricingParts(m.pricing).length" class="lc-unk">{{ t('modelsPage.row.unset') }}</span>
                  <template v-else>
                    <span v-for="(part, i) in pricingParts(m.pricing)" :key="i" class="price-part">{{ part }}</span>
                  </template>
                </div>
                <div class="c-act" role="cell">
                  <button class="lc-btn sm" :disabled="busy === m.id" data-act="price" @click="editing = m">
                    {{ m.pricing ? t('modelsPage.row.editPrice') : t('modelsPage.row.setPrice') }}
                  </button>
                  <RowMenu :items="menuOf(m)" :label="t('modelsPage.row.more')" :disabled="busy === m.id" @pick="onMenu(m, $event)" />
                </div>
              </div>
            </template>

            <div v-if="!groups.length" class="lc-empty mp-none">
              <p>{{ filtering ? t('modelsPage.filter.noMatch') : t('common.empty') }}</p>
              <button v-if="filtering" type="button" class="lc-btn sm" @click="clearFilters">{{ t('modelsPage.filter.clear') }}</button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <ProviderDialog
      v-if="providerDialog"
      :vendors="vendors"
      :existing="providerDialog.existing"
      :preset-vendor="providerDialog.vendor"
      @close="providerDialog = null"
      @saved="onProviderSaved"
      @removed="onProviderRemoved"
    />

    <PricingEditor
      v-if="editing"
      :model="editing"
      :saving="busy === editing.id"
      @close="editing = null"
      @save="savePricing"
    />

    <ModelEditDialog
      v-if="renaming"
      :model="renaming"
      :saving="busy === renaming.id"
      @close="renaming = null"
      @save="saveRename"
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
    <div v-if="removing" class="lc-mask" @click.self="cancelRemove" @keydown.esc="cancelRemove">
      <div class="lc-dialog confirm" role="alertdialog" aria-modal="true">
        <div class="lc-dialog-head"><span>{{ t('modelsPage.custom.deleteTitle') }}</span></div>
        <div class="lc-dialog-body">
          <p>{{ t('modelsPage.custom.deleteText', { name: removing.model.label || upstreamName(removing.model) }) }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="deleting" @click="cancelRemove">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" :disabled="deleting" data-act="confirm-delete-model" @click="confirmRemove">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「模型管理」页：左列是服务商，右边是选中那一家的模型。
 *
 * - 地址里的 ?provider=<id> 决定选中哪一家；没有（或那一家已经不在了）就是第一家。
 * - 每个模型的类型是明确的（来自服务商的模型清单，或自定义模型上用户选的），这里只是按它分组显示。
 * - 同一组里按「排序」数字从小到大排，数字相同按清单里的顺序 —— 画布下拉用的也是这个顺序。
 * - 四个筛选项记在这个浏览器里；搜索词不记。
 * - 筛选生效时改了某一行、它因此不再符合条件：这一行留在原地并标出来，
 *   等筛选条件变了再消失 —— 点一下开关行就没了，连撤销的机会都没有。
 * - 连通性测试的结果只在这一页的内存里：后端不保存，刷新之后回到「未测试」。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { loadModels } from '@/utils/canvasModels'
import { capsSummary } from '@/utils/modelCaps'
import { vendorDesc, vendorLabel, isVendorDefaultName } from '@/utils/providerMeta'
import { useAppStore } from '@/stores/app'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import ProviderDialog from '@/components/models/ProviderDialog.vue'
import PricingEditor from '@/components/models/PricingEditor.vue'
import CustomModelDialog from '@/components/models/CustomModelDialog.vue'
import ModelEditDialog from '@/components/models/ModelEditDialog.vue'
import RowMenu, { type RowMenuItem } from '@/components/models/RowMenu.vue'
import { capChips, pricingParts, upstreamName } from '@/components/models/modelMeta'
import type { AdminModel, CustomModel, ModelKind, ModelPricing, ProviderInstance, ProviderTestResult, Vendor } from '@/types'

const { t } = useI18n()
const app = useAppStore()
const route = useRoute()
const router = useRouter()

const KINDS: ModelKind[] = ['image', 'video', 'chat']
const KIND_TABS: (ModelKind | '')[] = ['', ...KINDS]
const kindLabel = (k: ModelKind) => t('modelsPage.kinds.' + k)

// ---- 数据 ----
const vendors = ref<Vendor[]>([])
const providers = ref<ProviderInstance[]>([])
const models = ref<AdminModel[]>([])
const loading = ref(true)
const loadError = ref('')

async function fetchAll() {
  const [vs, ps, ms] = await Promise.all([adminApi.vendors(), adminApi.providers(), adminApi.models()])
  vendors.value = unwrap(vs) || []
  providers.value = unwrap(ps) || []
  models.value = unwrap(ms) || []
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

/** 服务商变了：启动信息里的 hasProvider 和画布用的模型清单都要跟着刷新 */
async function refreshAfterChange() {
  await Promise.all([
    app.loadBootstrap(),
    loadModels().catch(() => undefined),
  ])
}

// ---- 服务商 ----
const vendorOf = (p: ProviderInstance) => vendors.value.find(v => v.type === p.type) || null
const initial = (s: string) => (s.trim()[0] || '?').toUpperCase()
function initialOf(p: ProviderInstance): string {
  const v = vendorOf(p)
  return initial(v ? vendorLabel(v) : p.name || p.type)
}
/** 名字下面那一行：实例用的是服务商默认名时放一句介绍；自己起过名字的，说明它是哪一家 */
function taglineOf(p: ProviderInstance): string {
  const v = vendorOf(p)
  if (!v) return p.type
  return isVendorDefaultName(v, p.name) ? (vendorDesc(v) || vendorLabel(v)) : vendorLabel(v)
}
/** 清单里有、但一个实例都还没添加的服务商 */
const idleVendors = computed(() => vendors.value.filter(v => !providers.value.some(p => p.type === v.type)))

function countsOf(providerId: string): { n: number; on: number } {
  let n = 0
  let on = 0
  for (const m of models.value) {
    if (m.providerId !== providerId) continue
    n++
    if (m.enabled) on++
  }
  return { n, on }
}

const current = computed<ProviderInstance | null>(() => {
  const id = typeof route.query.provider === 'string' ? route.query.provider : ''
  return providers.value.find(p => p.id === id) || providers.value[0] || null
})

function select(id: string) {
  if (route.query.provider === id) return
  router.replace({ query: { ...route.query, provider: id } })
}

// ---- 连通性测试 ----
const testing = ref('')
const testResult = reactive<Record<string, ProviderTestResult>>({})

function statusOf(p: ProviderInstance): { cls: string; text: string } {
  if (testing.value === p.id) return { cls: 'run', text: t('modelsPage.st.testing') }
  if (!p.hasKey) return { cls: 'wait', text: t('modelsPage.st.noKey') }
  if (!p.enabled) return { cls: 'wait', text: t('modelsPage.st.disabled') }
  const r = testResult[p.id]
  if (!r) return { cls: 'wait', text: t('modelsPage.st.untested') }
  return r.ok ? { cls: 'ok', text: t('modelsPage.st.ok') } : { cls: 'err', text: t('modelsPage.st.failed') }
}

async function test(p: ProviderInstance) {
  testing.value = p.id
  try {
    testResult[p.id] = unwrap(await adminApi.testProvider(p.id))
  } catch (err) {
    testResult[p.id] = { ok: false, message: apiErrorMessage(err, t('modelsPage.st.failed')) }
  } finally {
    testing.value = ''
  }
}

// ---- 添加 / 编辑 / 删除服务商 ----
const providerDialog = ref<{ existing: ProviderInstance | null; vendor?: string } | null>(null)

function openAdd(vendor?: string) {
  if (!vendors.value.length) return
  providerDialog.value = { existing: null, vendor }
}

function openEdit(p: ProviderInstance) {
  if (!vendorOf(p)) {
    MessagePlugin.error(t('modelsPage.provider.unknownType', { type: p.type }))
    return
  }
  providerDialog.value = { existing: p }
}

async function onProviderSaved(saved: ProviderInstance | null, created: boolean) {
  providerDialog.value = null
  // 改过 Key 或地址之后，上一次的测试结果不再说明什么
  if (saved && !created) delete testResult[saved.id]
  await fetchAll().catch(() => undefined)
  if (saved && created) select(saved.id)
  await refreshAfterChange()
}

async function onProviderRemoved(id: string) {
  providerDialog.value = null
  delete testResult[id]
  if (route.query.provider === id) {
    const { provider: _gone, ...rest } = route.query
    router.replace({ query: rest })
  }
  await fetchAll().catch(() => undefined)
  await refreshAfterChange()
}

// ---- 筛选（记在浏览器里；搜索词不记） ----
interface Filters {
  kind: ModelKind | ''
  status: '' | 'on' | 'off'
  source: '' | 'builtin' | 'custom'
  price: '' | 'set' | 'unset'
}
const STORE_KEY = 'loomcanvas-models-view'
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : fallback

function readStored(): Filters {
  let raw: any = null
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch { /* 读不到或不是 JSON：用默认 */ }
  const f = raw && typeof raw.filters === 'object' && raw.filters ? raw.filters : {}
  return {
    kind: oneOf(f.kind, ['', ...KINDS] as const, ''),
    status: oneOf(f.status, ['', 'on', 'off'] as const, ''),
    source: oneOf(f.source, ['', 'builtin', 'custom'] as const, ''),
    price: oneOf(f.price, ['', 'set', 'unset'] as const, ''),
  }
}

const filters = reactive<Filters>(readStored())
const keyword = ref('')

watch(filters, () => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ filters: { ...filters } })) } catch { /* 隐私模式下写不进去：这次打开照常用 */ }
}, { deep: true })

const statusOptions = computed<{ value: Filters['status']; label: string }[]>(() => [
  { value: '', label: t('modelsPage.filter.statusAll') },
  { value: 'on', label: t('modelsPage.filter.on') },
  { value: 'off', label: t('modelsPage.filter.off') },
])
const sourceOptions = computed<{ value: Filters['source']; label: string }[]>(() => [
  { value: '', label: t('modelsPage.filter.sourceAll') },
  { value: 'builtin', label: t('modelsPage.filter.builtin') },
  { value: 'custom', label: t('modelsPage.filter.custom') },
])
const priceOptions = computed<{ value: Filters['price']; label: string }[]>(() => [
  { value: '', label: t('modelsPage.filter.priceAll') },
  { value: 'set', label: t('modelsPage.filter.priced') },
  { value: 'unset', label: t('modelsPage.filter.unpriced') },
])

const kw = computed(() => keyword.value.trim().toLowerCase())
const filtering = computed(() => !!(filters.kind || filters.status || filters.source || filters.price || kw.value))

function matches(m: AdminModel): boolean {
  if (filters.kind && m.kind !== filters.kind) return false
  if (filters.status && (filters.status === 'on') !== !!m.enabled) return false
  if (filters.source && (filters.source === 'custom') !== !!m.custom) return false
  if (filters.price && (filters.price === 'set') !== !!m.pricing) return false
  if (kw.value && !m.id.toLowerCase().includes(kw.value) && !(m.label || '').toLowerCase().includes(kw.value)) return false
  return true
}

/** 刚改过、因此不再符合筛选的那几行：留到筛选条件变了为止 */
const kept = ref<Set<string>>(new Set())
watch([filters, kw, () => current.value?.id], () => { kept.value = new Set() }, { deep: true })
const visible = (m: AdminModel) => matches(m) || kept.value.has(m.id)
function keep(id: string) {
  kept.value = new Set(kept.value).add(id)
}

function clearFilters() {
  filters.kind = ''
  filters.status = ''
  filters.source = ''
  filters.price = ''
  keyword.value = ''
}

/** 类型是一组单选：左右 / 上下键换一个，焦点跟过去 */
function onSegKey(e: KeyboardEvent) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = KIND_TABS[(KIND_TABS.indexOf(filters.kind) + step + KIND_TABS.length) % KIND_TABS.length]
  filters.kind = next
  const group = e.currentTarget as HTMLElement
  requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-kind="${next || 'all'}"]`)?.focus())
}

// ---- 当前服务商的模型 ----
const providerModels = computed(() => models.value.filter(m => m.providerId === current.value?.id))
const kindCounts = computed(() => {
  const out: Record<ModelKind, number> = { image: 0, video: 0, chat: 0 }
  for (const m of providerModels.value) out[m.kind]++
  return out
})
const bySort = (a: AdminModel, b: AdminModel) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
const groups = computed(() => KINDS
  .map(kind => ({ kind, models: providerModels.value.filter(m => m.kind === kind && visible(m)).sort(bySort) }))
  .filter(g => g.models.length))
const shownCount = computed(() => groups.value.reduce((n, g) => n + g.models.length, 0))

// ---- 一行里的操作 ----
const busy = ref('')
const editing = ref<AdminModel | null>(null)
const renaming = ref<AdminModel | null>(null)

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

async function savePricing(pricing: ModelPricing | null) {
  const m = editing.value
  if (!m) return
  if (await patch(m, { pricing })) {
    editing.value = null
    MessagePlugin.success(t('common.saved'))
  }
}

async function saveRename(data: { label?: string; sort?: number }) {
  const m = renaming.value
  if (!m) return
  if (await patch(m, data)) {
    renaming.value = null
    MessagePlugin.success(t('common.saved'))
  }
}

function menuOf(m: AdminModel): RowMenuItem[] {
  const items: RowMenuItem[] = [{ key: 'rename', label: t('modelsPage.row.rename'), icon: 'edit' }]
  if (m.custom && current.value && vendorOf(current.value)) {
    items.push(
      { key: 'edit-custom', label: t('modelsPage.row.editCustom'), icon: 'tool' },
      { key: 'delete-custom', label: t('modelsPage.row.deleteCustom'), icon: 'trash', danger: true },
    )
  }
  return items
}

function onMenu(m: AdminModel, key: string) {
  if (key === 'rename') renaming.value = m
  else if (key === 'edit-custom') openEditCustom(m)
  else if (key === 'delete-custom') openRemove(m)
}

// ---- 自定义模型 ----
const customDialog = ref<{ provider: ProviderInstance; vendor: Vendor; existing: CustomModel | null } | null>(null)
const removing = ref<{ provider: ProviderInstance; model: AdminModel } | null>(null)
const deleting = ref(false)

const canAddCustom = computed(() => {
  const v = current.value && vendorOf(current.value)
  return !!v && v.customKinds.length > 0
})

function openAddCustom() {
  const provider = current.value
  const vendor = provider && vendorOf(provider)
  if (provider && vendor) customDialog.value = { provider, vendor, existing: null }
}

function openEditCustom(m: AdminModel) {
  const provider = providers.value.find(p => p.id === m.providerId)
  const vendor = provider && vendorOf(provider)
  if (!provider || !vendor) return
  const name = upstreamName(m)
  const saved = provider.customModels.find(c => c.model === name)
  customDialog.value = { provider, vendor, existing: saved || { model: name, kind: m.kind, label: '' } }
}

function openRemove(m: AdminModel) {
  const provider = providers.value.find(p => p.id === m.providerId)
  if (provider) removing.value = { provider, model: m }
}

function cancelRemove() {
  if (!deleting.value) removing.value = null
}

/**
 * 自定义模型变了：这一页和画布用的模型清单都重新取。
 * 新加的、或者改完之后不符合当前筛选的那一个留在列表里（见文件头）。
 */
async function refreshAfterCustom(touched?: string) {
  const before = new Set(models.value.map(m => m.id))
  await fetchAll().catch(() => undefined)
  loadModels().catch(() => undefined)
  for (const m of models.value) {
    if (before.has(m.id) && m.id !== touched) continue
    if (!matches(m)) keep(m.id)
  }
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
.mp-head { min-width: 0; flex: 1 1 320px; }

/* ---- 两列 ---- */
.mm { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 24px; margin-top: 24px; align-items: start; }
.mm-side, .mm-provs { display: grid; gap: 16px; min-width: 0; }

/* ---- 服务商卡片 ---- */
.pc { padding: 16px; display: grid; gap: 12px; min-width: 0; cursor: pointer; transition: border-color .15s; }
.pc:hover:not(.sel) { border-color: var(--line-2); }
.pc.sel { box-shadow: var(--glow-s), var(--sh-1); cursor: default; }
.pc.idle { cursor: default; }
.pc-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pi {
  width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; flex: none;
  font: 600 15px var(--f-disp); color: var(--text);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .25), rgb(var(--c-violet) / .3));
  box-shadow: 0 0 0 1px var(--line-3) inset;
}
.pc-tt { min-width: 0; flex: 1; }
.pc-name-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pc h3 { font: 600 15px/1.4 var(--f-disp); color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-name {
  display: block; max-width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 4px;
}
.pc-name-row .lc-bd { flex: none; }
.pc-sub {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
  font-size: 12px; line-height: 1.5; color: var(--text-3);
}
.pc dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 13px; }
.pc dt { color: var(--text-3); white-space: nowrap; }
.pc dd { margin: 0; text-align: right; color: var(--text-2); min-width: 0; }
.pc dd .lc-st { justify-content: flex-end; }
.key-tail { font-size: 12px; }
.pc-url { font-size: 12px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-msg { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; color: var(--err-soft); }
.pc-ops { display: flex; gap: 8px; }
.pc-ops .lc-btn { flex: 1; min-width: 0; }
.fill-key { border-color: var(--line-3); color: var(--cyan-soft); }
.spinning { animation: spin 1s linear infinite; }

.padd {
  min-height: 56px; padding: 10px 14px; border: 1px dashed var(--line-3); border-radius: var(--r-md); background: none;
  display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-2); font-size: 13px; line-height: 1.5; text-align: left;
  transition: border-color .15s, color .15s, background .15s;
}
.padd:hover:not(:disabled) { border-color: var(--cyan); color: var(--text); background: rgb(var(--c-cyan) / .05); }
.padd:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.padd:disabled { opacity: .45; cursor: not-allowed; }

.mm-about { padding: 16px; }
.mm-about b { font-weight: 600; color: var(--text); }
.about-ic { color: var(--cyan); }
.mm-about p { font-size: 13px; line-height: 1.7; margin-top: 8px; color: var(--text-2); }

/* ---- 模型面板 ---- */
.mpanel { overflow: hidden; min-width: 0; }
.mp-top { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 20px 20px 16px; }
.mp-tt { min-width: 0; flex: 1 1 200px; }
.mp-tt h2 { font: 600 17px/1.4 var(--f-disp); color: var(--text); overflow-wrap: anywhere; }
.mp-counts { display: block; font-size: 12px; color: var(--text-3); }
.mp-top .lc-sp { flex: 0 1 0; }
.mp-alert { margin: 0 20px 16px; }
.mp-fbar { padding: 0 20px 16px; }
.f-select { flex: none; width: 116px; }
.mp-fbar .f-search { flex: 1 1 140px; }
.f-search input::-webkit-search-cancel-button { cursor: pointer; filter: var(--native-invert); }

/* 五列固定宽度：各组之间的行才能纵向对齐 */
.mcols, .mrow {
  display: grid; grid-template-columns: 36px 200px minmax(0, 1fr) 128px 104px; gap: 16px; align-items: center; padding: 0 20px;
}
.mcols { height: 36px; font-size: 12px; color: var(--text-3); border-top: 1px solid var(--line); background: rgb(var(--c-well) / .35); }
.c-act-h { text-align: right; }
.mgrp { height: 40px; padding: 0 20px; border-top: 1px solid var(--line); background: rgb(var(--c-film) / .05); display: flex; align-items: center; }
.mgrp-in { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-3); }
.mrow { min-height: 60px; padding-top: 8px; padding-bottom: 8px; border-top: 1px solid var(--line); transition: background .12s; }
.mrow:hover { background: rgb(var(--c-film) / .035); }
.c-sw { display: flex; }
.c-name { min-width: 0; }
.c-name b { display: block; font-weight: 600; font-size: 14px; line-height: 1.3; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c-name small { display: block; font: 12px/1.3 var(--f-mono); color: var(--text-3); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c-caps { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.kept-tag { cursor: help; }
.c-price { font-size: 13px; line-height: 1.45; color: var(--text-2); min-width: 0; font-variant-numeric: tabular-nums; }
.price-part { display: block; overflow-wrap: anywhere; }
.c-act { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.mrow.off .c-name b, .mrow.off .c-caps, .mrow.off .c-price { opacity: .5; }
.mp-none { border-top: 1px solid var(--line); }
.mp-none p { margin-bottom: 12px; }
.mp-none p:last-child { margin-bottom: 0; }

/* ---- 整页状态 ---- */
.mp-state {
  margin: 24px auto 0; max-width: 560px; padding: 40px 28px;
  display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
}
.mp-state-ic.err { color: var(--err); }
.mp-state-title { font: 600 17px/1.4 var(--f-disp); color: var(--text); }
.mp-state-text { font-size: 13px; line-height: 1.7; color: var(--text-2); max-width: 420px; overflow-wrap: anywhere; }
.mp-state .lc-btn { margin-top: 10px; }
.mp-empty { margin-top: 40px; box-shadow: var(--sh-1); }
.mp-empty-ic {
  width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; color: var(--cyan); margin-bottom: 6px;
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .2), rgb(var(--c-violet) / .26)); box-shadow: 0 0 0 1px var(--line-3) inset;
}
.mp-empty-about { max-width: 560px; margin: 16px auto 0; }

/* ---- 骨架 ---- */
.sk { display: block; border-radius: 6px; background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }
.sk-card { cursor: default; }
.sk-pi { width: 40px; height: 40px; border-radius: 11px; flex: none; }
.sk-lines { display: grid; gap: 8px; min-width: 0; }
.sk-bar { padding: 0 20px 16px; }
.sk-row { display: flex; align-items: center; gap: 16px; height: 60px; padding: 0 20px; border-top: 1px solid var(--line); }
.sk-row .sk-lines { width: 200px; flex: none; }
.sk-grow { flex: 1; max-width: 240px; }

.confirm { width: 420px; }
.confirm p { line-height: 1.7; color: var(--text-2); }

/* ---- 窄一些：两列叠起来，服务商变成一条横向滑动的卡片 ---- */
@media (max-width: 1100px) {
  .mm { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .mm-side { display: contents; }
  .mm-provs {
    display: flex; gap: 12px; overflow-x: auto; align-items: stretch;
    /* 选中卡片的描边和外发光要露出来，所以留出一圈再用负边距收回去 */
    margin: -8px -8px -4px; padding: 8px 8px 12px; scroll-snap-type: x proximity; scroll-padding: 8px;
  }
  .mm-provs > .pc { flex: 0 0 min(300px, 82%); scroll-snap-align: start; align-content: start; }
  .mm-provs > .padd { flex: 0 0 200px; flex-direction: column; text-align: center; }
  .mm-about { order: 3; }
}

/* ---- 手机：一行两段 —— 开关 + 名称 + 价格 / 操作，能力标签折到下面 ---- */
@media (max-width: 720px) {
  .mp-top { padding: 16px 14px 14px; }
  .mp-top .lc-btn.primary { width: 100%; }
  .mp-alert { margin: 0 14px 14px; }
  .mp-fbar { padding: 0 14px 14px; }
  .mp-fbar .lc-seg { width: 100%; }
  .mp-fbar .lc-seg > button { flex: 1; justify-content: center; }
  .f-select { flex: 1 1 0; width: auto; min-width: 0; }
  .f-select :deep(.lcs-trigger) { padding: 0 8px; gap: 4px; font-size: 12px; }
  .mp-fbar .f-search { flex: 1 1 100%; }
  .mcols { display: none; }
  .mgrp { padding: 0 14px; }
  .mrow {
    grid-template-columns: 36px minmax(0, 1fr) auto;
    grid-template-areas:
      'sw name price'
      'sw name act'
      '. caps caps';
    gap: 4px 12px; padding: 12px 14px;
  }
  .c-sw { grid-area: sw; align-self: start; padding-top: 6px; }
  .c-name { grid-area: name; align-self: center; }
  .c-name b, .c-name small { white-space: normal; overflow-wrap: anywhere; }
  .c-price { grid-area: price; text-align: right; font-size: 12px; max-width: 150px; justify-self: end; }
  .c-price .lc-unk { font-size: 12px; }
  .c-act { grid-area: act; }
  .c-caps { grid-area: caps; margin-top: 4px; }
  .sk-row .sk-lines { width: auto; flex: 1; }
  .sk-grow { display: none; }
  .mp-state { padding: 32px 18px; }
}
</style>
