<template>
  <Teleport :to="$lcPortal">
    <div v-if="modelValue" class="lc-mask lc-sheet tt-mask" @click.self="close">
      <div v-dialog="close" class="lc-dialog tt-dialog" role="dialog" aria-modal="true" :aria-label="t('library.text.title')">
        <div class="lc-dialog-head">
          <span>{{ t('library.text.title') }}</span>
          <button class="lc-x" :aria-label="t('common.close')" @click="close">×</button>
        </div>
        <div class="tt-tools">
          <label class="lc-inp sm tt-search">
            <LcIcon name="search" size="s" />
            <input v-model="searchText" :placeholder="t('library.text.search')" :aria-label="t('library.text.search')" />
          </label>
          <!-- 素材语言切换：默认跟界面语言 -->
          <div class="lc-seg">
            <button type="button" :class="{ on: lang === 'zh' }" @click="switchLang('zh')">{{ t('library.text.langZh') }}</button>
            <button type="button" :class="{ on: lang === 'en' }" @click="switchLang('en')">{{ t('library.text.langEn') }}</button>
          </div>
          <span class="lc-sp" />
          <!-- 把自己常用的一段话存成片段；后端不支持保存（自己写的适配器）时不给入口 -->
          <button v-if="canSave" class="lc-btn sm" type="button" data-testid="tt-new" @click="openForm"><LcIcon name="plus" size="s" />{{ t('library.saved.newSnippet') }}</button>
        </div>

        <!-- category chips：「我保存的 / 团队保存的」排在「全部」后面，其余是内置片段的分类 -->
        <div v-if="categories.length" class="tt-catbar">
          <button
            v-for="c in categories"
            :key="c"
            type="button"
            :class="['tt-cat', { on: activeCat === c, saved: c === SAVED }]"
            :data-cat="c"
            @click="activeCat = c"
          >{{ catLabel(c) }}<span v-if="c === SAVED" class="n">{{ savedCount }}</span></button>
        </div>

        <!-- body -->
        <div class="tt-body">
          <div v-if="loading && !list.length" class="tt-empty">{{ t('common.loading') }}</div>
          <div v-else-if="loadFailed && !list.length" class="tt-empty" role="alert">
            <LcIcon name="warn" size="xl" />
            <div>{{ loadFailed }}</div>
            <button class="lc-btn sm" type="button" @click="load(lang)">{{ t('common.retry') }}</button>
          </div>
          <div v-else-if="!filteredList.length" class="tt-empty">
            <LcIcon name="book" size="xl" />
            <template v-if="activeCat === SAVED && !searchText.trim()">
              <div>{{ inTeam ? t('library.saved.emptySnippetsTeam') : t('library.saved.emptySnippets') }}</div>
              <button v-if="canSave" class="lc-btn sm" type="button" @click="openForm">{{ t('library.saved.newSnippet') }}</button>
            </template>
            <div v-else>{{ t('library.text.empty') }}</div>
          </div>
          <div v-else class="tt-grid">
            <div v-for="item in filteredList" :key="item.id" class="lc-card tt-card" :class="{ own: item.builtin === false }" :data-snippet="item.id">
              <button class="tt-card-main" type="button" @click="pick(item)">
                <!-- 标题自己占一行（最多两行）：不和标签抢地方 -->
                <span class="tt-card-title" v-tip="{ text: item.title, clipped: true }">{{ item.title }}</span>
                <span v-if="item.builtin === false || item.category" class="tt-card-head">
                  <span v-if="item.builtin === false" class="lc-tag accent tt-card-cat">{{ savedLabel }}</span>
                  <span v-if="item.category" class="lc-chip tt-card-cat">{{ item.category }}</span>
                  <span v-if="savedByText(item, inTeam)" class="tt-card-by" data-role="author" v-tip="{ text: savedByText(item, inTeam), clipped: true }">{{ savedByText(item, inTeam) }}</span>
                </span>
                <span class="tt-card-content">{{ item.content }}</span>
                <span class="tt-card-hover">
                  <span class="lc-btn sm primary quiet">{{ t('library.text.fill') }}</span>
                </span>
              </button>
              <button
                v-if="item.canDelete" class="lc-tb sm tt-card-del" type="button" data-act="delete"
                v-tip="t('common.delete')" :aria-label="t('library.saved.removeNamed', { name: item.title })" @click="removing = item"
              ><LcIcon name="trash" size="s" /></button>
            </div>
          </div>
        </div>
      </div>

      <!-- 新建片段 -->
      <div v-if="formOpen" class="lc-mask tt-sub" @click.self="closeForm">
        <form v-dialog="{ onEscape: closeForm, busy: saving }" class="lc-dialog tt-form" role="dialog" aria-modal="true" :aria-label="t('library.saved.newSnippet')" data-testid="tt-form" @submit.prevent="save">
          <div class="lc-dialog-head"><span>{{ t('library.saved.newSnippet') }}</span><button class="lc-x" type="button" :aria-label="t('common.close')" :disabled="saving" @click="closeForm">×</button></div>
          <div class="lc-dialog-body">
            <p class="tt-form-note">{{ inTeam ? t('library.saved.snippetNoteTeam') : t('library.saved.snippetNote') }}</p>
            <div class="lc-field">
              <label for="tt-f-title">{{ t('library.saved.title') }}<span class="lc-required">*</span></label>
              <input id="tt-f-title" ref="titleInput" v-model="form.title" class="lc-input" maxlength="80" autocomplete="off" :placeholder="t('library.saved.snippetTitlePlaceholder')" :disabled="saving" />
            </div>
            <div class="lc-field">
              <label for="tt-f-content">{{ t('library.saved.content') }}<span class="lc-required">*</span></label>
              <textarea id="tt-f-content" v-model="form.content" class="lc-textarea tt-form-ta" rows="6" maxlength="5000" :placeholder="t('library.saved.contentPlaceholder')" :disabled="saving"></textarea>
            </div>
            <div class="lc-field tt-form-last">
              <label for="tt-f-cat">{{ t('library.saved.category') }}</label>
              <input id="tt-f-cat" v-model="form.category" class="lc-input" maxlength="40" autocomplete="off" :placeholder="t('library.saved.categoryPlaceholder')" :disabled="saving" />
              <span class="lc-help">{{ t('library.saved.langNote', { lang: lang === 'zh' ? t('library.text.langZh') : t('library.text.langEn') }) }}</span>
            </div>
            <p v-if="formError" class="lc-error-text tt-form-err" role="alert">{{ formError }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" :disabled="saving" @click="closeForm">{{ t('common.cancel') }}</button>
            <button class="lc-btn primary quiet" type="submit" :disabled="saving || !form.title.trim() || !form.content.trim()" data-testid="tt-save">{{ saving ? t('common.saving') : t('common.save') }}</button>
          </div>
        </form>
      </div>

      <!-- 删除确认 -->
      <div v-if="removing" class="lc-mask tt-sub" @click.self="cancelRemove">
        <div v-dialog="{ onEscape: cancelRemove, busy: removeBusy }" class="lc-dialog tt-confirm" role="alertdialog" aria-modal="true" :aria-label="t('library.saved.removeSnippetTitle')">
          <div class="lc-dialog-head"><span>{{ t('library.saved.removeSnippetTitle') }}</span><button class="lc-x" type="button" :aria-label="t('common.close')" :disabled="removeBusy" @click="cancelRemove">×</button></div>
          <div class="lc-dialog-body">
            <p class="tt-confirm-text">{{ t('library.saved.removeConfirm', { name: removing.title }) }}</p>
            <p v-if="inTeam" class="tt-confirm-text dim">{{ t('library.saved.removeTeamHint') }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" :disabled="removeBusy" @click="cancelRemove">{{ t('common.cancel') }}</button>
            <button class="lc-btn danger" type="button" :disabled="removeBusy" data-testid="tt-remove-ok" @click="confirmRemove">{{ t('common.delete') }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 文本素材（提示词片段）：内置的那批，加上这个空间里存下来的。
 * 存下来的可以自己删；在团队里是全队共用的，大家都能存，自己存的自己能删，团长和管理员能删任何人的
 * （都由接口给的 canDelete 说了算）。后端不支持保存时（自己写的适配器没给那两个方法）只有内置的，和以前一样。
 */
import { vDialog } from '@/directives/dialog'
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { MessagePlugin } from '@/utils/feedback'
import { canvasTextTemplateApi, canSaveTextTemplates, apiErrorMessage, apiErrorCode } from '@/utils/canvasBackend'
import { useEmbed } from '@/embed/context'
import { useSpaceStore } from '@/stores/space'
import { savedByText } from '@/utils/person'
import type { Person } from '@/types'

export interface TextTplItem {
  id: string; title: string; content: string; category: string; lang?: string
  /** false = 这个空间里存的；内置的为 true（老后端不给这一项，按内置算） */
  builtin?: boolean
  /** 调用者能不能删 */
  canDelete?: boolean
  /** 谁存的（内置的为 null）；mine = 就是调用者 */
  createdBy?: Person | null
  mine?: boolean
  createdAt?: string | null
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'pick', content: string): void
}>()

const { t, locale } = useI18n()

const ALL = '__all__'
/** 「我保存的 / 团队保存的」这一格 */
const SAVED = '__saved__'

/** 只嵌编辑器时没有空间这回事（由适配器定），叫法按个人的来 */
const spaceIsTeam = useEmbed().mode === 'editor' ? () => false : (() => { const s = useSpaceStore(); return () => s.isTeam })()
const inTeam = computed(() => spaceIsTeam())
const savedLabel = computed(() => (inTeam.value ? t('library.saved.team') : t('library.saved.mine')))
const canSave = computed(() => canSaveTextTemplates())

// 素材语言默认跟界面语言走，可手动切换
const lang = ref<'zh' | 'en'>(locale.value.startsWith('zh') ? 'zh' : 'en')
const searchText = ref('')
const activeCat = ref(ALL)

// 按语言留一份：再打开时先显示上次的，同时重取（团队里别人可能刚存了、刚删了）
const cache: Record<string, TextTplItem[]> = {}
const list = ref<TextTplItem[]>([])
const loading = ref(false)
const loadFailed = ref('')
let loadSeq = 0

async function load(l: 'zh' | 'en') {
  const seq = ++loadSeq
  list.value = cache[l] || []
  loading.value = true
  loadFailed.value = ''
  try {
    const res = await canvasTextTemplateApi.list(l)
    const data: TextTplItem[] = res.data.result === 0 ? (res.data.data || []) : []
    cache[l] = data
    if (seq === loadSeq) list.value = data
  } catch (err) {
    if (seq === loadSeq && !cache[l]) loadFailed.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

const savedCount = computed(() => list.value.filter((it) => it.builtin === false).length)
const categories = computed(() => {
  const set = new Set<string>()
  for (const it of list.value) if (it.category) set.add(it.category)
  if (!list.value.length && !canSave.value) return []
  // 能保存、或者已经有存下来的：给「保存的」单独一格，哪怕还是空的（空的那一格里说明怎么存）
  const saved = canSave.value || savedCount.value ? [SAVED] : []
  return [ALL, ...saved, ...Array.from(set)]
})
const catLabel = (c: string) => (c === ALL ? t('common.all') : c === SAVED ? savedLabel.value : c)

const filteredList = computed(() => {
  const kw = searchText.value.trim().toLowerCase()
  return list.value.filter((it) => {
    if (activeCat.value === SAVED) { if (it.builtin !== false) return false }
    else if (activeCat.value !== ALL && it.category !== activeCat.value) return false
    if (kw && !(it.title.toLowerCase().includes(kw) || it.content.toLowerCase().includes(kw))) return false
    return true
  })
})

function switchLang(l: 'zh' | 'en') {
  if (lang.value === l) return
  lang.value = l
  if (activeCat.value !== SAVED) activeCat.value = ALL
  load(l)
}

function pick(item: TextTplItem) {
  emit('pick', item.content)
  close()
}

function close() {
  if (saving.value || removeBusy.value) return
  emit('update:modelValue', false)
}

// ---- 新建片段 ----
const formOpen = ref(false)
const form = ref({ title: '', content: '', category: '' })
const formError = ref('')
const saving = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)

function openForm() {
  form.value = { title: '', content: '', category: '' }
  formError.value = ''
  formOpen.value = true
  void nextTick(() => titleInput.value?.focus())
}
function closeForm() { if (!saving.value) formOpen.value = false }

async function save() {
  if (saving.value || !form.value.title.trim() || !form.value.content.trim()) return
  const l = lang.value
  saving.value = true
  formError.value = ''
  try {
    const res = await canvasTextTemplateApi.create({
      title: form.value.title.trim(), content: form.value.content, category: form.value.category.trim() || undefined, lang: l,
    })
    if (res.data.result !== 0 || !res.data.data) throw new Error(res.data.message || t('library.saved.saveFailed'))
    const item = { builtin: false, canDelete: true, mine: true, ...(res.data.data as TextTplItem) }
    cache[l] = [...(cache[l] || []), item]
    if (lang.value === l) list.value = cache[l]
    formOpen.value = false
    searchText.value = ''
    activeCat.value = SAVED
    MessagePlugin.success(t('library.saved.snippetSaved'))
  } catch (err) {
    // 存满了（template.max）、没填全：服务端的话留在表单里，人还能改
    formError.value = apiErrorMessage(err, t('library.saved.saveFailed'))
  } finally {
    saving.value = false
  }
}

// ---- 删除 ----
const removing = ref<TextTplItem | null>(null)
const removeBusy = ref(false)
function cancelRemove() { if (!removeBusy.value) removing.value = null }
async function confirmRemove() {
  const item = removing.value
  if (!item || removeBusy.value) return
  const l = lang.value
  removeBusy.value = true
  try {
    const res = await canvasTextTemplateApi.remove(item.id)
    if (res.data.result !== 0) throw new Error(res.data.message || t('library.saved.removeFailed'))
    cache[l] = (cache[l] || []).filter((x) => x.id !== item.id)
    if (lang.value === l) list.value = cache[l]
    removing.value = null
    MessagePlugin.success(t('library.myAsset.removed'))
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('library.saved.removeFailed')))
    // 不是自己的（角色刚变了），或者别人已经删了：重取一遍，按钮跟上现在的样子
    const code = apiErrorCode(err)
    if (code === 'team.forbidden' || code === 'template.not_found') { removing.value = null; void load(l) }
  } finally {
    removeBusy.value = false
  }
}


watch(() => props.modelValue, (open) => {
  if (open) {
    searchText.value = ''
    activeCat.value = ALL
    formOpen.value = false
    removing.value = null
    load(lang.value)
  }
}, { immediate: true })
</script>

<style scoped>
.tt-mask { z-index: 9000; }
.tt-dialog { width: min(1120px, 100%); height: min(760px, calc(calc(100 * var(--lc-vh)) - 40px)); }
.tt-tools { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 20px 0; flex-wrap: wrap; }
.tt-search { flex: 1 1 200px; max-width: 320px; }

/* 分类：一排可换行的小块，选中的蓝底 */
.tt-catbar {
  flex: none; display: flex; gap: 6px; flex-wrap: wrap;
  padding: 12px 20px; border-bottom: 1px solid var(--line);
  max-height: 108px; overflow-y: auto;
}
.tt-cat {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  height: 28px; padding: 0 12px; border: 1px solid var(--line); background: var(--well);
  color: var(--text-2); border-radius: 8px; cursor: pointer; font-size: 13px; white-space: nowrap;
  transition: background-color .15s, color .15s, border-color .15s;
}
.tt-cat:hover { color: var(--text); border-color: var(--line-3); }
.tt-cat:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.tt-cat.on { background: rgb(var(--c-blue) / .28); color: var(--text); border-color: var(--line-3); }
.tt-cat.saved { border-color: rgb(var(--c-cyan) / .4); }
.tt-cat .n { font: 500 11px var(--f-mono); color: var(--text-3); }

.tt-body { flex: 1; min-height: 0; padding: 16px 20px 20px; overflow-y: auto; }
.tt-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 13px; line-height: 1.7; text-align: center; min-height: 280px;
}
.tt-empty > div { max-width: 460px; }
.tt-empty > svg { width: 40px; height: 40px; color: rgb(var(--c-film) / .4); }

