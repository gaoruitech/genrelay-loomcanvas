<template>
  <div class="cv-node cv-surface" :class="{ selected }">
    <div class="cv-textarea-wrap">
      <textarea
        v-model="text"
        class="cv-textarea nodrag nowheel"
        :placeholder="t('nodeui.text.placeholder')"
        rows="4"
        maxlength="5000"
        @mousedown.stop
      />
      <div class="cv-textarea-footer">
        <button
          class="cv-clear-btn nodrag"
          :disabled="!text"
          @click.stop="text = ''"
          @mousedown.stop
        >{{ t('common.clear') }}</button>
        <span class="cv-footer-right">
          <button class="cv-zoom-btn nodrag" :title="t('nodes.action.expand')" @click.stop="openExpand" @mousedown.stop>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          <span class="cv-char-count">{{ text.length }} / 5000</span>
        </span>
      </div>
    </div>

    <!-- 模板素材：打开文本素材弹窗，选中即覆盖文本（独立成块，置于文本框下方） -->
    <div class="cv-tpl-bar">
      <button class="cv-tpl-btn nodrag" @click.stop="dialogOpen = true" @mousedown.stop>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        {{ t('nodeui.text.templates') }}
      </button>
    </div>

    <TextTemplateDialog v-model="dialogOpen" @pick="onPick" />
    <Handle id="text-out" type="source" :position="Position.Right" class="h-text" />

    <!-- 放大编辑浮层：teleport 到 body 居中，复用 gen 节点的 .cv-prompt-popover.expanded 样式 -->
    <Teleport to="body">
      <div
        v-if="expanded"
        class="cv-prompt-popover expanded nodrag nowheel"
        @click.stop
        @mousedown.stop
        @wheel.stop
      >
        <button
          class="cv-popover-zoom"
          :title="t('nodes.action.collapse')"
          @click.stop="expanded = false"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <div class="cv-textarea-wrap">
          <textarea
            ref="expandTextareaRef"
            v-model="text"
            class="cv-prompt-textarea"
            :placeholder="t('nodeui.text.placeholder')"
            maxlength="5000"
            @keydown.escape="expanded = false"
          />
          <div class="cv-textarea-footer">
            <button
              class="cv-clear-btn"
              :disabled="!text"
              @click.stop="text = ''"
            >{{ t('common.clear') }}</button>
            <span class="cv-char-count">{{ text.length }} / 5000</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import TextTemplateDialog from './TextTemplateDialog.vue'

const props = defineProps<{
  id: string
  data: { text?: string }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData, onPaneClick, onNodeClick, onMoveStart } = useVueFlow()

const text = computed<string>({
  get: () => props.data.text || '',
  set: (v) => updateNodeData(props.id, { text: v })
})

const expanded = ref(false)
const expandTextareaRef = ref<HTMLTextAreaElement | null>(null)

// 模板素材：素材库弹窗
const dialogOpen = ref(false)
function onPick(content: string) {
  text.value = content  // 覆盖当前文本
}

function openExpand() {
  expanded.value = true
  nextTick(() => {
    const el = expandTextareaRef.value
    if (!el) return
    el.focus()
    // 光标落到末尾，便于继续追加
    const len = el.value.length
    el.setSelectionRange(len, len)
  })
}

// 放大编辑浮层点外面关：document mousedown 兜底；Vue Flow pane click / move / 别的节点 click 也关
function onDocClickClose(e: MouseEvent) {
  const el = e.target as HTMLElement
  if (expanded.value && !el.closest('.cv-prompt-popover')) expanded.value = false
}
onPaneClick(() => { expanded.value = false })
onMoveStart(() => { expanded.value = false })
onNodeClick(({ node }) => { if (node.id !== props.id) { expanded.value = false } })

onMounted(() => document.addEventListener('mousedown', onDocClickClose))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClickClose))
</script>

<style scoped>
@import './node-shared.css';
.cv-node { min-width: 280px; max-width: 280px; height: 300px; }
.cv-node .cv-textarea-wrap { flex: 1 1 auto; display: flex; flex-direction: column; }
.cv-node .cv-textarea-wrap .cv-textarea { flex: 1 1 auto; }

/* 文本域脚注：放大按钮贴着字数（footer 本体 pointer-events:none，按钮需显式开启） */
.cv-footer-right { display: inline-flex; align-items: center; gap: 6px; }
.cv-zoom-btn {
  border: 0; background: transparent; color: var(--t-dim); cursor: pointer;
  width: 20px; height: 20px; display: grid; place-items: center; border-radius: 5px;
  pointer-events: auto;
}
.cv-zoom-btn:hover { color: var(--accent-text); background: var(--n-4); }
.cv-zoom-btn svg { width: 14px; height: 14px; }

.cv-tpl-bar { margin-top: 8px; }
.cv-tpl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: var(--film-2);
  color: var(--t-body);
  font-size: 12px;
  cursor: pointer;
}
.cv-tpl-btn:hover { background: var(--film-2); color: var(--t-max); }
.cv-tpl-btn svg { width: 14px; height: 14px; }
</style>
