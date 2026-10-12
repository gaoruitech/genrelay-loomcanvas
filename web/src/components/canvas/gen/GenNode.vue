<template>
  <div
    class="gn"
    :class="[`gn-${layout}`, `k-${type}`, {
      selected,
      'is-running': g.isRunning,
      'has-error': !!g.displayError,
      'is-text': g.isText,
      'is-ro': readonly,
      shaking: g.shaking,
    }]"
    :data-layout="layout"
    :data-status="g.status"
    data-testid="gen-node"
  >
    <component :is="shell" :selected="!!selected" @detail="detailOpen = true" @expand="textOpen = true" />

    <TaskDetailModal v-if="g.detailType && !readonly" :open="detailOpen" :type="(g.detailType as any)" :data="data" @close="detailOpen = false" />

    <!-- 文本类节点的放大查看：结果占大头，大语言模型另带系统提示词 -->
    <Teleport v-if="g.isText && !readonly" to="body">
      <div v-if="textOpen" class="lc-mask lc-sheet" @click.self="textOpen = false" @wheel.stop @mousedown.stop>
        <div class="lc-dialog gn-tmodal">
          <div class="lc-dialog-head">
            <span>{{ type === 'llm' ? t('nodeui.llm.modalTitle') : t('nodeui.analysis.modalTitle') }}</span>
            <button class="lc-x" :title="t('common.close')" :aria-label="t('common.close')" @click="textOpen = false">×</button>
          </div>
          <div class="lc-dialog-body gn-tmodal-b">
            <div v-if="type === 'llm'" class="lc-field">
              <label class="lc-label">{{ t('nodeui.llm.systemPrompt') }}</label>
              <textarea v-model="g.systemPrompt" class="lc-textarea gn-tmodal-sys" :placeholder="t('nodeui.llm.systemPromptPlaceholder')" :disabled="g.isRunning" :maxlength="PROMPT_MAX" />
            </div>
            <div class="lc-field gn-tmodal-grow">
              <label v-if="type === 'llm'" class="lc-label">{{ t('nodeui.llm.result') }}</label>
              <textarea v-model="g.text" class="lc-textarea gn-tmodal-ta" :disabled="g.isRunning" :maxlength="PROMPT_MAX" />
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * 生成节点 —— 图片生成 / 图片编辑 / 视频生成 / 视频编辑 / 大语言模型 / 视频分析共用的那一个。
 *
 * 状态和动作全在 useGenNode 里（与布局无关），这里只按账号选的布局挑一个外壳来画：
 *   a  GenShellA  结果优先，编辑在选中后节点下方的输入条里
 *   b  GenShellB  紧凑节点，编辑在画布右缘的属性面板里
 *   c  GenShellC  一体化卡片，编辑就在节点上
 * 只读画布（分享页）没有画布上下文：固定用 a 的只读形态。
 */
import { computed, inject, nextTick, provide, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { useGenNode, GEN_NODE_KEY, PROMPT_MAX } from '@/composables/useGenNode'
import { CANVAS_NODE_UI_KEY, DEFAULT_NODE_LAYOUT, type GenNodeKind } from '@/composables/nodeLayout'
import TaskDetailModal from '../TaskDetailModal.vue'
import GenShellA from './GenShellA.vue'
import GenShellB from './GenShellB.vue'
import GenShellC from './GenShellC.vue'

const props = defineProps<{
  id: string
  type: string
  data: Record<string, any>
  selected?: boolean
}>()

const { t } = useI18n()
const ui = inject(CANVAS_NODE_UI_KEY, undefined)
const readonly = !ui
const layout = computed(() => (ui ? ui.layout.value : DEFAULT_NODE_LAYOUT))

const g = useGenNode({ kind: props.type as GenNodeKind, id: props.id, data: () => props.data, readonly })
provide(GEN_NODE_KEY, g)

const SHELLS = { a: GenShellA, b: GenShellB, c: GenShellC }
const shell = computed(() => SHELLS[layout.value])

const detailOpen = ref(false)
const textOpen = ref(false)

// 换布局之后端口的位置全变了：让 vue-flow 重新量一遍，连线才接得上
const { updateNodeInternals } = useVueFlow()
watch(layout, () => nextTick(() => updateNodeInternals([props.id])))
</script>
