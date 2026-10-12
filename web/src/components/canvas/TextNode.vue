<template>
  <div class="cv-node cv-text" :class="{ selected }">
    <div class="cv-head">
      <LcIcon name="text" />
      <span class="cv-title">{{ t('nodes.title.text') }}</span>
    </div>
    <div class="cv-body">
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

      <!-- 文本素材：打开素材弹窗，选中即覆盖文本 -->
      <button v-if="$feat.templates" class="cv-pick-btn nodrag" @click.stop="dialogOpen = true" @mousedown.stop>
        <LcIcon name="book" size="s" />
        {{ t('nodeui.text.templates') }}
      </button>
    </div>

    <TextTemplateDialog v-if="$feat.templates" v-model="dialogOpen" @pick="onPick" />
    <Handle id="text-out" type="source" :position="Position.Right" class="h-text h-top" />

    <!-- 放大编辑浮层：teleport 到 body 居中 -->
    <Teleport :to="$lcPortal">
      <div
        v-if="expanded"
        class="cv-prompt-popover expanded nodrag nowheel"
        @click.stop
        @mousedown.stop
        @wheel.stop
      >
        <button class="cv-popover-zoom" :title="t('nodes.action.collapse')" @click.stop="expanded = false">
          <LcIcon name="x" size="s" />
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
import LcIcon from '@/components/LcIcon.vue'

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
.cv-text { width: 280px; height: 300px; }
.cv-textarea-wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.cv-textarea-wrap .cv-textarea { flex: 1 1 auto; }
</style>
