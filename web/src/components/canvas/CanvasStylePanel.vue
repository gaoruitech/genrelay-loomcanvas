<template>
  <div
    v-if="open"
    class="cs-panel"
    :style="{ left: x + 'px', top: y + 'px' }"
    role="dialog"
    :aria-label="t('dialogs.bg.title')"
    @mousedown.stop
    @click.stop
    @wheel.stop
  >
    <div class="cs-head">
      <span>{{ t('dialogs.bg.title') }}</span>
      <button class="lc-tb sm" :title="t('common.close')" :aria-label="t('common.close')" @click="$emit('close')">
        <LcIcon name="x" size="s" />
      </button>
    </div>

    <div class="cs-field">
      <div class="cs-label">{{ t('dialogs.bg.color') }}</div>
      <div class="cs-swatches">
        <button
          v-for="p in CANVAS_BG_PRESETS"
          :key="p.value"
          class="cs-sw"
          :class="{ auto: p.value === 'auto', on: bg.color === p.value }"
          :style="p.value === 'auto' ? undefined : { background: p.value }"
          :title="presetLabel(p)"
          :aria-label="presetLabel(p)"
          :aria-pressed="bg.color === p.value"
          @click="setColor(p.value)"
        />
      </div>
      <div class="cs-row">
        <label class="cs-custom">
          <input type="color" :value="pickerValue" @input="onPick" />
          <span>{{ t('dialogs.bg.custom') }}</span>
        </label>
        <span class="cs-hex">{{ bg.color === 'auto' ? autoLabel : bg.color.toUpperCase() }}</span>
      </div>
    </div>

    <div class="cs-field">
      <div class="cs-label">{{ t('dialogs.bg.pattern') }}</div>
      <div class="lc-seg cs-pats">
        <button
          v-for="p in CANVAS_BG_PATTERNS"
          :key="p.value"
          :class="{ on: bg.pattern === p.value }"
          @click="patch({ pattern: p.value })"
        >{{ p.label }}</button>
      </div>
    </div>

    <div class="cs-field" :class="{ disabled: bg.pattern === 'none' }">
      <div class="cs-label">{{ t('dialogs.bg.density') }}</div>
      <input
        type="range"
        class="cs-range"
        :min="CANVAS_BG_GAP_MIN"
        :max="CANVAS_BG_GAP_MAX"
        step="4"
        :value="bg.gap"
        :disabled="bg.pattern === 'none'"
        :aria-label="t('dialogs.bg.gapAria')"
        :style="{ '--v': rangePct + '%' }"
        @input="onGap"
      />
      <div class="cs-row">
        <span class="cs-dim">{{ t('dialogs.bg.gap') }}</span>
        <span class="cs-hex">{{ bg.gap }} px</span>
      </div>
    </div>

    <div class="cs-foot">
      <span class="cs-dim">{{ t('dialogs.bg.autoSaved') }}</span>
      <button class="lc-btn sm" :disabled="isDefault" @click="reset">{{ t('dialogs.bg.restoreDefault') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import {
  CANVAS_BG_PRESETS,
  CANVAS_BG_PATTERNS,
  CANVAS_BG_GAP_MIN,
  CANVAS_BG_GAP_MAX,
  DEFAULT_CANVAS_BG,
  isDefaultCanvasBg,
  isHexColor,
  type CanvasBgSettings,
} from '@/utils/canvasBg'
import { useTokenColor } from '@/utils/tokenColor'
import { resolvedTheme } from '@/composables/useTheme'

const props = defineProps<{
  open: boolean
  bg: CanvasBgSettings
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'update:bg', v: CanvasBgSettings): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const isDefault = computed(() => isDefaultCanvasBg(props.bg))

// 'auto' 这一档是编辑器的默认底，跟着主题走：深色主题是深蓝 + 点阵，浅色主题是浅蓝灰 + 点阵
const autoLabel = computed(() => (resolvedTheme.value === 'light' ? t('canvas.style.autoLight') : t('canvas.style.auto')))
function presetLabel(p: { value: string; label: string }) {
  return p.value === 'auto' ? autoLabel.value : p.label
}

// <input type="color"> 不接受 'auto'，默认底时把当前主题的默认底色（令牌 --flow-bg）给它当起点
const autoHex = useTokenColor('--flow-bg')
const pickerValue = computed(() => (isHexColor(props.bg.color) ? props.bg.color : autoHex.value))

const rangePct = computed(() =>
  Math.round(((props.bg.gap - CANVAS_BG_GAP_MIN) / (CANVAS_BG_GAP_MAX - CANVAS_BG_GAP_MIN)) * 100))

function patch(part: Partial<CanvasBgSettings>) {
  emit('update:bg', { ...props.bg, ...part })
}
function setColor(color: string) {
  patch({ color })
}
function onPick(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (isHexColor(v)) patch({ color: v })
}
function onGap(e: Event) {
  patch({ gap: Number((e.target as HTMLInputElement).value) })
}
function reset() {
  emit('update:bg', { ...DEFAULT_CANVAS_BG })
}
</script>

<style scoped>
.cs-panel {
  position: fixed;
  z-index: 60;
  width: 272px;
  max-width: calc(calc(100 * var(--lc-vw)) - 24px);
  max-height: calc(calc(100 * var(--lc-vh)) - 24px);
  overflow-y: auto;
  padding: 14px;
  background: rgb(var(--c-glass) / .94);
  border: 1px solid var(--line-2);
  border-radius: 14px;
  box-shadow: var(--sh-2);
  color: var(--text-2);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.cs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: 600 14px/1.4 var(--f-disp);
  color: var(--text);
  margin-bottom: 12px;
}

.cs-field { margin-bottom: 16px; }
.cs-field.disabled { opacity: .45; }
.cs-label { font-size: 12px; color: var(--text-3); margin-bottom: 8px; }
.cs-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.cs-sw {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid var(--line-2);
  cursor: pointer;
  padding: 0;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.cs-sw:hover { border-color: var(--line-3); }
/* 默认档：当前主题的默认底 + 点阵，和画布上看到的是同一个样子 */
.cs-sw.auto {
  background-color: var(--flow-bg);
  background-image: radial-gradient(rgb(var(--c-film) / .55) 1px, transparent 1px);
  background-size: 6px 6px;
  background-position: 2px 2px;
}
.cs-sw.on { border-color: var(--cyan); box-shadow: var(--ring); }
.cs-sw:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }

.cs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}
.cs-custom {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}
.cs-custom input[type='color'] {
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.cs-hex {
  font: 500 11px/1 var(--f-mono);
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--well);
  border: 1px solid var(--line);
  color: var(--text-2);
  white-space: nowrap;
}
.cs-dim { font-size: 12px; color: var(--text-3); }

.cs-pats { display: flex; width: 100%; }
.cs-pats > button { flex: 1 1 0; justify-content: center; padding: 0 4px; font-size: 12px; }

/* 滑块：已走过的一段用渐变，剩下的是细线 */
.cs-range {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 16px; margin: 0; background: none; cursor: pointer;
}
.cs-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: linear-gradient(90deg, var(--cyan), var(--blue) var(--v, 50%), rgb(var(--c-film) / .2) var(--v, 50%));
}
.cs-range::-moz-range-track { height: 4px; border-radius: 2px; background: rgb(var(--c-film) / .2); }
.cs-range::-moz-range-progress { height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--cyan), var(--blue)); }
.cs-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; margin-top: -5px; border-radius: 50%;
  background: var(--slider-thumb); border: 2px solid var(--cyan);
}
.cs-range::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--slider-thumb); border: 2px solid var(--cyan); }
.cs-range:focus-visible { outline: none; }
.cs-range:focus-visible::-webkit-slider-thumb { box-shadow: var(--ring); }
.cs-range:disabled { cursor: not-allowed; }

.cs-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
</style>
