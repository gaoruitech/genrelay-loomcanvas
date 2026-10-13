<template>
  <!-- 工具条里：一颗「比例 · 分辨率 · 时长 · 数量」chip，点开在弹层里改；视频生成另有一颗「模式」
       （节点里那一行地方窄：chip-sm 不另起一颗，「模式」收在同一个弹层的最上面） -->
  <!-- 只读：参数是一段字（工具条里一句摘要，属性面板里一项一行），不是能点开的 chip / 分段按钮 -->
  <template v-if="g.viewOnly">
    <span v-if="variant !== 'form' && roLine" v-tip="{ text: roLine, clipped: true }" class="gf-ro" :class="variant" data-testid="gen-params">{{ roLine }}</span>
    <dl v-else-if="variant === 'form' && roRows.length" class="gf-kv" data-testid="gen-params">
      <template v-for="r in roRows" :key="r.k"><dt>{{ r.k }}</dt><dd>{{ r.v }}</dd></template>
    </dl>
  </template>
  <template v-else-if="variant !== 'form'">
    <div v-if="g.adapter && g.imgModes.length && variant === 'chip'" class="gf-chip nodrag" :class="variant" data-testid="gen-mode" @click.stop @mousedown.stop>
      <ChipSelect v-model="g.imgMode" :options="g.imgModes" :title="t('gen.node.mode')" />
    </div>
    <div v-if="g.adapter" class="gf-chip nodrag" :class="variant" data-testid="gen-params" @click.stop @mousedown.stop>
      <ImageParamsChip
        :resolutions="g.adapter.options.resolutions"
        :aspect-ratios="g.adapter.options.aspectRatios"
        :durations="g.media === 'video' ? g.adapter.options.durations : undefined"
        :fixed-duration="g.media === 'video' ? g.adapter.options.fixedDuration : undefined"
        :counts="g.adapter.options.counts"
        :modes="variant === 'chip-sm' ? g.imgModes : undefined"
        :compact="compact"
        v-model:mode="g.imgMode"
        v-model:resolution="g.resolution"
        v-model:aspect-ratio="g.aspectRatio"
        v-model:duration="g.duration"
        v-model:count="g.count"
      />
    </div>
  </template>

  <!-- 属性面板里：每一项完整铺开 -->
  <template v-else-if="g.adapter">
    <div v-if="g.imgModes.length" class="gf-fl" data-testid="gen-mode">
      <label>{{ t('gen.node.mode') }}</label>
      <div class="gf-seg"><button v-for="o in g.imgModes" :key="String(o.value)" type="button" :class="{ on: String(o.value) === String(g.imgMode) }" @click="g.imgMode = String(o.value)">{{ o.label }}</button></div>
    </div>
    <div v-if="g.adapter.options.aspectRatios.length" class="gf-fl" data-testid="gen-ratio">
      <label>{{ t('nodes.field.aspectRatio') }}</label>
      <div class="gf-seg"><button v-for="o in g.adapter.options.aspectRatios" :key="String(o.value)" type="button" :class="{ on: String(o.value) === String(g.aspectRatio) }" @click="g.aspectRatio = String(o.value)">{{ o.label }}</button></div>
    </div>
    <div class="gf-g2">
      <div v-if="g.adapter.options.resolutions?.length" class="gf-fl" data-testid="gen-resolution">
        <label>{{ t('nodes.field.resolution') }}</label>
        <div class="gf-seg"><button v-for="o in g.adapter.options.resolutions" :key="String(o.value)" type="button" :class="{ on: String(o.value) === String(g.resolution) }" @click="g.resolution = String(o.value)">{{ o.label }}</button></div>
      </div>
      <div v-if="g.media === 'video' && g.adapter.options.durations?.length" class="gf-fl" data-testid="gen-duration">
        <label>{{ t('nodes.field.duration') }}</label>
        <div class="gf-seg"><button v-for="o in g.adapter.options.durations" :key="String(o.value)" type="button" :class="{ on: Number(o.value) === Number(g.duration) }" @click="g.duration = Number(o.value)">{{ o.label }}</button></div>
      </div>
      <div v-if="g.adapter.options.counts?.length" class="gf-fl" data-testid="gen-count">
        <label>{{ t('nodes.field.count') }}</label>
        <div class="gf-seg"><button v-for="o in g.adapter.options.counts" :key="String(o.value)" type="button" :class="{ on: Number(o.value) === Number(g.count) }" @click="g.count = Number(o.value)">{{ o.label }}</button></div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import { clipLength } from '@/utils/duration'
import ChipSelect from '../ChipSelect.vue'
import ImageParamsChip from '../ImageParamsChip.vue'

/** 出图 / 出片的参数。文本类节点没有参数，整块不渲染 */
defineProps<{
  variant: 'chip' | 'chip-sm' | 'form'
  /** 那一行还是放不下：参数 chip 只写第一项 + 「+N」 */
  compact?: boolean
}>()
const { t } = useI18n()
const g = useGenNodeState()

/* ── 只读时的写法 ── */
/** 工具条里的一句：「模式 · 比例 · 分辨率 · 时长 · ×数量」，和节点摘要是同一句（多一个模式） */
const roLine = computed(() => (g.isText ? '' : [g.modeLabel, g.paramsSummary].filter(Boolean).join(' · ')))
/** 属性面板里一项一行；用模型选项表里的叫法，查不到（模型已经不在清单里）就原样 */
const roRows = computed<{ k: string; v: string }[]>(() => {
  if (g.isText) return []
  const o = g.adapter?.options
  const rows: { k: string; v: string }[] = []
  if (g.modeLabel) rows.push({ k: t('gen.node.mode'), v: g.modeLabel })
  const ratio = o?.aspectRatios.find(x => String(x.value) === String(g.aspectRatio))?.label || (g.aspectRatio === 'auto' ? t('models.auto') : g.aspectRatio)
  if (ratio) rows.push({ k: t('nodes.field.aspectRatio'), v: String(ratio) })
  const res = o?.resolutions?.find(x => String(x.value) === String(g.resolution))?.label || g.resolution
  if (res) rows.push({ k: t('nodes.field.resolution'), v: String(res) })
  if (g.media === 'video' && g.duration) rows.push({ k: t('nodes.field.duration'), v: clipLength(g.duration) })
  if (g.count > 1) rows.push({ k: t('nodes.field.count'), v: `×${g.count}` })
  return rows
})
</script>
