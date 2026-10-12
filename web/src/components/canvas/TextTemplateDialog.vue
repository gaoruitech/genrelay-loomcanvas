<template>
  <Teleport :to="$lcPortal">
    <div v-if="modelValue" class="lc-mask lc-sheet tt-mask" @click.self="close">
      <div class="lc-dialog tt-dialog">
        <div class="lc-dialog-head">
          <span>{{ t('library.text.title') }}</span>
          <button class="lc-x" :title="t('common.close')" @click="close">×</button>
        </div>
        <div class="tt-tools">
          <label class="lc-inp sm tt-search">
            <LcIcon name="search" size="s" />
            <input v-model="searchText" :placeholder="t('library.text.search')" />
          </label>
          <!-- 素材语言切换：默认跟界面语言 -->
          <div class="lc-seg">
            <button :class="{ on: lang === 'zh' }" @click="switchLang('zh')">{{ t('library.text.langZh') }}</button>
            <button :class="{ on: lang === 'en' }" @click="switchLang('en')">{{ t('library.text.langEn') }}</button>
          </div>
        </div>

        <!-- category chips -->
        <div v-if="categories.length" class="tt-catbar">
          <button
            v-for="c in categories"
            :key="c"
            :class="['tt-cat', { on: activeCat === c }]"
            @click="activeCat = c"
          >{{ c === '__all__' ? t('common.all') : c }}</button>
        </div>

        <!-- body -->
        <div class="tt-body">
          <div v-if="loading" class="tt-empty">{{ t('common.loading') }}</div>
          <div v-else-if="!filteredList.length" class="tt-empty">
            <LcIcon name="book" size="xl" />
            <div>{{ t('library.text.empty') }}</div>
          </div>
          <div v-else class="tt-grid">
            <div
              v-for="item in filteredList"
              :key="item.id"
              class="lc-card tt-card"
              @click="pick(item)"
            >
              <div class="tt-card-head">
                <span class="tt-card-title">{{ item.title }}</span>
                <span v-if="item.category" class="lc-chip tt-card-cat">{{ item.category }}</span>
              </div>
              <div class="tt-card-content">{{ item.content }}</div>
              <div class="tt-card-hover">
                <span class="lc-btn sm primary quiet">{{ t('library.text.fill') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { canvasTextTemplateApi } from '@/utils/canvasBackend'

export interface TextTplItem { id: string; title: string; content: string; category: string; lang?: string }

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'pick', content: string): void
}>()

const { t, locale } = useI18n()

// 素材语言默认跟界面语言走，可手动切换
const lang = ref<'zh' | 'en'>(locale.value.startsWith('zh') ? 'zh' : 'en')
const searchText = ref('')
const activeCat = ref('__all__')

// 按语言缓存，避免重复拉取
const cache: Record<string, TextTplItem[]> = {}
const list = ref<TextTplItem[]>([])
const loading = ref(false)

async function load(l: 'zh' | 'en') {
  if (cache[l]) { list.value = cache[l]; return }
  loading.value = true
  try {
    const res = await canvasTextTemplateApi.list(l)
    const data: TextTplItem[] = res.data.result === 0 ? (res.data.data || []) : []
    cache[l] = data
    list.value = data
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

const categories = computed(() => {
  const set = new Set<string>()
  for (const it of list.value) if (it.category) set.add(it.category)
  return list.value.length ? ['__all__', ...Array.from(set)] : []
})

const filteredList = computed(() => {
  const kw = searchText.value.trim().toLowerCase()
  return list.value.filter((it) => {
    if (activeCat.value !== '__all__' && it.category !== activeCat.value) return false
    if (kw && !(it.title.toLowerCase().includes(kw) || it.content.toLowerCase().includes(kw))) return false
    return true
  })
})

function switchLang(l: 'zh' | 'en') {
  if (lang.value === l) return
  lang.value = l
  activeCat.value = '__all__'
  load(l)
}

function pick(item: TextTplItem) {
  emit('pick', item.content)
  close()
}

function close() {
  emit('update:modelValue', false)
}

watch(() => props.modelValue, (open) => {
  if (open) {
    searchText.value = ''
    activeCat.value = '__all__'
    load(lang.value)
  }
}, { immediate: true })
</script>

<style scoped>
.tt-mask { z-index: 9000; }
.tt-dialog { width: min(1120px, 100%); height: min(760px, calc(calc(100 * var(--lc-vh)) - 40px)); }
.tt-tools { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 20px 0; }
.tt-search { flex: 1; max-width: 320px; }

/* 分类：一排可换行的小块，选中的蓝底 */
.tt-catbar {
  flex: none; display: flex; gap: 6px; flex-wrap: wrap;
  padding: 12px 20px; border-bottom: 1px solid var(--line);
  max-height: 108px; overflow-y: auto;
}
.tt-cat {
  height: 28px; padding: 0 12px; border: 1px solid var(--line); background: var(--well);
  color: var(--text-2); border-radius: 8px; cursor: pointer; font-size: 13px; white-space: nowrap;
  transition: background-color .15s, color .15s, border-color .15s;
}
.tt-cat:hover { color: var(--text); border-color: var(--line-3); }
.tt-cat.on { background: rgb(var(--c-blue) / .28); color: var(--text); border-color: var(--line-3); }

.tt-body { flex: 1; min-height: 0; padding: 16px 20px 20px; overflow-y: auto; }
.tt-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 13px; text-align: center; min-height: 280px;
}
.tt-empty svg { width: 40px; height: 40px; color: rgb(var(--c-film) / .4); }

.tt-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.tt-card {
  position: relative; padding: 12px 14px; cursor: pointer; overflow: hidden;
  min-height: 132px; display: flex; flex-direction: column;
  transition: border-color .15s;
}
.tt-card:hover { border-color: rgb(var(--c-cyan) / .55); }
.tt-card:hover .tt-card-hover { opacity: 1; }
.tt-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tt-card-title {
  font-size: 14px; font-weight: 600; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;
}
.tt-card-cat { flex-shrink: 0; }
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
@media (max-width: 600px) {
  .tt-dialog { height: calc(92 * var(--lc-vh)); height: calc(92 * var(--lc-dvh)); }
  .tt-tools { padding: 12px 16px 0; }
  .tt-search { max-width: none; }
  .tt-catbar { padding: 12px 16px; flex-wrap: nowrap; overflow-x: auto; }
  .tt-body { padding: 12px 16px 16px; }
  .tt-grid { grid-template-columns: 1fr; }
}
</style>
