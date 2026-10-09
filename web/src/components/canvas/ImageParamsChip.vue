<template>
  <ChipSelect label="" :display-value="display" :title="t('gen.params.title')">
    <template #menu>
      <div class="cv-pp">
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
}>()

const emit = defineEmits<{
  (e: 'update:resolution', v: string): void
  (e: 'update:aspectRatio', v: string): void
  (e: 'update:count', v: number): void
  (e: 'update:duration', v: number): void
}>()

const display = computed(() => {
  const a = props.aspectRatios.find(x => String(x.value) === String(props.aspectRatio))?.label
    || props.aspectRatio || t('models.auto')
  const parts = [a]
  const r = props.resolutions?.find(x => String(x.value) === String(props.resolution))?.label
  if (r) parts.push(r)
  if (props.durations && props.durations.length && props.duration != null) parts.push(`${props.duration}s`)
  else if (props.fixedDuration != null) parts.push(`${props.fixedDuration}s`)
  if (props.counts && props.counts.length) parts.push(`×${props.count ?? props.counts[0].value}`)
  return parts.join(' · ')
})

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
.cv-pp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 4px;
  min-width: 268px;
}
.cv-pp-label {
  font-size: 11px;
  color: var(--t-dim);
  padding: 0 4px;
  margin-top: 2px;
}
.cv-pp-row {
  display: flex;
  gap: 8px;
  padding: 0 2px;
}
.cv-pp-wrap { flex-wrap: wrap; }
.cv-pp-pill {
  flex: 1;
  min-width: 44px;
  padding: 7px 0;
  background: var(--n-5);
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--t-body);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.cv-pp-pill:hover { background: var(--n-6); }
.cv-pp-pill.active {
  background: var(--n-7);
  border-color: var(--accent-text);
  color: var(--t-max);
}
.cv-pp-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  padding: 0 2px;
}
.cv-pp-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 56px;
  background: var(--n-5);
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--t-dim);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.cv-pp-cell:hover { background: var(--n-6); }
.cv-pp-cell.active {
  background: var(--n-7);
  border-color: var(--accent-text);
  color: var(--t-max);
}
.cv-pp-shape {
  display: block;
  border: 1.6px solid currentColor;
  border-radius: 2px;
  opacity: 0.9;
}
.cv-pp-cap { line-height: 1; }
.cv-pp-stepper {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px;
}
.cv-pp-step {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--n-5);
  border: 1px solid transparent;
  color: var(--t-body);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s ease;
}
.cv-pp-step:hover:not(:disabled) { background: var(--n-7); }
.cv-pp-step:disabled { opacity: 0.4; cursor: not-allowed; }
.cv-pp-count {
  min-width: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--t-max);
  font-variant-numeric: tabular-nums;
}
</style>
