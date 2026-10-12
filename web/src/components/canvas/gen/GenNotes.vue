<template>
  <div v-if="show" class="gf-notes" :class="{ tight }" @mousedown.stop @click.stop>
    <!-- 校验没过 / 运行失败：原因原样写出来 -->
    <div v-if="g.displayError" class="gf-err nodrag" data-testid="gen-error">
      <div class="gf-err-msg nowheel" @wheel.stop>{{ g.displayError }}</div>
      <button v-if="g.failed" type="button" class="gf-err-retry" @click.stop="g.run()">{{ t('common.retry') }}</button>
    </div>

    <!-- 运行前就要说的话：参考图只能给公网地址、纯文本模型不读图…… -->
    <div v-for="(n, i) in g.notices" :key="i" class="gf-notice" :class="{ clamp: tight }" :title="n" data-testid="gen-notice"><span>{{ n }}</span></div>

    <!-- 多条文本输入的拼接顺序 -->
    <div v-if="g.textInputs.length > 1" class="gf-order nodrag">
      <div class="gf-hint">{{ t('nodeui.llm.textOrder') }}</div>
      <div v-for="(it, i) in g.textInputs" :key="it.sourceId" class="gf-order-item">
        <span class="gf-order-idx">{{ i + 1 }}</span>
        <span class="gf-order-snip">{{ it.snippet || t('nodeui.llm.emptyText') }}</span>
        <span class="gf-order-btns">
          <button type="button" :disabled="i === 0" :title="t('nodeui.llm.moveUp')" :aria-label="t('nodeui.llm.moveUp')" @click.stop="g.moveText(i, -1)">↑</button>
          <button type="button" :disabled="i === g.textInputs.length - 1" :title="t('nodeui.llm.moveDown')" :aria-label="t('nodeui.llm.moveDown')" @click.stop="g.moveText(i, 1)">↓</button>
        </span>
      </div>
    </div>

    <!-- 这次运行套用哪个品牌包、会加什么、这个节点要不要例外（文本类节点不套品牌包） -->
    <NodeBrandKit v-if="kit && !g.isText" :node-id="g.id" :data="g.data" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import { CANVAS_BRAND_KIT_KEY } from '@/composables/canvasBrandKitKey'
import NodeBrandKit from '../NodeBrandKit.vue'

/**
 * 提示词和工具条之间的那几行说明：报错、运行前提示、文本拼接顺序、品牌包。
 * 三种布局都把它放在「改设置的地方」—— a 的输入条、b 的属性面板、c 的节点里。
 */
const props = defineProps<{
  /** 带不带品牌包那一行 */
  kit?: boolean
  /** 节点里地方小：长说明收成三行 */
  tight?: boolean
}>()
const { t } = useI18n()
const g = useGenNodeState()
const kits = inject(CANVAS_BRAND_KIT_KEY, undefined)

// 品牌包那一行自己会在「一个品牌包都没有、节点也没有例外」时不出现，这里按同一个条件决定整块要不要占位
const kitLine = computed(() => {
  if (!props.kit || g.isText || !kits) return false
  return kits.list.value.length > 0 || !!kits.resolve(g.data).own
})
const show = computed(() => !!g.displayError || g.notices.length > 0 || g.textInputs.length > 1 || kitLine.value)
</script>
