<template>
  <!-- 压在画面上的一排 v3 v2 v1 -->
  <div v-if="variant === 'chips'" class="gf-vers nodrag nowheel" :title="t('gen.history.hint', { n: g.versions.length })" @click.stop @mousedown.stop @wheel.stop>
    <button
      v-for="v in g.versions" :key="v.index" type="button"
      :class="{ on: v.active }" :title="v.title" data-testid="gen-version"
      @click.stop="g.selectVersion(v.index)"
    >v{{ v.n }}<i v-if="v.count > 1">×{{ v.count }}</i></button>
  </div>

  <!-- 属性面板里：每一版一张缩略图 -->
  <div v-else class="gf-vth nodrag">
    <button
      v-for="v in g.versions" :key="v.index" type="button"
      :class="{ on: v.active }" :title="v.title" data-testid="gen-version"
      @click.stop="g.selectVersion(v.index)"
    >
      <img v-if="thumbOf(v.thumb)" :src="thumbOf(v.thumb)" alt="" loading="lazy" />
      <em>v{{ v.n }}<template v-if="v.count > 1"> ×{{ v.count }}</template></em>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import { canvasImageThumb, canvasVideoPoster } from '@/utils/canvasMedia'

/**
 * 历史版本：重跑一次不覆盖上一版，在这里切换当前展示的是哪一版。
 * 只在版本数 > 1 时由调用方渲染。
 */
defineProps<{ variant: 'chips' | 'thumbs' }>()
const { t } = useI18n()
const g = useGenNodeState()
const thumbOf = (url: string) => (g.media === 'video' ? canvasVideoPoster(url, 96) : canvasImageThumb(url, 96))
</script>
