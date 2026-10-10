<template>
  <div v-if="modelValue" class="lc-mask lc-sheet tpl-mask" @click.self="close">
    <div class="lc-dialog tpl-dialog">
      <div class="lc-dialog-head">
        <span>{{ t('library.template.title') }}</span>
        <button class="lc-x" :title="t('common.close')" @click="close">×</button>
      </div>

      <!-- 内容：模板卡片网格 -->
      <div class="tpl-body">
        <div v-if="templates.length" class="tpl-grid">
          <div v-for="tpl in templates" :key="tpl.key" class="lc-card tpl-card" @click="apply(tpl)">
            <div class="tpl-thumb">
              <img loading="lazy" v-if="tpl.cover" :src="ensureHttps(tpl.cover)" :alt="tpl.title" />
              <span v-else class="tpl-thumb-empty"><LcIcon name="canvas" size="xl" /></span>
              <span class="tpl-use"><span class="lc-btn sm primary quiet">{{ t('library.useTemplate') }}</span></span>
            </div>
            <div class="tpl-meta">
              <div class="tpl-name">{{ tpl.title }}</div>
              <div v-if="tpl.description" class="tpl-sub">{{ tpl.description }}</div>
            </div>
          </div>
        </div>

        <div v-else class="tpl-empty">
          <LcIcon name="canvas" size="xl" />
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
import LcIcon from '@/components/LcIcon.vue'
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
.tpl-mask { z-index: 9000; }
.tpl-dialog { width: min(1200px, 100%); height: min(780px, calc(100vh - 40px)); }
.tpl-body { flex: 1; min-height: 0; padding: 20px; overflow-y: auto; }

.tpl-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.tpl-card { overflow: hidden; cursor: pointer; transition: border-color .15s; }
.tpl-card:hover { border-color: rgba(63, 216, 255, .55); }
.tpl-thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  background: var(--media-bg);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.tpl-thumb img { width: 100%; height: 100%; object-fit: cover; }
.tpl-thumb-empty { color: rgba(124, 160, 255, .4); }
.tpl-thumb-empty svg { width: 36px; height: 36px; }
.tpl-use {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 9, 28, .6);
  opacity: 0; transition: opacity .15s;
}
.tpl-card:hover .tpl-use { opacity: 1; }
.tpl-meta { padding: 10px 12px 12px; }
.tpl-name { font-size: 14px; color: var(--text); font-weight: 600; }
.tpl-sub {
  margin-top: 2px; font-size: 12px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.tpl-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 13px; text-align: center;
  min-height: 280px;
}
.tpl-empty svg { width: 40px; height: 40px; color: rgba(124, 160, 255, .4); }
@media (max-width: 600px) {
  .tpl-dialog { height: 92vh; height: 92dvh; }
  .tpl-body { padding: 16px; }
  .tpl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
}
</style>
