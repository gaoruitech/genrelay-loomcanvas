<template>
  <div class="bkp" data-testid="kit-preview">
    <div class="bkp-h">{{ t('brandKit.preview.title') }}</div>
    <template v-if="effect.prefix">
      <div class="bkp-k">{{ t('brandKit.preview.prefix') }}</div>
      <div class="bkp-q nowheel" data-part="prefix">{{ effect.prefix }}</div>
    </template>
    <template v-if="effect.suffix">
      <div class="bkp-k">{{ t('brandKit.preview.suffix') }}</div>
      <div class="bkp-q nowheel" data-part="suffix">{{ effect.suffix }}</div>
    </template>
    <template v-if="effect.addedImages.length">
      <div class="bkp-k">{{ t('brandKit.preview.images', { n: effect.addedImages.length }, effect.addedImages.length) }}</div>
      <div class="bkp-imgs" data-part="images">
        <img v-for="u in effect.addedImages" :key="u" :src="canvasImageThumb(u, 96)" alt="" loading="lazy" />
      </div>
    </template>
    <div v-if="skipped" class="bkp-skip" data-part="skipped"><LcIcon name="warn" size="s" /><span>{{ skipped }}</span></div>
    <div v-if="nothing" class="bkp-none">{{ t('brandKit.preview.nothing') }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「这次运行品牌包会加什么」：加在提示词前后的文字、追加的参考图，以及不会发出去的参考图和原因。
 * 内容来自执行器提交时用的同一份推导（executor.brandKitEffect），这里只管画。
 * 节点上的两个地方共用：改提示词处的那一行（展开后）和表头标记点开的小面板。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import type { BrandKitEffect } from '@/composables/useBrandKits'
import { canvasImageThumb } from '@/utils/canvasMedia'

const props = defineProps<{
  effect: BrandKitEffect
  /** 「N 张参考图不会发出：……」整句；没有被跳过的图就是空串 */
  skipped?: string
}>()
const { t } = useI18n()
const nothing = computed(() => {
  const e = props.effect
  return !e.prefix && !e.suffix && !e.addedImages.length && !e.skippedImages.length
})
</script>

<style scoped>
.bkp {
  display: grid; gap: 6px; padding: 10px; border-radius: 10px;
  border: 1px solid var(--line); background: rgb(var(--c-well) / .3);
}
.bkp-h { font-size: 12px; font-weight: 600; color: var(--text); }
.bkp-k { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.bkp-q {
  padding: 6px 8px; border-radius: 6px; background: var(--well); border-left: 2px solid var(--cyan);
  color: var(--text); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;
  max-height: 96px; overflow-y: auto; user-select: text; cursor: text;
}
.bkp-imgs { display: flex; flex-wrap: wrap; gap: 6px; }
.bkp-imgs img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: var(--media-bg); border: 1px solid var(--line); }
.bkp-skip { display: flex; gap: 6px; font-size: 11px; line-height: 1.6; color: var(--alert-warn-fg); }
.bkp-skip :deep(svg) { flex: none; width: 13px; height: 13px; margin-top: 2px; color: var(--warn); }
.bkp-none { font-size: 11px; line-height: 1.6; color: var(--text-3); }
</style>
