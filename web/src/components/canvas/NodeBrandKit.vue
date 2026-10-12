<template>
  <!-- 表头上的小标记：只有这个节点跟画布不一样时才出现 -->
  <span v-if="showMark" class="cv-kit-mark" :class="{ off: !choice.kit }" :title="markTip" :aria-label="markTip" role="img" data-testid="kit-mark">
    <LcIcon name="star" size="s" />
  </span>

  <!-- 改提示词的地方的一行：这次运行套用哪个品牌包、会加什么、这个节点要不要例外 -->
  <div v-else-if="showLine" class="cv-kit" data-testid="kit-line">
    <div class="cv-kit-row">
      <button v-if="shown" type="button" class="cv-kit-t on" :aria-expanded="open" data-testid="kit-applied" @click.stop="open = !open">
        <BrandKitThumbs :images="shown.kit.refImages" />
        <span class="cv-kit-name">{{ choice.own ? t('brandKit.node.appliedOwn', { name: shown.kit.name }) : t('brandKit.node.applied', { name: shown.kit.name }) }}</span>
        <span class="cv-kit-more">{{ open ? t('brandKit.node.hide') : t('brandKit.node.show') }}</span>
      </button>
      <span v-else class="cv-kit-t">{{ idleText }}</span>
      <ChipSelect :label="t('brandKit.node.scope')" v-model="override" :options="options" :display-value="overrideLabel" :title="t('brandKit.node.menuTitle')" />
    </div>

    <div v-if="open && shown" class="cv-kit-pre" data-testid="kit-preview">
      <div class="cv-kit-h">{{ t('brandKit.preview.title') }}</div>
      <template v-if="shown.effect.prefix">
        <div class="cv-kit-k">{{ t('brandKit.preview.prefix') }}</div>
        <div class="cv-kit-q nowheel" data-part="prefix">{{ shown.effect.prefix }}</div>
      </template>
      <template v-if="shown.effect.suffix">
        <div class="cv-kit-k">{{ t('brandKit.preview.suffix') }}</div>
        <div class="cv-kit-q nowheel" data-part="suffix">{{ shown.effect.suffix }}</div>
      </template>
      <template v-if="shown.effect.addedImages.length">
        <div class="cv-kit-k">{{ t('brandKit.preview.images', { n: shown.effect.addedImages.length }, shown.effect.addedImages.length) }}</div>
        <div class="cv-kit-imgs" data-part="images">
          <img v-for="u in shown.effect.addedImages" :key="u" :src="canvasImageThumb(u, 96)" alt="" loading="lazy" />
        </div>
      </template>
      <div v-if="shown.effect.skippedImages.length" class="cv-kit-skip" data-part="skipped">{{ skippedText }}</div>
      <div v-if="nothing" class="cv-kit-skip">{{ t('brandKit.preview.nothing') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 生成节点上跟品牌包有关的两样东西，节点本体里不放任何品牌包控件：
 *  - mark：表头上的小图标，只在这个节点没跟随画布时出现（悬停说明是哪种例外）
 *  - 默认：改提示词的地方（布局 a 的输入条 / b 的属性面板 / c 的节点内，见 gen/GenNotes.vue）的一行，写明这次运行套用哪个品牌包，点开能看到会原样加上的文字和参考图，
 *    右边可以让这个节点例外（跟随画布 / 此节点不套用 / 单独用另一个）
 *
 * 「会加什么」直接问执行器（executor.brandKitEffect），那是提交时用的同一份推导，不是另算的一份。
 */
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import ChipSelect from '@/components/canvas/ChipSelect.vue'
import BrandKitThumbs from '@/components/brandkit/BrandKitThumbs.vue'
import { CANVAS_BRAND_KIT_KEY } from '@/composables/canvasBrandKitKey'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { KIT_NONE } from '@/composables/useBrandKits'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { getAdapter } from '@/utils/canvasModels'

const { t } = useI18n()

const props = defineProps<{ nodeId: string; data: any; mark?: boolean }>()

const ctx = inject(CANVAS_BRAND_KIT_KEY, undefined)
const executor = inject(CANVAS_EXECUTOR_KEY, undefined)

const kits = computed(() => ctx?.list.value || [])
const choice = computed(() => ctx?.resolve(props.data) || { kit: null, own: false, missing: false })

/** 一个品牌包都没有、节点也没有例外：整行不出现，面板保持原样 */
const showLine = computed(() => !props.mark && !!ctx && (kits.value.length > 0 || choice.value.own))

/** 现在运行的话会套用的品牌包，以及它会加什么 */
const shown = computed(() => (choice.value.kit ? executor?.brandKitEffect(props.nodeId) || null : null))
const nothing = computed(() => {
  const e = shown.value?.effect
  return !!e && !e.prefix && !e.suffix && !e.addedImages.length && !e.skippedImages.length
})
const open = ref(false)

const idleText = computed(() => {
  if (choice.value.missing) return t('brandKit.node.missingLine')
  if (choice.value.own) return t('brandKit.node.offLine')
  return t('brandKit.node.notApplied')
})

const skippedText = computed(() => {
  const e = shown.value?.effect
  if (!e) return ''
  const n = e.skippedImages.length
  const a = getAdapter(props.data?.model || '')
  const model = a?.label || t('brandKit.preview.thisModel')
  if (e.skipReason === 'frames') return t('brandKit.preview.skippedFrames', { n }, n)
  if (e.skipReason === 'noRefs') return t('brandKit.preview.skippedNoRefs', { n, model }, n)
  return t('brandKit.preview.skippedFull', { n, model, max: a?.options.maxReferenceImages || 0 })
})

/* ── 这个节点的例外 ── */
const canvasKit = computed(() => kits.value.find((k) => k.id === ctx?.canvasKitId.value) || null)
const override = computed<string>({
  get: () => (typeof props.data?.brandKitOverride === 'string' ? props.data.brandKitOverride : ''),
  set: (v) => ctx?.setNodeOverride(props.nodeId, v),
})
const options = computed(() => [
  { value: '', label: canvasKit.value ? t('brandKit.node.followWith', { name: canvasKit.value.name }) : t('brandKit.node.followNone') },
  { value: KIT_NONE, label: t('brandKit.node.off') },
  ...kits.value.map((k) => ({ value: k.id, label: t('brandKit.node.useKit', { name: k.name }) })),
])
const overrideLabel = computed(() => {
  if (!override.value) return t('brandKit.node.follow')
  if (override.value === KIT_NONE) return t('brandKit.pop.none')
  return choice.value.kit?.name || t('brandKit.pop.none')
})

const markTip = computed(() => {
  if (choice.value.missing) return t('brandKit.node.markMissing')
  return choice.value.kit ? t('brandKit.node.markKit', { name: choice.value.kit.name }) : t('brandKit.node.markOff')
})
const showMark = computed(() => !!props.mark && !!ctx && choice.value.own)
</script>

<style scoped>
/* 表头标记：跟在标题后面，弱化；「不套用」时划一道斜线 */
.cv-kit-mark {
  position: relative; flex: none; width: 18px; height: 18px; display: grid; place-items: center;
  border-radius: 5px; color: var(--cyan-soft); background: rgb(var(--c-cyan) / .12);
}
.cv-kit-mark :deep(svg) { width: 12px; height: 12px; }
.cv-kit-mark.off { color: var(--text-3); background: rgb(var(--c-film) / .12); }
.cv-kit-mark.off::after {
  content: ''; position: absolute; left: 3px; right: 3px; top: 50%; height: 1.5px; border-radius: 1px;
  background: currentColor; transform: rotate(-45deg);
}

.cv-kit { display: grid; gap: 8px; min-width: 0; }
/* 放不下时「此节点」那颗下拉换到下一行，名字不被挤没 */
.cv-kit-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; min-width: 0; min-height: 24px; }
.cv-kit-t {
  flex: 1 1 220px; min-width: 0; display: inline-flex; align-items: center; gap: 6px; padding: 0;
  border: 0; background: none; color: var(--text-3); font: inherit; font-size: 12px; text-align: left;
}
button.cv-kit-t { cursor: pointer; color: var(--text-2); }
.cv-kit-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.cv-kit-more { flex: none; color: var(--cyan-soft); font-size: 11px; white-space: nowrap; }
button.cv-kit-t:hover .cv-kit-more { text-decoration: underline; text-underline-offset: 3px; }
button.cv-kit-t:focus-visible { outline: none; box-shadow: var(--ring); border-radius: 6px; }

.cv-kit-pre {
  display: grid; gap: 6px; padding: 10px; border-radius: 10px;
  border: 1px solid var(--line); background: rgb(var(--c-well) / .3);
}
.cv-kit-h { font-size: 12px; font-weight: 600; color: var(--text); }
.cv-kit-k { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.cv-kit-q {
  padding: 6px 8px; border-radius: 6px; background: var(--well); border-left: 2px solid var(--cyan);
  color: var(--text); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;
  max-height: 96px; overflow-y: auto; user-select: text; cursor: text;
}
.cv-kit-imgs { display: flex; flex-wrap: wrap; gap: 6px; }
.cv-kit-imgs img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: var(--media-bg); border: 1px solid var(--line); }
.cv-kit-skip { font-size: 11px; line-height: 1.6; color: var(--text-3); }
</style>
