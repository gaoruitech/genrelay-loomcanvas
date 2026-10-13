<template>
  <div v-if="modelValue" class="lc-mask lc-sheet tpl-mask" @click.self="close">
    <div v-dialog="close" class="lc-dialog tpl-dialog" role="dialog" aria-modal="true" :aria-label="t('library.template.title')">
      <div class="lc-dialog-head">
        <span>{{ t('library.template.title') }}</span>
        <button class="lc-x" :aria-label="t('common.close')" @click="close">×</button>
      </div>

      <!-- 来源筛选 + 把当前画布存成模板（编辑器传了 currentGraph、后端也支持保存时才有） -->
      <div v-if="savedCount || canSaveCurrent" class="tpl-tools">
        <div class="lc-seg" role="group" :aria-label="t('library.saved.source')">
          <button type="button" :class="{ on: source === 'all' }" @click="source = 'all'">{{ t('common.all') }}<span class="n">{{ templates.length }}</span></button>
          <button type="button" :class="{ on: source === 'saved' }" data-src="saved" @click="source = 'saved'">{{ savedLabel }}<span class="n">{{ savedCount }}</span></button>
          <button type="button" :class="{ on: source === 'builtin' }" @click="source = 'builtin'">{{ t('library.saved.builtin') }}<span class="n">{{ templates.length - savedCount }}</span></button>
        </div>
        <span class="lc-sp" />
        <button v-if="canSaveCurrent" class="lc-btn sm" type="button" data-testid="tpl-save-current" @click="openForm"><LcIcon name="plus" size="s" />{{ t('library.saved.saveCurrent') }}</button>
      </div>

      <!-- 内容：模板卡片网格 -->
      <div class="tpl-body">
        <div v-if="shown.length" class="tpl-grid">
          <div v-for="tpl in shown" :key="tpl.key" class="lc-card tpl-card" :data-tpl="tpl.key">
            <button class="tpl-main" type="button" @click="apply(tpl)">
              <span class="tpl-thumb">
                <img loading="lazy" v-if="tpl.cover" :src="ensureHttps(tpl.cover)" alt="" />
                <span v-else class="tpl-thumb-empty"><LcIcon name="canvas" size="xl" /></span>
                <span class="tpl-use"><span class="lc-btn sm primary quiet">{{ t('library.useTemplate') }}</span></span>
                <!-- 这个空间里存的：标出来，和内置的分得开 -->
                <span v-if="tpl.builtin === false" class="lc-bd tpl-own">{{ savedLabel }}</span>
              </span>
              <span class="tpl-meta">
                <span class="tpl-name" v-tip="{ text: tpl.title, clipped: true }">{{ tpl.title }}</span>
                <span v-if="tpl.description" class="tpl-sub" v-tip="{ text: tpl.description, clipped: true }">{{ tpl.description }}</span>
                <span v-if="savedByText(tpl, inTeam)" class="tpl-by" data-role="author" v-tip="{ text: savedByText(tpl, inTeam), clipped: true }">{{ savedByText(tpl, inTeam) }}</span>
              </span>
            </button>
            <button
              v-if="tpl.canDelete" class="tpl-del" type="button" data-act="delete"
              v-tip="t('common.delete')" :aria-label="t('library.saved.removeNamed', { name: tpl.title })" @click="removing = tpl"
            ><LcIcon name="trash" size="s" /></button>
          </div>
        </div>

        <div v-else-if="loadFailed" class="tpl-empty" role="alert">
          <LcIcon name="warn" size="xl" />
          <span>{{ loadFailed }}</span>
          <button class="lc-btn sm" type="button" @click="loadTemplates">{{ t('common.retry') }}</button>
        </div>
        <div v-else class="tpl-empty">
          <LcIcon name="canvas" size="xl" />
          <span v-if="loading">{{ t('common.loading') }}</span>
          <template v-else-if="source === 'saved'">
            <span>{{ canSaveCurrent ? (inTeam ? t('library.saved.emptyTemplatesTeam') : t('library.saved.emptyTemplates')) : t('library.saved.emptyTemplatesNoSave') }}</span>
            <button v-if="canSaveCurrent" class="lc-btn sm" type="button" @click="openForm">{{ t('library.saved.saveCurrent') }}</button>
          </template>
          <span v-else>{{ t('library.template.empty') }}</span>
        </div>
      </div>
    </div>

    <!-- 把当前画布存为模板 -->
    <div v-if="formOpen" class="lc-mask tpl-over" @click.self="closeForm">
      <form v-dialog="{ onEscape: closeForm, busy: saving }" class="lc-dialog tpl-form" role="dialog" aria-modal="true" :aria-label="t('library.saved.saveCurrent')" data-testid="tpl-form" @submit.prevent="save">
        <div class="lc-dialog-head"><span>{{ t('library.saved.saveCurrent') }}</span><button class="lc-x" type="button" :aria-label="t('common.close')" :disabled="saving" @click="closeForm">×</button></div>
        <div class="lc-dialog-body">
          <div class="tpl-form-top">
            <span class="tpl-form-cover">
              <img v-if="draft.cover" :src="ensureHttps(draft.cover)" alt="" />
              <LcIcon v-else name="canvas" size="l" />
            </span>
            <p class="tpl-form-note">
              {{ t('library.saved.templateWhat', { n: draft.nodes.length }) }}
              {{ inTeam ? t('library.saved.templateNoteTeam') : t('library.saved.templateNote') }}
            </p>
          </div>
          <div class="lc-field">
            <label for="tpl-f-title">{{ t('library.saved.title') }}<span class="lc-required">*</span></label>
            <input id="tpl-f-title" ref="titleInput" v-model="form.title" class="lc-input" maxlength="80" autocomplete="off" :placeholder="t('library.saved.templateTitlePlaceholder')" :disabled="saving" />
          </div>
          <div class="lc-field tpl-form-last">
            <label for="tpl-f-desc">{{ t('library.saved.description') }}</label>
            <textarea id="tpl-f-desc" v-model="form.description" class="lc-textarea tpl-form-ta" rows="3" maxlength="500" :placeholder="t('library.saved.descriptionPlaceholder')" :disabled="saving"></textarea>
          </div>
          <p v-if="formError" class="lc-error-text tpl-form-err" role="alert">{{ formError }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" :disabled="saving" @click="closeForm">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary quiet" type="submit" :disabled="saving || !form.title.trim()" data-testid="tpl-save">{{ saving ? t('common.saving') : t('common.save') }}</button>
        </div>
      </form>
    </div>

    <!-- 删除确认 -->
    <div v-if="removing" class="lc-mask tpl-over" @click.self="cancelRemove">
      <div v-dialog="{ onEscape: cancelRemove, busy: removeBusy }" class="lc-dialog tpl-confirm" role="alertdialog" aria-modal="true" :aria-label="t('library.saved.removeTemplateTitle')">
        <div class="lc-dialog-head"><span>{{ t('library.saved.removeTemplateTitle') }}</span><button class="lc-x" type="button" :aria-label="t('common.close')" :disabled="removeBusy" @click="cancelRemove">×</button></div>
        <div class="lc-dialog-body">
          <p class="tpl-confirm-text">{{ t('library.saved.removeConfirm', { name: removing.title }) }}</p>
          <p class="tpl-confirm-text dim">{{ inTeam ? t('library.saved.removeTemplateHintTeam') : t('library.saved.removeTemplateHint') }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" :disabled="removeBusy" @click="cancelRemove">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" type="button" :disabled="removeBusy" data-testid="tpl-remove-ok" @click="confirmRemove">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 画布模板：内置的那批，加上这个空间里存下来的（标着「我保存的 / 团队保存的」）。
 * 存下来的能不能删由接口给的 canDelete 说了算：自己存的能删，团队里团长和管理员能删任何人的。
 *
 * 「把当前画布存为模板」要用到编辑器里的节点图，由编辑器通过 currentGraph 这个属性给：
 * 不给这个属性（或后端不支持保存）时没有这个入口，其余照常。
 */
import { vDialog } from '@/directives/dialog'
import { ref, computed, watch, nextTick } from 'vue'
import { MessagePlugin } from '@/utils/feedback'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { canvasTemplateApi, canSaveTemplates, apiErrorMessage, apiErrorCode } from '@/utils/canvasBackend'
import { ensureHttps } from '@/utils/mediaUrl'
import { useEmbed } from '@/embed/context'
import { useSpaceStore } from '@/stores/space'
import { savedByText } from '@/utils/person'
import type { Person } from '@/types'

const { t } = useI18n()

export interface CanvasTemplateGraph {
  nodes: any[]
  edges: any[]
  viewport?: { x: number; y: number; zoom: number }
}
export interface CanvasTemplate {
  key: string
  title: string
  description?: string
  cover?: string
  graph: CanvasTemplateGraph
  /** false = 这个空间里存的；内置的为 true（老后端不给这一项，按内置算） */
  builtin?: boolean
  /** 调用者能不能删 */
  canDelete?: boolean
  /** 谁存的（内置的为 null）；mine = 就是调用者 */
  createdBy?: Person | null
  mine?: boolean
  createdAt?: string | null
}

const props = defineProps<{
  modelValue: boolean
  /**
   * 取当前画布的节点图（节点、连线、视口）。给了它、而且后端支持保存模板，才有「把当前画布存为模板」。
   * 画布是空的可以返回 null。
   */
  currentGraph?: () => { nodes: any[]; edges: any[]; viewport?: any } | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'apply', tpl: CanvasTemplate): void
  /** 存好了一个模板 */
  (e: 'saved', tpl: CanvasTemplate): void
}>()

/** 只嵌编辑器时没有空间这回事（由适配器定），叫法按个人的来 */
const spaceIsTeam = useEmbed().mode === 'editor' ? () => false : (() => { const s = useSpaceStore(); return () => s.isTeam })()
const inTeam = computed(() => spaceIsTeam())
const savedLabel = computed(() => (inTeam.value ? t('library.saved.team') : t('library.saved.mine')))
const canSaveCurrent = computed(() => typeof props.currentGraph === 'function' && canSaveTemplates())

const templates = ref<CanvasTemplate[]>([])
const loading = ref(false)
const loadFailed = ref('')

async function loadTemplates() {
  loading.value = true
  loadFailed.value = ''
  try {
    const res = await canvasTemplateApi.list()
    if (res.data.result === 0 && Array.isArray(res.data.data)) {
      templates.value = res.data.data
    }
  } catch (e: any) {
    const msg = apiErrorMessage(e, t('library.template.loadFailed'))
    if (templates.value.length) MessagePlugin.error(msg)
    else loadFailed.value = msg
  } finally {
    loading.value = false
  }
}

const source = ref<'all' | 'saved' | 'builtin'>('all')
const savedCount = computed(() => templates.value.filter((x) => x.builtin === false).length)
const shown = computed(() => {
  if (source.value === 'saved') return templates.value.filter((x) => x.builtin === false)
  if (source.value === 'builtin') return templates.value.filter((x) => x.builtin !== false)
  // 「全部」里存下来的排前面：那是这个空间自己的东西
  return [...templates.value.filter((x) => x.builtin === false), ...templates.value.filter((x) => x.builtin !== false)]
})

function apply(tpl: CanvasTemplate) {
  emit('apply', tpl)
  close()
}

function close() {
  if (saving.value || removeBusy.value) return
  emit('update:modelValue', false)
}

// ---- 把当前画布存为模板 ----
const IMAGE_COVER: [string, string][] = [
  ['output', 'imageUrl'], ['output', 'imageUrls'], ['image-gen', 'imageUrl'], ['image-gen', 'imageUrls'],
  ['image-edit', 'imageUrl'], ['image-edit', 'imageUrls'], ['image', 'imageUrl'], ['image-collection', 'imageUrls'],
]
const isMedia = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 2048 && (v.startsWith('/files/') || /^https?:\/\//i.test(v))
const firstString = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? (v.find((x) => typeof x === 'string' && x) as string) || '' : '')

/** 封面：节点图里找到的第一张图片结果；先找生成结果，再找上传的图。没有就不带封面 */
function coverOf(nodes: any[]): string {
  for (const [type, field] of IMAGE_COVER) {
    for (const n of nodes) {
      if (n?.type !== type) continue
      const url = firstString(n.data?.[field])
      if (isMedia(url)) return url
    }
  }
  for (const n of nodes) {
    for (const field of ['imageUrl', 'imageUrls']) {
      const url = firstString(n?.data?.[field])
      if (isMedia(url)) return url
    }
  }
  return ''
}

/**
 * 编辑器里的节点图 → 模板里存的那份：
 *  - 画框（frame）不存，框里的节点换成画布上的绝对位置（套用模板时是按绝对位置摆的）；
 *  - 只留 id / type / position / data，data 里跟这张画布绑定的东西（品牌包例外）去掉；
 *  - 连线只留两头都还在的。
 */
function toTemplateGraph(g: { nodes: any[]; edges: any[]; viewport?: any }) {
  const all = Array.isArray(g.nodes) ? g.nodes.filter((n) => n && typeof n === 'object' && n.id) : []
  const byId = new Map<string, any>(all.map((n) => [String(n.id), n]))
  const abs = (n: any) => {
    let x = Number(n.position?.x) || 0
    let y = Number(n.position?.y) || 0
    const seen = new Set<string>()
    let p = n.parentNode ? byId.get(String(n.parentNode)) : null
    while (p && !seen.has(String(p.id))) {
      seen.add(String(p.id))
      x += Number(p.position?.x) || 0
      y += Number(p.position?.y) || 0
      p = p.parentNode ? byId.get(String(p.parentNode)) : null
    }
    return { x: Math.round(x), y: Math.round(y) }
  }
  const nodes = all.filter((n) => n.type !== 'frame').map((n) => {
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(JSON.stringify(n.data || {})) } catch { /* 存不成 JSON 的东西不带 */ }
    delete data.brandKitOverride
    delete data.brandKitId
    return { id: String(n.id), type: String(n.type || ''), position: abs(n), data }
  })
  const ids = new Set(nodes.map((n) => n.id))
  const edges = (Array.isArray(g.edges) ? g.edges : [])
    .filter((e) => e && ids.has(String(e.source)) && ids.has(String(e.target)))
    .map((e) => ({
      id: String(e.id || `${e.source}-${e.target}`), source: String(e.source), target: String(e.target),
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}), ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    }))
  return { nodes, edges }
}

