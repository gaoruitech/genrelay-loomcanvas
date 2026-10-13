<template>
  <Handle
    :id="port.id"
    :type="port.type"
    :position="port.type === 'source' ? Position.Right : Position.Left"
    class="gn-h"
    :class="[port.cls, { 'is-wired': port.count > 0, 'is-off': port.off }]"
    :connectable="port.connectable"
    v-tip="tip"
  >
    <!-- 端口旁的名字：pill = 悬停 / 选中时出现的小胶囊（带已连接数），tag = 常驻的一小段字 -->
    <span v-if="label && port.label" class="gn-pl" :class="label">{{ port.label }}<b v-if="label === 'pill' && port.countText">{{ port.countText }}</b></span>
  </Handle>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { GenPort } from '@/composables/useGenNode'

const props = defineProps<{ port: GenPort; label?: 'pill' | 'tag' | '' }>()
// 悬停提示里也带上名字和已连接数：没有常驻标签的布局靠它知道这是哪个口
const tip = computed(() => {
  const p = props.port
  if (p.type === 'source') return undefined
  return p.countText ? `${p.title || p.label} · ${p.countText}` : (p.title || p.label)
})
</script>
