<template>
  <div class="gn-head" :class="{ line }">
    <LcIcon :name="g.icon" />
    <span class="gn-title">{{ g.title }}</span>
    <!-- 只读：标记还在（套的是哪个品牌包、会加什么，点开能看），但不留「给这个节点单独选一个」的入口 -->
    <NodeBrandKit v-if="!g.isText && !g.readonly" mark :entry="kitEntry && !g.viewOnly" :read-only="g.viewOnly" :node-id="g.id" :data="g.data" />
    <span class="gn-sp" />
    <!-- 视频生成没跑过时，这里写它的模式（多图参考 / 首尾帧） -->
    <span v-if="mode === 'tag' && !g.statusLabel && g.modeLabel" class="gn-hx">{{ g.modeLabel }}</span>
    <template v-if="version">
      <span v-if="g.isRunning && g.progress" class="gn-pc">{{ g.progress }}%</span>
      <span v-else-if="g.versionLabel && !g.isRunning" class="gn-vr" data-testid="gen-version-label">{{ g.versionLabel }}</span>
    </template>
    <span v-if="g.statusLabel && mode === 'tag'" class="gn-tg" :class="g.statusClass" data-testid="gen-status">{{ g.statusLabel }}</span>
    <span v-else-if="g.statusLabel" class="gn-tg dot" :class="g.statusClass" role="img" :aria-label="g.statusLabel" v-tip="g.statusLabel" data-testid="gen-status" />
  </div>
</template>

<script setup lang="ts">
import { useGenNodeState } from '@/composables/useGenNode'
import LcIcon from '@/components/LcIcon.vue'
import NodeBrandKit from '../NodeBrandKit.vue'

/**
 * 表头：图标、标题、品牌包的小标记、状态。表头的高度是定死的，标记出不出现都不改变节点的大小。
 * mode：dot = 只留一个状态圆点（悬停读得出是什么状态），tag = 圆点 + 文字。
 * kitEntry：没有品牌包要套用时也留着入口（布局 c：那里没有别的地方能给这个节点单独选品牌包）。
 *   这时它平时不露面，指针移到节点上 / 选中节点时才出现；真有品牌包要套用或节点有例外时标记一直在。
 */
defineProps<{ mode: 'dot' | 'tag'; version?: boolean; line?: boolean; kitEntry?: boolean }>()
const g = useGenNodeState()
</script>
