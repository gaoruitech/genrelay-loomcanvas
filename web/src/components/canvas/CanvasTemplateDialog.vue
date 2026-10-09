<template>
  <div v-if="modelValue" class="tpl-mask" @click.self="close">
    <div class="tpl-dialog">
      <!-- 头部 -->
      <div class="tpl-header">
        <div class="tpl-title">{{ t('library.template.title') }}</div>
        <button class="tpl-close" :title="t('common.close')" @click="close">×</button>
      </div>

      <!-- 内容：模板卡片网格 -->
      <div class="tpl-body">
        <div v-if="templates.length" class="tpl-grid">
          <div v-for="tpl in templates" :key="tpl.key" class="tpl-card" @click="apply(tpl)">
            <div class="tpl-thumb">
              <img loading="lazy" v-if="tpl.cover" :src="ensureHttps(tpl.cover)" :alt="tpl.title" />
              <span v-else class="tpl-thumb-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="9" x2="9" y2="21" />
                </svg>
              </span>
              <span class="tpl-use">{{ t('library.useTemplate') }}</span>
            </div>
            <div class="tpl-meta">
              <div class="tpl-name">{{ tpl.title }}</div>
              <div v-if="tpl.description" class="tpl-sub">{{ tpl.description }}</div>
            </div>
          </div>
        </div>

        <div v-else class="tpl-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="9" x2="9" y2="21" />
          </svg>
          <span>{{ loading ? t('common.loading') : t('library.template.empty') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useI18n } from 'vue-i18n'
import { canvasTemplateApi, apiErrorMessage } from '@/utils/api'
import { ensureHttps } from '@/utils/mediaUrl'

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
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'apply', tpl: CanvasTemplate): void
}>()

const templates = ref<CanvasTemplate[]>([])
const loading = ref(false)

async function loadTemplates() {
  loading.value = true
  try {
    const res = await canvasTemplateApi.list()
    if (res.data.result === 0 && Array.isArray(res.data.data)) {
      templates.value = res.data.data
    }
  } catch (e: any) {
    MessagePlugin.error(apiErrorMessage(e, t('library.template.loadFailed')))
  } finally {
    loading.value = false
  }
}

function apply(tpl: CanvasTemplate) {
  emit('apply', tpl)
  close()
}

function close() {
  emit('update:modelValue', false)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKey)
      loadTemplates()
    } else {
      window.removeEventListener('keydown', onKey)
    }
  }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.tpl-mask {
  position: fixed; inset: 0; z-index: 9000;
  background: var(--scrim);
  display: flex; align-items: center; justify-content: center;
  padding: 32px;
}

.tpl-dialog {
  width: min(1200px, 100%);
  height: min(780px, calc(100vh - 64px));
  background: var(--n-2);
  color: var(--t-strong);
  border: 1px solid var(--n-5);
  border-radius: 16px;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 60px var(--shadow-2);
}

.tpl-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--n-4);
}
.tpl-title {
  display: flex; align-items: center; gap: 10px;
  font-size: 15px; font-weight: 600; color: var(--t-max);
}
.tpl-close {
  width: 32px; height: 32px;
  background: transparent; border: none; color: var(--t-dim);
  font-size: 24px; cursor: pointer; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.tpl-close:hover { background: var(--n-4); color: var(--t-max); }

.tpl-body {
  flex: 1;
  padding: 16px 20px 20px;
  overflow-y: auto;
}
.tpl-body::-webkit-scrollbar { width: 6px; }
.tpl-body::-webkit-scrollbar-thumb { background: var(--n-5); border-radius: 3px; }

.tpl-grid {
  display: grid; gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.tpl-card {
  background: var(--n-3);
  border: 1px solid var(--n-4);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.tpl-card:hover { border-color: var(--accent-text); transform: translateY(-2px); }
.tpl-thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  background: var(--n-0);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.tpl-thumb img { width: 100%; height: 100%; object-fit: cover; }
.tpl-thumb-empty { color: var(--n-7); }
.tpl-thumb-empty svg { width: 40px; height: 40px; }
.tpl-use {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--glass-soft);
  color: var(--accent-text); font-size: 14px; font-weight: 600;
  opacity: 0; transition: opacity 0.15s;
}
.tpl-card:hover .tpl-use { opacity: 1; }
.tpl-meta { padding: 10px 12px; }
.tpl-name { font-size: 14px; color: var(--t-strong); font-weight: 500; }
.tpl-sub {
  margin-top: 4px; font-size: 12px; color: var(--t-dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.tpl-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 100px 20px; color: var(--t-dim); font-size: 14px; text-align: center;
  min-height: 320px;
}
.tpl-empty svg { width: 48px; height: 48px; color: var(--n-7); }
</style>
