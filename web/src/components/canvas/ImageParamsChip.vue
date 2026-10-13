<template>
  <ChipSelect label="" :display-value="shown" :title="compact ? `${t('gen.params.title')} · ${full}` : t('gen.params.title')">
    <template #menu>
      <div class="cv-pp">
        <!-- 地方窄的时候（布局 c 的那一行）「模式」不另起一颗 chip，收在这里 -->
        <template v-if="modes && modes.length">
          <div class="cv-pp-label">{{ t('gen.node.mode') }}</div>
          <div class="cv-pp-row" data-testid="gen-mode-row">
            <button
              v-for="m in modes"
              :key="String(m.value)"
              type="button"
              class="cv-pp-pill"
              :class="{ active: String(m.value) === String(mode) }"
              @click.stop="$emit('update:mode', String(m.value))"
            >{{ m.label }}</button>
          </div>
        </template>

        <div class="cv-pp-label">{{ t('nodes.field.aspectRatio') }}</div>
        <div class="cv-pp-grid">
          <button
            v-for="a in aspectRatios"
            :key="String(a.value)"
            type="button"
            class="cv-pp-cell"
            :class="{ active: String(a.value) === String(aspectRatio) }"
            @click.stop="$emit('update:aspectRatio', a.value)"
          >
            <span class="cv-pp-shape" :style="shapeStyle(String(a.value))" />
            <span class="cv-pp-cap">{{ a.label }}</span>
          </button>
        </div>

        <template v-if="resolutions && resolutions.length">
          <div class="cv-pp-label">{{ t('nodes.field.resolution') }}</div>
          <div class="cv-pp-row">
            <button
              v-for="r in resolutions"
              :key="String(r.value)"
              type="button"
              class="cv-pp-pill"
              :class="{ active: String(r.value) === String(resolution) }"
              @click.stop="$emit('update:resolution', r.value)"
            >{{ r.label }}</button>
          </div>
        </template>

        <template v-if="durations && durations.length">
          <div class="cv-pp-label">{{ t('nodes.field.duration') }}</div>
          <div class="cv-pp-row cv-pp-wrap">
            <button
              v-for="d in durations"
              :key="String(d.value)"
              type="button"
              class="cv-pp-pill"
              :class="{ active: String(d.value) === String(duration) }"
              @click.stop="$emit('update:duration', d.value)"
            >{{ d.label }}</button>
          </div>
        </template>

        <template v-if="counts && counts.length">
          <div class="cv-pp-label">{{ t('nodes.field.count') }}</div>
          <div class="cv-pp-stepper">
            <button type="button" class="cv-pp-step" :disabled="countIdx <= 0" @click.stop="stepCount(-1)">−</button>
            <span class="cv-pp-count">{{ count ?? counts[0].value }}</span>
            <button type="button" class="cv-pp-step" :disabled="countIdx >= counts.length - 1" @click.stop="stepCount(1)">＋</button>
          </div>
        </template>
      </div>
    </template>
  </ChipSelect>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import ChipSelect from './ChipSelect.vue'
import type { ModelOption } from '@/utils/canvasModels'
import { clipLength } from '@/utils/duration'

const { t } = useI18n()

const props = defineProps<{
  resolutions?: ModelOption[]
  aspectRatios: ModelOption[]
  resolution?: string
  aspectRatio?: string
  counts?: ModelOption<number>[]
  count?: number
  durations?: ModelOption<number>[]
  duration?: number
  fixedDuration?: number
  /** 图片输入模式（多图参考 / 首尾帧）；给了就在弹层最上面多一组 */
  modes?: ModelOption[]
  mode?: string
  /** 放不下时的短写法：只写第一项，其余记成「+N」，完整的在悬停提示里 */
  compact?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:resolution', v: string): void
  (e: 'update:aspectRatio', v: string): void
  (e: 'update:count', v: number): void
  (e: 'update:duration', v: number): void
  (e: 'update:mode', v: string): void
}>()

