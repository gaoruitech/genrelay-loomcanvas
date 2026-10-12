<template>
  <div v-if="g.imageRefs.length" class="gf-refs nodrag" :class="{ sm }" @mousedown.stop>
    <div
      v-for="(r, i) in g.imageRefs"
      :key="r.key"
      class="gf-rf"
      :class="{ over: r.overCap, dragging: dragKey === r.key, drop: dropIdx === i }"
      :draggable="reorderable"
      :title="r.overCap ? t('gen.refs.overCapTip') : reorderable ? t('gen.refs.hint') : t('gen.refs.insert', { name: r.label })"
      data-testid="gen-ref"
      @dragstart="onDragStart(r.key, $event)"
      @dragover.prevent="dropIdx = i"
      @dragleave="dropIdx === i && (dropIdx = -1)"
      @drop.prevent="onDrop(i)"
      @dragend="onDragEnd"
      @click.stop="onClick(r)"
      @dblclick.stop="startRename(r)"
    >
      <img :src="canvasImageThumb(r.url, 46)" loading="lazy" alt="" draggable="false" />
      <input
        v-if="editingKey === r.key"
        ref="renameInput"
        v-model="draftName"
        class="gf-rf-input"
        maxlength="20"
        @click.stop
        @keydown.enter.prevent="commitRename(r)"
        @keydown.escape.stop="editingKey = ''"
        @blur="commitRename(r)"
      />
      <span v-else class="gf-rf-n">{{ r.semantic || r.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 节点会送出去的输入图，按最终顺序排成一排小签。
 *
 * 存在的理由不只是为了 @：这些图的顺序原本就是连线的创建顺序，不画出来用户不知道自己
 * 送出去的是什么顺序，@图2 也就没有确定的指向。点一下把 @ 插进提示词，拖动调序，双击起别名；
 * 首尾帧模式下显示「首帧 / 尾帧」，那条路只送两张、顺序由连到哪个口决定，不参与拖拽。
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import { normalizeRefName, type ImageRef } from '@/composables/canvasImageRefs'
import { canvasImageThumb } from '@/utils/canvasMedia'

defineProps<{ sm?: boolean }>()
const { t } = useI18n()
const g = useGenNodeState()
const reorderable = computed(() => !g.readonly && g.refsReorderable)
// 节点自己没有提示词框（文本类）时，点了也没地方插
const canInsert = computed(() => !g.readonly && g.hasOwnPrompt)

const dragKey = ref('')
const dropIdx = ref(-1)
const editingKey = ref('')
const draftName = ref('')
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

function onDragStart(key: string, e: DragEvent) {
  if (!reorderable.value) { e.preventDefault(); return }
  dragKey.value = key
  // 不设的话 Firefox 不发 drop
  e.dataTransfer?.setData('text/plain', key)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragEnd() { dragKey.value = ''; dropIdx.value = -1 }
function onDrop(target: number) {
  const from = g.imageRefs.findIndex(r => r.key === dragKey.value)
  onDragEnd()
  if (from < 0 || from === target) return
  const keys = g.imageRefs.map(r => r.key)
  const [moved] = keys.splice(from, 1)
  keys.splice(target, 0, moved)
  g.reorderRefs(keys)
}
/**
 * 单击插入 @、双击改名。双击会先来两次 click：插入稍等一下再做，等到双击就取消，
 * 不然改个名字提示词里会多出两个 @。
 */
let insertTimer: number | null = null
function onClick(r: ImageRef) {
  if (editingKey.value || !canInsert.value) return
  if (insertTimer) window.clearTimeout(insertTimer)
  insertTimer = window.setTimeout(() => { insertTimer = null; g.mention.insertAtEnd(r) }, 240)
}
onBeforeUnmount(() => { if (insertTimer) window.clearTimeout(insertTimer) })

function startRename(r: ImageRef) {
  if (g.readonly) return
  if (insertTimer) { window.clearTimeout(insertTimer); insertTimer = null }
  editingKey.value = r.key
  draftName.value = r.name
  nextTick(() => {
    const el = renameInput.value
    const input = Array.isArray(el) ? el[0] : el
    input?.focus()
    input?.select()
  })
}
function commitRename(r: ImageRef) {
  if (editingKey.value !== r.key) return
  // 规范化后再存：带空格的名字在纯文本 token 里划不出边界，@ 会匹配不到
  const name = normalizeRefName(draftName.value)
  editingKey.value = ''
  if (name !== r.name) g.renameRef({ key: r.key, name })
}
</script>