const formOpen = ref(false)
const form = ref({ title: '', description: '' })
const formError = ref('')
const saving = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)
/** 打开表单那一刻取的那份图：存的就是这一份 */
const draft = ref<{ nodes: any[]; edges: any[]; cover: string }>({ nodes: [], edges: [], cover: '' })

function openForm() {
  let g: { nodes: any[]; edges: any[]; viewport?: any } | null = null
  try { g = props.currentGraph?.() || null } catch { g = null }
  const out = g ? toTemplateGraph(g) : { nodes: [], edges: [] }
  if (!out.nodes.length) {
    MessagePlugin.warning(t('library.saved.canvasEmpty'))
    return
  }
  draft.value = { ...out, cover: coverOf(out.nodes) }
  form.value = { title: '', description: '' }
  formError.value = ''
  formOpen.value = true
  void nextTick(() => titleInput.value?.focus())
}
function closeForm() { if (!saving.value) formOpen.value = false }

async function save() {
  if (saving.value || !form.value.title.trim()) return
  saving.value = true
  formError.value = ''
  try {
    const res = await canvasTemplateApi.create({
      title: form.value.title.trim(),
      ...(form.value.description.trim() ? { description: form.value.description.trim() } : {}),
      ...(draft.value.cover ? { cover: draft.value.cover } : {}),
      graph: { nodes: draft.value.nodes, edges: draft.value.edges, viewport: { x: 0, y: 0, zoom: 1 } },
    })
    if (res.data.result !== 0 || !res.data.data) throw new Error(res.data.message || t('library.saved.saveFailed'))
    const tpl = { builtin: false, canDelete: true, mine: true, ...(res.data.data as CanvasTemplate) }
    templates.value = [...templates.value, tpl]
    formOpen.value = false
    source.value = 'saved'
    MessagePlugin.success(t('library.saved.templateSaved'))
    emit('saved', tpl)
  } catch (err) {
    // 存满了（template.max）、节点太多（canvas.max_nodes）：服务端的话留在表单里
    formError.value = apiErrorMessage(err, t('library.saved.saveFailed'))
  } finally {
    saving.value = false
  }
}

