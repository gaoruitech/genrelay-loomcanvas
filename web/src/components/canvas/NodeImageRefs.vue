<template>
  <div v-if="refs.length" class="cv-refs">
    <div class="cv-refs-head">
      <span>{{ t('gen.refs.count', { n: refs.length }) }}</span>
      <span class="cv-refs-hint">{{ t('gen.refs.hint') }}</span>
    </div>

    <div class="cv-refs-strip">
      <div
        v-for="(r, i) in refs"
        :key="r.key"
        class="cv-ref"
        :class="{ over: r.overCap, dragging: dragKey === r.key, drop: dropIdx === i }"
        :draggable="reorderable"
        :title="r.overCap ? t('gen.refs.overCapTip') : t('gen.refs.insert', { name: r.label })"
        @dragstart="onDragStart(r.key, $event)"
        @dragover.prevent="dropIdx = i"
        @dragleave="dropIdx === i && (dropIdx = -1)"
        @drop.prevent="onDrop(i)"
        @dragend="onDragEnd"
        @click="!editingKey && emit('insert', r)"
        @dblclick.stop="startRename(r)"
      >
        <img :src="canvasImageThumb(r.url, 46)" loading="lazy" alt="" />
        <span class="cv-ref-idx">{{ r.semantic || r.index }}</span>

        <!-- 别名。没起名就不占位置，起了才显示，免得一排「图1图2」全是废话 -->
        <span v-if="r.name && editingKey !== r.key" class="cv-ref-name">{{ r.name }}</span>

        <input
          v-if="editingKey === r.key"
          ref="renameInput"
          v-model="draftName"
          class="cv-ref-input nodrag"
          maxlength="20"
          @click.stop
          @keydown.enter.prevent="commitRename(r)"
          @keydown.escape.stop="editingKey = ''"
          @blur="commitRename(r)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 节点的「输入图」缩略图条。
 *
 * 存在的理由不只是为了 @：这些图的顺序原本就是连线的创建顺序，界面上一点都
 * 不显示，用户其实一直不知道自己送出去的是什么顺序。把它画出来，顺序才谈得上
 * 「对不对」，@图2 也才有确定的指向。
 *
 * 角标显示的就是最终序号；首尾帧模式下换成「首帧 / 尾帧」，那条路只送两张、
 * 顺序由连到哪个口决定，不参与拖拽。
 */
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImageRef } from '@/composables/canvasImageRefs'
import { normalizeRefName } from '@/composables/canvasImageRefs'
import { canvasImageThumb } from '@/utils/canvasMedia'

const { t } = useI18n()

const props = defineProps<{
  refs: ImageRef[]
  /** 首尾帧那种位置固定的场景传 false */
  reorderable?: boolean
}>()

const emit = defineEmits<{
  (e: 'insert', ref: ImageRef): void
  (e: 'reorder', keys: string[]): void
  (e: 'rename', payload: { key: string; name: string }): void
}>()

const dragKey = ref('')
const dropIdx = ref(-1)
const editingKey = ref('')
const draftName = ref('')
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

function onDragStart(key: string, e: DragEvent) {
  if (!props.reorderable) { e.preventDefault(); return }
  dragKey.value = key
  // 不设的话 Firefox 不发 drop
  e.dataTransfer?.setData('text/plain', key)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() { dragKey.value = ''; dropIdx.value = -1 }

function onDrop(target: number) {
  const from = props.refs.findIndex(r => r.key === dragKey.value)
  onDragEnd()
  if (from < 0 || from === target) return
  const keys = props.refs.map(r => r.key)
  const [moved] = keys.splice(from, 1)
  keys.splice(target, 0, moved)
  emit('reorder', keys)
}

function startRename(r: ImageRef) {
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
  if (name !== r.name) emit('rename', { key: r.key, name })
}
</script>

<style scoped>
.cv-refs { margin-top: 8px; }
.cv-refs-head {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 11px; color: var(--t-dim); margin-bottom: 5px;
}
.cv-refs-hint { font-size: 10.5px; opacity: .75; }

.cv-refs-strip { display: flex; flex-wrap: wrap; gap: 5px; }

.cv-ref {
  position: relative; width: 46px; height: 46px; border-radius: 7px;
  overflow: hidden; border: 1px solid var(--n-5); cursor: pointer;
  background: var(--n-2); flex: 0 0 auto;
}
.cv-ref img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cv-ref:hover { border-color: var(--accent-edge); }
.cv-ref.dragging { opacity: .4; }
/* 放置位提示画在左边缘：拖拽时人盯的是「插到哪两张中间」 */
.cv-ref.drop { box-shadow: inset 3px 0 0 var(--accent-edge); }
/* 超出模型上限的压暗并划掉，但仍列出来 —— 让人 @ 一张根本不会送出去的图更糟 */
.cv-ref.over { opacity: .38; }
.cv-ref.over::after {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, transparent 0 5px, rgba(0,0,0,.28) 5px 10px);
}

.cv-ref-idx {
  position: absolute; top: 2px; left: 2px; min-width: 14px; height: 14px;
  padding: 0 3px; border-radius: 4px; background: rgba(0,0,0,.66); color: #fff;
  font-size: 10px; line-height: 14px; text-align: center;
  font-variant-numeric: tabular-nums;
}
.cv-ref-name {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 1px 3px;
  background: rgba(0,0,0,.62); color: #fff; font-size: 10px; line-height: 1.35;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cv-ref-input {
  position: absolute; left: 0; right: 0; bottom: 0; width: 100%;
  border: none; outline: none; padding: 1px 3px;
  background: var(--n-1); color: var(--t-max); font: inherit; font-size: 10px;
}
</style>