.tt-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.tt-card { position: relative; overflow: hidden; min-height: 132px; display: flex; transition: border-color .15s; }
.tt-card:hover, .tt-card:focus-within { border-color: rgb(var(--c-cyan) / .55); }
.tt-card:hover .tt-card-hover, .tt-card-main:focus-visible .tt-card-hover { opacity: 1; }
/* 整张卡是一个按钮（键盘能到）；删除是另一个按钮，叠在右下角 */
.tt-card-main {
  flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 12px 14px; text-align: left;
  border: 0; background: none; color: inherit; font: inherit; cursor: pointer;
}
.tt-card-main:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }
.tt-card-title {
  font-size: 14px; font-weight: 600; line-height: 1.45; color: var(--text); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 6px;
}
.tt-card-head { display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; margin-bottom: 8px; min-width: 0; }
.tt-card-cat { flex: 0 1 auto; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tt-card-by { flex: 0 1 auto; min-width: 0; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tt-card-content {
  font-size: 12px; line-height: 1.6; color: var(--text-2);
  overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  white-space: pre-wrap; word-break: break-word;
}
.tt-card-hover {
  position: absolute; inset: 0;
  display: flex; align-items: flex-end; justify-content: center;
  padding-bottom: 12px;
  background: linear-gradient(to top, rgb(var(--c-glass) / .96) 30%, rgb(var(--c-glass) / 0) 100%);
  opacity: 0; transition: opacity .18s;
}
.tt-card-del { position: absolute; right: 8px; bottom: 8px; opacity: 0; transition: opacity .15s, color .15s; }
.tt-card:hover .tt-card-del, .tt-card:focus-within .tt-card-del { opacity: 1; }
.tt-card-del:hover:not(:disabled) { color: var(--err-soft); background: rgb(var(--c-err) / .12); }

/* 叠在上面的两个小弹窗 */
.tt-sub { z-index: 9100; }
.tt-form { width: 520px; }
.tt-form-note { margin: 0 0 16px; font-size: 13px; line-height: 1.7; color: var(--text-2); }
.tt-form-ta { display: block; width: 100%; min-height: 132px; }
.tt-form-last { margin-bottom: 0; }
.tt-form-err { margin: 12px 0 0; }
.tt-confirm { width: 420px; }
.tt-confirm-text { margin: 0; font-size: 14px; line-height: 1.7; color: var(--text-2); overflow-wrap: anywhere; }
.tt-confirm-text.dim { margin-top: 8px; font-size: 13px; color: var(--text-3); }

@media (max-width: 600px) {
  .tt-dialog { height: calc(92 * var(--lc-vh)); height: calc(92 * var(--lc-dvh)); }
  .tt-tools { padding: 12px 16px 0; }
  .tt-search { max-width: none; flex-basis: 100%; }
  .tt-catbar { padding: 12px 16px; flex-wrap: nowrap; overflow-x: auto; }
  .tt-body { padding: 12px 16px 16px; }
  .tt-grid { grid-template-columns: 1fr; }
  /* 触屏没有悬停：删除直接露出来 */
  .tt-card-del { opacity: 1; }
}
</style>
