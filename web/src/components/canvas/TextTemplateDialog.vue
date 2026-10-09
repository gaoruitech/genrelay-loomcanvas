<template>
  <Teleport to="body">
    <div v-if="modelValue" class="tt-mask" @click.self="close">
      <div class="tt-dialog">
        <!-- header -->
        <div class="tt-header">
          <div class="tt-title">{{ t('library.text.title') }}</div>
          <div class="tt-actions">
            <input v-model="searchText" class="tt-search" :placeholder="t('library.text.search')" />
            <!-- 素材语言切换：默认跟界面语言 -->
            <div class="tt-lang">
              <button :class="['tt-lang-btn', { active: lang === 'zh' }]" @click="switchLang('zh')">{{ t('library.text.langZh') }}</button>
              <button :class="['tt-lang-btn', { active: lang === 'en' }]" @click="switchLang('en')">{{ t('library.text.langEn') }}</button>
            </div>
            <button class="tt-close" :title="t('common.close')" @click="close">×</button>
          </div>
        </div>

        <!-- category chips -->
        <div v-if="categories.length" class="tt-catbar">
          <button
            v-for="c in categories"
            :key="c"
            :class="['tt-cat', { active: activeCat === c }]"
            @click="activeCat = c"
          >{{ c === '__all__' ? t('common.all') : c }}</button>
        </div>

        <!-- body -->
        <div class="tt-body">
          <div v-if="loading" class="tt-empty">{{ t('common.loading') }}</div>
          <div v-else-if="!filteredList.length" class="tt-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <div>{{ t('library.text.empty') }}</div>
          </div>
          <div v-else class="tt-grid">
            <div
              v-for="item in filteredList"
              :key="item.id"
              class="tt-card"
              @click="pick(item)"
            >
              <div class="tt-card-head">
                <span class="tt-card-title">{{ item.title }}</span>
                <span v-if="item.category" class="tt-card-cat">{{ item.category }}</span>
              </div>
              <div class="tt-card-content">{{ item.content }}</div>
              <div class="tt-card-hover">
                <span class="tt-use-btn">{{ t('library.text.fill') }}</span>
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
import { canvasTextTemplateApi } from '@/utils/api'

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
.tt-mask {
  position: fixed; inset: 0; z-index: 9000;
  background: var(--scrim);
  display: flex; align-items: center; justify-content: center;
  padding: 32px;
}
.tt-dialog {
  width: min(1120px, 100%);
  height: min(760px, calc(100vh - 64px));
  background: var(--n-2);
  color: var(--t-strong);
  border: 1px solid var(--n-5);
  border-radius: 16px;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 60px var(--shadow-2);
}

.tt-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 14px 18px; border-bottom: 1px solid var(--n-4);
}
.tt-title { font-size: 16px; font-weight: 600; color: var(--t-max); }
.tt-actions { display: flex; align-items: center; gap: 12px; }
.tt-search {
  width: 200px; padding: 8px 12px; border-radius: 8px;
  border: 1px solid var(--n-5); background: var(--n-3); color: var(--t-strong);
  font-size: 13px; outline: none;
}
.tt-search:focus { border-color: var(--n-7); }
.tt-search::placeholder { color: var(--t-dim); }

.tt-lang { display: flex; gap: 3px; background: var(--n-3); border-radius: 8px; padding: 3px; }
.tt-lang-btn {
  padding: 5px 12px; border: none; background: none; color: var(--t-dim);
  border-radius: 6px; cursor: pointer; font-size: 13px;
}
.tt-lang-btn.active { background: var(--btn-bg); color: var(--btn-fg); font-weight: 600; }

.tt-close {
  width: 32px; height: 32px; background: transparent; border: none; color: var(--t-dim);
  font-size: 24px; cursor: pointer; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.tt-close:hover { background: var(--n-4); color: var(--t-max); }

.tt-catbar {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 12px 18px; border-bottom: 1px solid var(--n-4);
  max-height: 108px; overflow-y: auto;
}
.tt-cat {
  padding: 6px 14px; border: 1px solid var(--n-5); background: var(--n-3);
  color: var(--t-body); border-radius: 999px; cursor: pointer; font-size: 13px;
  transition: background-color 0.15s, color 0.15s, border-color 0.15s;
}
.tt-cat:hover { color: var(--t-max); border-color: var(--n-7); }
.tt-cat.active { background: var(--chip-bg); color: var(--chip-fg); border-color: var(--accent-text); font-weight: 600; }

.tt-body { flex: 1; padding: 16px 18px 20px; overflow-y: auto; }
.tt-body::-webkit-scrollbar { width: 6px; }
.tt-body::-webkit-scrollbar-thumb { background: var(--n-5); border-radius: 3px; }

.tt-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 100px 20px; color: var(--t-dim); font-size: 14px; text-align: center; min-height: 320px;
}
.tt-empty svg { width: 48px; height: 48px; color: var(--n-7); }

.tt-grid {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}
.tt-card {
  position: relative;
  background: var(--n-3); border: 1px solid var(--n-4); border-radius: 12px;
  padding: 12px 14px; cursor: pointer; overflow: hidden;
  min-height: 132px; display: flex; flex-direction: column;
  transition: border-color 0.15s, transform 0.15s;
}
.tt-card:hover { border-color: var(--accent-text); transform: translateY(-2px); }
.tt-card:hover .tt-card-hover { opacity: 1; }

.tt-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tt-card-title {
  font-size: 13.5px; font-weight: 600; color: var(--t-strong);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;
}
.tt-card-cat {
  flex-shrink: 0; font-size: 11px; color: var(--t-dim);
  background: var(--n-4); border-radius: 5px; padding: 2px 7px;
}
.tt-card-content {
  font-size: 12px; line-height: 1.55; color: var(--t-dim);
  overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  white-space: pre-wrap; word-break: break-word;
}
.tt-card-hover {
  position: absolute; inset: 0;
  display: flex; align-items: flex-end; justify-content: center;
  padding-bottom: 14px;
  background: linear-gradient(to top, var(--glass-panel) 30%, rgba(20,20,24,0) 100%);
  opacity: 0; transition: opacity 0.18s;
}
/* 同 LibraryDialog：主按钮配色成对取，--btn-bg 配 --btn-fg */
.tt-use-btn {
  padding: 7px 20px; background: var(--btn-bg); color: var(--btn-fg);
  border-radius: 8px; font-size: 13px; font-weight: 600;
}
</style>
