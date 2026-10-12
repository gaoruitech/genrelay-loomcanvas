<template>
  <!-- 工具条里：一颗「比例 · 分辨率 · 时长 · 数量」chip，点开在弹层里改；视频生成另有一颗「模式」 -->
  <template v-if="variant !== 'form'">
    <div v-if="g.adapter && g.imgModes.length" class="gf-chip nodrag" :class="variant" data-testid="gen-mode" @click.stop @mousedown.stop>
      <ChipSelect v-model="g.imgMode" :options="g.imgModes" :title="t('gen.node.mode')" />
    </div>
    <div v-if="g.adapter" class="gf-chip nodrag" :class="variant" data-testid="gen-params" @click.stop @mousedown.stop>
      <ImageParamsChip
        :resolutions="g.adapter.options.resolutions"
        :aspect-ratios="g.adapter.options.aspectRatios"
        :durations="g.media === 'video' ? g.adapter.options.durations : undefined"
        :fixed-duration="g.media === 'video' ? g.adapter.options.fixedDuration : undefined"
        :counts="g.adapter.options.counts"
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
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import ChipSelect from '../ChipSelect.vue'
import ImageParamsChip from '../ImageParamsChip.vue'

/** 出图 / 出片的参数。文本类节点没有参数，整块不渲染 */
defineProps<{ variant: 'chip' | 'chip-sm' | 'form' }>()
const { t } = useI18n()
const g = useGenNodeState()
</script>
