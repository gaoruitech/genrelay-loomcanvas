<template>
  <div
    ref="rootRef"
    class="gc nodrag nowheel"
    :class="{ sheet: phone, flipped: place.flipped && !phone, off: !place.visible && !phone }"
    :style="phone ? undefined : { transform: `translate3d(${place.left}px, ${place.top}px, 0)`, width: place.width + 'px' }"
    role="group"
    :aria-label="t('gen.composer.label', { name: g.title })"
    data-testid="gen-composer"
    @keydown.esc.stop="emit('close')"
    @mousedown.stop
    @wheel.stop
  >
    <div class="gc-card">
      <div class="gc-grip">
        <button type="button" class="gf-ib-plain" :title="t('common.close')" :aria-label="t('common.close')" @click="emit('close')"><LcIcon name="x" size="s" /></button>
      </div>
      <GenPromptField ref="promptRef" variant="composer" meta @escape="emit('close')" />
      <GenNotes kit />
      <div class="gc-bar">
        <GenModelField variant="chip" />
        <GenParamsField variant="chip" />
        <span class="gn-sp" />
        <GenCost long />
        <GenRunButton variant="lg" />
      </div>
    </div>
    <div v-if="!phone" class="gc-keys" aria-hidden="true">
      <span v-if="g.hasOwnPrompt && g.imageRefs.length"><kbd>@</kbd> {{ t('gen.composer.keyAt') }}</span>
      <span><kbd>{{ modKey }}</kbd> <kbd>Enter</kbd> {{ t('gen.composer.keyRun') }}</span>
      <span><kbd>Esc</kbd> {{ t('gen.composer.keyClose') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 布局 a 的输入条：整张画布只有这一条，选中哪一个生成节点就编辑哪一个。
 *
 * 浮在画布上面（不在节点里），所以开合不会改动节点的大小和位置。跟着节点走：平移、缩放、
 * 拖动节点时位置实时重算；大小固定为屏幕像素，不跟画布缩放 —— 这是打字的地方，缩到 30%
 * 就没法用了。节点下方放不下时翻到节点上方；手机宽度改成贴底的抽屉。
 *
 * 状态是自己另起的一份 useGenNode（由父级按节点 id 加 key，换节点就整个重建）：
 * 开着 only-render-visible-elements，被选中的节点可能没渲染，不能指望节点组件替它算。
 */
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { useGenNode, GEN_NODE_KEY } from '@/composables/useGenNode'
import type { GenNodeKind } from '@/composables/nodeLayout'
import LcIcon from '@/components/LcIcon.vue'
import GenPromptField from './GenPromptField.vue'
import GenNotes from './GenNotes.vue'
import GenModelField from './GenModelField.vue'
import GenParamsField from './GenParamsField.vue'
import GenCost from './GenCost.vue'
import GenRunButton from './GenRunButton.vue'

const props = defineProps<{ nodeId: string; kind: GenNodeKind }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const { viewport, findNode } = useVueFlow()
const node = computed(() => findNode(props.nodeId))
const g = useGenNode({ kind: props.kind, id: props.nodeId, data: () => node.value?.data || {} })
provide(GEN_NODE_KEY, g)

const modKey = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

/* ── 位置 ── */
const rootRef = ref<HTMLElement | null>(null)
const own = reactive({ h: 150 })
const host = reactive({ w: 1200, h: 800 })
const phone = computed(() => host.w <= 640)
const WIDTH = 480, GAP = 12, EDGE = 8

const place = computed(() => {
  const n = node.value
  const width = Math.min(WIDTH, host.w - EDGE * 2)
  if (!n) return { left: 0, top: 0, width, flipped: false, visible: false }
  const z = viewport.value.zoom || 1
  const x = viewport.value.x + (n.computedPosition?.x ?? n.position.x) * z
  const y = viewport.value.y + (n.computedPosition?.y ?? n.position.y) * z
  const w = (n.dimensions?.width || 272) * z
  const h = (n.dimensions?.height || 272) * z
  // 节点整个在视野外：不出现（否则会孤零零贴在画布边上）
  const visible = x + w > 0 && x < host.w && y + h > 0 && y < host.h
  const left = Math.round(Math.max(EDGE, Math.min(host.w - width - EDGE, x + w / 2 - width / 2)))
  const below = y + h + GAP
  const above = y - GAP - own.h
  let top = below
  let flipped = false
  if (below + own.h > host.h - EDGE) {
    // 下方放不下：上方放得下就翻上去；都放不下（节点比视野还高）就贴着底边
    if (above >= EDGE) { top = above; flipped = true }
    else top = Math.max(EDGE, host.h - own.h - EDGE)
  }
  return { left, top: Math.round(top), width, flipped, visible }
})

let ro: ResizeObserver | null = null
onMounted(() => {
  const el = rootRef.value
  const parent = el?.parentElement
  if (!el || !parent || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => {
    own.h = el.offsetHeight || own.h
    host.w = parent.clientWidth || host.w
    host.h = parent.clientHeight || host.h
  })
  ro.observe(el)
  ro.observe(parent)
  own.h = el.offsetHeight || own.h
  host.w = parent.clientWidth || host.w
  host.h = parent.clientHeight || host.h
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null })

const promptRef = ref<InstanceType<typeof GenPromptField> | null>(null)
/** 画布上选中节点后直接打字：把焦点放进提示词框 */
function focusPrompt() { return promptRef.value?.focus() || false }
defineExpose({ focusPrompt, run: () => g.run() })
</script>