// ---- 删除 ----
const removing = ref<CanvasTemplate | null>(null)
const removeBusy = ref(false)
function cancelRemove() { if (!removeBusy.value) removing.value = null }
async function confirmRemove() {
  const tpl = removing.value
  if (!tpl || removeBusy.value) return
  removeBusy.value = true
  try {
    const res = await canvasTemplateApi.remove(tpl.key)
    if (res.data.result !== 0) throw new Error(res.data.message || t('library.saved.removeFailed'))
    templates.value = templates.value.filter((x) => x.key !== tpl.key)
    removing.value = null
    MessagePlugin.success(t('library.myAsset.removed'))
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('library.saved.removeFailed')))
    // 不是自己的（角色刚变了），或者别人已经删了：重取一遍，按钮跟上现在的样子
    const code = apiErrorCode(err)
    if (code === 'team.forbidden' || code === 'template.not_found') { removing.value = null; void loadTemplates() }
  } finally {
    removeBusy.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      source.value = 'all'
      formOpen.value = false
      removing.value = null
      loadTemplates()
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.tpl-mask { z-index: 9000; }
.tpl-dialog { width: min(1200px, 100%); height: min(780px, calc(calc(100 * var(--lc-vh)) - 40px)); }
.tpl-tools { flex: none; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 20px; border-bottom: 1px solid var(--line); }
.tpl-tools .lc-seg .n { font: 500 11px var(--f-mono); color: var(--text-3); }
.tpl-tools .lc-seg .on .n { color: var(--cyan-soft); }
.tpl-body { flex: 1; min-height: 0; padding: 20px; overflow-y: auto; }

.tpl-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.tpl-card { position: relative; overflow: hidden; transition: border-color .15s; }
.tpl-card:hover, .tpl-card:focus-within { border-color: rgb(var(--c-cyan) / .55); }
/* 整张卡是一个按钮（键盘能到）；删除是另一个按钮，叠在封面右上角 */
.tpl-main { display: block; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.tpl-main:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }
.tpl-thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  background: var(--media-bg);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.tpl-thumb img { width: 100%; height: 100%; object-fit: cover; }
.tpl-thumb-empty { color: rgb(var(--c-film) / .4); }
.tpl-thumb-empty svg { width: 36px; height: 36px; }
.tpl-use {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgb(var(--c-scrim) / .6);
  opacity: 0; transition: opacity .15s;
}
.tpl-card:hover .tpl-use, .tpl-main:focus-visible .tpl-use { opacity: 1; }
.tpl-own {
  position: absolute; top: 8px; left: 8px; color: var(--cyan-soft);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); background: rgb(var(--c-glass) / .8);
}
.tpl-del {
  position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 0;
  display: grid; place-items: center; border: 0; border-radius: 8px;
  background: rgb(var(--c-scrim) / .7); color: var(--on-scrim); cursor: pointer;
  opacity: 0; transition: opacity .15s ease, color .15s ease;
}
.tpl-card:hover .tpl-del, .tpl-card:focus-within .tpl-del { opacity: 1; }
/* 垫的是画面上的恒暗遮罩：悬停换危险色的实底、白字，不把字染成主题的红（浅色主题里那是深红压深底） */
.tpl-del:hover { background: var(--scrim-danger); color: var(--on-scrim-max); }
.tpl-del:focus-visible { outline: none; box-shadow: var(--ring); }
.tpl-meta { display: block; padding: 10px 12px 12px; }
.tpl-name { display: block; font-size: 14px; color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-by { display: block; margin-top: 4px; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-sub {
  display: block; margin-top: 2px; font-size: 12px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.tpl-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 13px; line-height: 1.7; text-align: center;
  min-height: 280px;
}
.tpl-empty > span { max-width: 460px; }
.tpl-empty > svg { width: 40px; height: 40px; color: rgb(var(--c-film) / .4); }

/* 叠在上面的两个小弹窗 */
.tpl-over { z-index: 9100; }
.tpl-form { width: 520px; }
.tpl-form-top { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 16px; }
.tpl-form-cover {
  flex: none; width: 96px; height: 72px; border-radius: 10px; overflow: hidden; display: grid; place-items: center;
  border: 1px solid var(--line); background: var(--media-bg); color: rgb(var(--c-film) / .4);
}
.tpl-form-cover img { width: 100%; height: 100%; object-fit: cover; }
.tpl-form-note { margin: 0; min-width: 0; font-size: 13px; line-height: 1.7; color: var(--text-2); }
.tpl-form-ta { display: block; width: 100%; }
.tpl-form-last { margin-bottom: 0; }
.tpl-form-err { margin: 12px 0 0; }
.tpl-confirm { width: 420px; }
.tpl-confirm-text { margin: 0; font-size: 14px; line-height: 1.7; color: var(--text-2); overflow-wrap: anywhere; }
.tpl-confirm-text.dim { margin-top: 8px; font-size: 13px; color: var(--text-3); }

@media (max-width: 600px) {
  .tpl-dialog { height: calc(92 * var(--lc-vh)); height: calc(92 * var(--lc-dvh)); }
  .tpl-tools { padding: 12px 16px; }
  .tpl-body { padding: 16px; }
  .tpl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  /* 触屏没有悬停：删除直接露出来 */
  .tpl-del { opacity: 1; }
}
</style>
