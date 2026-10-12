<template>
  <div class="gn-head" :class="{ line }">
    <LcIcon :name="g.icon" />
    <span class="gn-title">{{ g.title }}</span>
    <NodeBrandKit v-if="!g.isText && !g.readonly" mark :node-id="g.id" :data="g.data" />
    <span class="gn-sp" />
    <!-- 视频生成没跑过时，这里写它的模式（多图参考 / 首尾帧） -->
    <span v-if="mode === 'tag' && !g.statusLabel && g.modeLabel" class="gn-hx">{{ g.modeLabel }}</span>
    <template v-if="version">
      <span v-if="g.isRunning && g.progress" class="gn-pc">{{ g.progress }}%</span>
      <span v-else-if="g.versionLabel && !g.isRunning" class="gn-vr" data-testid="gen-version-label">{{ g.versionLabel }}</span>
    </template>
    <span v-if="g.statusLabel && mode === 'tag'" class="gn-tg" :class="g.statusClass" data-testid="gen-status">{{ g.statusLabel }}</span>
    <span v-else-if="g.statusLabel" class="gn-tg dot" :class="g.statusClass" role="img" :aria-label="g.statusLabel" :title="g.statusLabel" data-testid="gen-status" />
  </div>
</template>

<script setup lang="ts">
import { useGenNodeState } from '@/composables/useGenNode'
import LcIcon from '@/components/LcIcon.vue'
import NodeBrandKit from '../NodeBrandKit.vue'

/**
 * 表头：图标、标题、品牌包例外的小标记、状态。
 * mode：dot = 只留一个状态圆点（悬停读得出是什么状态），tag = 圆点 + 文字。
 */
defineProps<{ mode: 'dot' | 'tag'; version?: boolean; line?: boolean }>()
const g = useGenNodeState()
</script>
