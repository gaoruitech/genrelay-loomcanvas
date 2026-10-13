<template>
  <aside
    ref="rootRef"
    class="gi ed-insp nodrag nowheel"
    :class="{ sheet: phone }"
    :aria-label="t(g.viewOnly ? 'gen.inspector.labelView' : 'gen.inspector.label', { name: g.title })"
    :data-view="g.viewOnly ? '1' : undefined"
    data-testid="gen-inspector"
    @keydown.capture="onKeyCapture"
    @keydown.esc.stop="emit('close')"
    @mousedown.stop
    @wheel.stop
  >
    <div class="gi-h">
      <LcIcon :name="g.icon" />
      <span>{{ g.title }}</span>
      <span v-if="g.statusLabel" class="gn-tg" :class="g.statusClass">{{ g.statusLabel }}</span>
      <button v-tip="{ text: t('common.close'), placement: 'bottom' }" type="button" class="gf-ib-plain" :aria-label="t('common.close')" data-testid="gen-inspector-close" @click="emit('close')"><LcIcon name="x" size="s" /></button>
    </div>

    <div class="gi-b">
      <div class="gf-fl">
        <div class="gf-lab">{{ g.promptLabel }}</div>
        <GenPromptField ref="promptRef" variant="inspector" meta @escape="emit('close')" />
      </div>

      <div class="gf-fl">
        <div class="gf-lab">{{ t('nodes.field.model') }}</div>
        <GenModelField variant="field" />
      </div>

      <GenParamsField variant="form" />

      <GenNotes kit />

      <!-- 文本类节点：结果在这里看、在这里改 -->
      <div v-if="g.isText" class="gf-fl">
        <div class="gf-lab">{{ t('gen.inspector.result') }}<span class="gf-count">{{ g.text.length }} / {{ PROMPT_MAX }}</span></div>
        <textarea
          v-model="g.text"
          class="gi-text"
          :placeholder="g.isRunning ? g.runningPlain : g.viewOnly ? t('nodeui.share.noResult') : g.placeholder"
          :disabled="g.isRunning && !g.viewOnly"
          :readonly="g.viewOnly"
          :aria-label="t('gen.inspector.result')"
          :maxlength="PROMPT_MAX"
          data-testid="gen-text"
        />
      </div>

      <!-- 这一版出了多张：挑当前用哪一张 -->
      <div v-if="g.mediaList.length > 1" class="gf-fl">
        <div class="gf-lab">{{ t('gen.inspector.outputs') }}<span>{{ t('gen.inspector.outputsN', { n: g.mediaList.length }) }}</span></div>
        <div class="gf-strip-row">
          <div class="gn-strip">
            <button
              v-for="(url, i) in g.mediaList" :key="url + i" type="button"
              :class="{ on: url === g.mediaUrl }"
              v-tip="t(g.media === 'video' ? 'gen.node.nthVideo' : 'gen.node.nthImage', { n: i + 1 })"
              @click="g.selectMedia(url)"
            ><img v-if="thumbOf(url)" :src="thumbOf(url)" alt="" /><video v-else :src="url" preload="metadata" muted /></button>
          </div>
        </div>
      </div>

      <div v-if="g.versions.length > 1" class="gf-fl">
        <div class="gf-lab">{{ t('gen.inspector.versions') }}<span>{{ t('gen.inspector.versionsN', { n: g.versions.length }) }}</span></div>
        <GenVersions variant="thumbs" />
      </div>
    </div>

    <!-- 只读时没有运行钮；连成本也没有的话这一条整个不出（不留一条空的底栏） -->
    <div v-if="!g.viewOnly || g.costText || g.isRunning" class="gi-f">
      <GenCost long />
      <GenRunButton variant="lg" />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 布局 b 的属性面板：整张画布只有这一个，停在画布右缘，选中哪一个生成节点就显示哪一个的全部设置。
 * 没选中、或选了不止一个时不出现。手机宽度改成贴底的抽屉。
 *
 * 状态是自己另起的一份 useGenNode（父级按节点 id 加 key），理由同输入条：被选中的节点可能没渲染。
 * 根元素带 .ed-insp：生成队列的圆钮找空位时把它算作已占用。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { useGenNode, GEN_NODE_KEY, PROMPT_MAX } from '@/composables/useGenNode'
import type { GenNodeKind } from '@/composables/nodeLayout'
import type { Rect } from '@/utils/floatSpot'
import { canvasImageThumb, canvasVideoPoster } from '@/utils/canvasMedia'
import LcIcon from '@/components/LcIcon.vue'
import GenPromptField from './GenPromptField.vue'
import GenNotes from './GenNotes.vue'
import GenModelField from './GenModelField.vue'
import GenParamsField from './GenParamsField.vue'
import GenCost from './GenCost.vue'
import GenRunButton from './GenRunButton.vue'
import GenVersions from './GenVersions.vue'

const props = defineProps<{ nodeId: string; kind: GenNodeKind }>()
const emit = defineEmits<{
  (e: 'close'): void
  /** 手机宽度下它是贴底的抽屉：占的矩形（相对编辑区）；桌面上是右缘的面板、或者卸掉了，是 null。用途同输入条的那一个 */
  (e: 'sheet', rect: Rect | null): void
}>()

const { t } = useI18n()
const { findNode } = useVueFlow()
const node = computed(() => findNode(props.nodeId))
const g = useGenNode({ kind: props.kind, id: props.nodeId, data: () => node.value?.data || {} })
provide(GEN_NODE_KEY, g)

const thumbOf = (url: string) => (g.media === 'video' ? canvasVideoPoster(url, 96) : canvasImageThumb(url, 96))

const rootRef = ref<HTMLElement | null>(null)
const hostW = ref(1200)
const phone = computed(() => hostW.value <= 640)
let ro: ResizeObserver | null = null
function reportSheet() {
  const el = rootRef.value, parent = el?.parentElement
  if (!phone.value || !el || !parent) { emit('sheet', null); return }
  // 用排版的位置，不用 getBoundingClientRect：抽屉有一段从下往上滑的入场动画，动画途中量到的矩形是偏下的
  emit('sheet', { l: el.offsetLeft, t: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight })
}
onMounted(() => {
  const parent = rootRef.value?.parentElement
  if (!parent || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => { hostW.value = parent.clientWidth || hostW.value; void nextTick(reportSheet) })
  ro.observe(parent)
  if (rootRef.value) ro.observe(rootRef.value)
  hostW.value = parent.clientWidth || hostW.value
  void nextTick(reportSheet)
})
watch(phone, () => { void nextTick(reportSheet) }, { flush: 'post' })
onBeforeUnmount(() => { emit('sheet', null); ro?.disconnect(); ro = null })

/** 输入法正在组字：回车 / Esc / 方向键都是输入法的。拦在捕获阶段，面板里的 Ctrl+Enter 运行、Esc 收起这时不触发 */
function onKeyCapture(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) e.stopPropagation()
}

const promptRef = ref<InstanceType<typeof GenPromptField> | null>(null)
function focusPrompt() { return promptRef.value?.focus() || false }
defineExpose({ focusPrompt, run: () => g.run() })
</script>