const parts = computed(() => {
  const a = props.aspectRatios.find(x => String(x.value) === String(props.aspectRatio))?.label
    || props.aspectRatio || t('models.auto')
  const parts = [a]
  const r = props.resolutions?.find(x => String(x.value) === String(props.resolution))?.label
  if (r) parts.push(r)
  // 片长的写法和节点摘要、队列、生成记录是同一份（utils/duration.ts）
  if (props.durations && props.durations.length && props.duration != null) parts.push(clipLength(props.duration))
  else if (props.fixedDuration != null) parts.push(clipLength(props.fixedDuration))
  if (props.counts && props.counts.length) parts.push(`×${props.count ?? props.counts[0].value}`)
  return parts.map(String)
})
const full = computed(() => parts.value.join(' · '))
const shown = computed(() => (props.compact && parts.value.length > 1 ? `${parts.value[0]} +${parts.value.length - 1}` : full.value))

const countIdx = computed(() => {
  if (!props.counts) return 0
  const i = props.counts.findIndex(c => Number(c.value) === Number(props.count ?? props.counts![0].value))
  return i < 0 ? 0 : i
})
function stepCount(dir: number) {
  if (!props.counts || !props.counts.length) return
  const next = Math.max(0, Math.min(props.counts.length - 1, countIdx.value + dir))
  emit('update:count', Number(props.counts[next].value))
}

// 比例缩略形状：按 W:H 缩放到 ≤18px；auto/无冒号用正方形
function shapeStyle(v: string): CSSProperties {
  const MAX = 18
  if (!v.includes(':')) return { width: '15px', height: '15px' }
  const [w, h] = v.split(':').map(Number)
  if (!w || !h) return { width: '15px', height: '15px' }
  if (w >= h) return { width: `${MAX}px`, height: `${Math.max(6, Math.round(MAX * h / w))}px` }
  return { width: `${Math.max(6, Math.round(MAX * w / h))}px`, height: `${MAX}px` }
}
</script>

<style scoped>
.cv-pp { display: flex; flex-direction: column; gap: 8px; padding: 6px 4px; width: 276px; max-width: calc(calc(100 * var(--lc-vw)) - 40px); }
.cv-pp-label { font-size: 12px; color: var(--text-3); padding: 0 2px; margin-top: 2px; }
.cv-pp-row { display: flex; gap: 6px; padding: 0 2px; }
.cv-pp-wrap { flex-wrap: wrap; }
.cv-pp-pill,
.cv-pp-cell {
  background: var(--well);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
.cv-pp-pill { flex: 1; min-width: 44px; height: 30px; padding: 0 6px; font-size: 12px; }
.cv-pp-pill:hover,
.cv-pp-cell:hover { border-color: var(--line-3); color: var(--text); }
.cv-pp-pill.active,
.cv-pp-cell.active { background: rgb(var(--c-blue) / .28); border-color: var(--line-3); color: var(--text); }
.cv-pp-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; padding: 0 2px; }
.cv-pp-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 54px;
  font-size: 10.5px;
  font-family: var(--f-mono);
  color: var(--text-3);
}
.cv-pp-cell.active .cv-pp-shape { border-color: var(--cyan); }
.cv-pp-shape { display: block; border: 1.6px solid currentColor; border-radius: 2px; }
.cv-pp-cap { line-height: 1; }
.cv-pp-stepper { display: flex; align-items: center; gap: 10px; padding: 0 2px; }
.cv-pp-step {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--well);
  border: 1px solid var(--line);
  color: var(--text);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.cv-pp-step:hover:not(:disabled) { border-color: var(--line-3); }
.cv-pp-step:disabled { opacity: .4; cursor: not-allowed; }
.cv-pp-count { min-width: 24px; text-align: center; font: 500 13px var(--f-mono); color: var(--text); }
</style>
