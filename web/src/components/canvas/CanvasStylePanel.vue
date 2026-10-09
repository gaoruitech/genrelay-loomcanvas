<template>
  <div
    v-if="open"
    class="cs-panel"
    :style="{ left: x + 'px', top: y + 'px' }"
    @mousedown.stop
    @click.stop
    @wheel.stop
  >
    <div class="cs-head">
      <span>{{ t('dialogs.bg.title') }}</span>
      <button class="cs-close" :title="t('common.close')" @click="$emit('close')">×</button>
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
          :title="p.label"
          :aria-label="p.label"
          @click="setColor(p.value)"
        />
      </div>
      <div class="cs-row">
        <label class="cs-custom">
          <input type="color" :value="pickerValue" @input="onPick" />
          <span>{{ t('dialogs.bg.custom') }}</span>
        </label>
        <span class="cs-hex">{{ bg.color === 'auto' ? t('dialogs.bg.followTheme') : bg.color.toUpperCase() }}</span>
      </div>
    </div>

    <div class="cs-field">
      <div class="cs-label">{{ t('dialogs.bg.pattern') }}</div>
      <div class="cs-pats">
        <button
          v-for="p in CANVAS_BG_PATTERNS"
          :key="p.value"
          class="cs-pat"
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
        @input="onGap"
      />
      <div class="cs-row">
        <span class="cs-dim">{{ t('dialogs.bg.gap') }}</span>
        <span class="cs-hex">{{ bg.gap }} px</span>
      </div>
    </div>

    <p v-if="warning" class="cs-warn">{{ warning }}</p>

    <div class="cs-foot">
      <span class="cs-dim">{{ t('dialogs.bg.autoSaved') }}</span>
      <button class="cs-reset" :disabled="isDefault" @click="reset">{{ t('dialogs.bg.restoreDefault') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import {
  CANVAS_BG_PRESETS,
  CANVAS_BG_PATTERNS,
  CANVAS_BG_GAP_MIN,
  CANVAS_BG_GAP_MAX,
  DEFAULT_CANVAS_BG,
  canvasBgWarning,
  isDefaultCanvasBg,
  isHexColor,
  type CanvasBgSettings,
} from '@/utils/canvasBg'

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
const appStore = useAppStore()

const isDefault = computed(() => isDefaultCanvasBg(props.bg))
const warning = computed(() => canvasBgWarning(props.bg, appStore.resolvedTheme))

// <input type="color"> 不接受 'auto'，跟随主题时给它一个中性值当起点
const pickerValue = computed(() => (isHexColor(props.bg.color) ? props.bg.color : '#151517'))

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
  width: 264px;
  padding: 12px;
  background: var(--n-2);
  border: 1px solid var(--n-5);
  border-radius: 12px;
  box-shadow: 0 8px 24px var(--shadow-2);
  color: var(--t-body);
}
.cs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--t-body);
  margin-bottom: 12px;
}
.cs-close {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--t-dim);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.cs-close:hover { background: var(--n-4); color: var(--t-body); }

.cs-field { margin-bottom: 14px; }
.cs-field.disabled { opacity: 0.45; }
.cs-label {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--t-dim);
  margin-bottom: 8px;
}
.cs-swatches { display: flex; flex-wrap: wrap; gap: 7px; }
.cs-sw {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid var(--n-6);
  cursor: pointer;
  padding: 0;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.cs-sw:hover { transform: translateY(-1px); }
/* 「跟随主题」用一半深一半浅表达，比写字省地方也更直观 */
.cs-sw.auto { background: linear-gradient(135deg, #151517 0 50%, #eaeceb 50% 100%); }
.cs-sw.on {
  box-shadow: 0 0 0 2px var(--n-2), 0 0 0 3.5px var(--accent);
}
.cs-sw:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 3px; }

.cs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 9px;
}
.cs-custom {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--t-dim);
  cursor: pointer;
}
.cs-custom input[type='color'] {
  width: 26px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--n-6);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.cs-hex {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--n-3);
  border: 1px solid var(--n-5);
  color: var(--t-body);
}
.cs-dim { font-size: 12px; color: var(--t-dim); }

.cs-pats { display: flex; gap: 6px; }
.cs-pat {
  flex: 1;
  padding: 7px 0;
  font-size: 12px;
  border-radius: 7px;
  border: 1px solid var(--n-5);
  background: var(--n-3);
  color: var(--t-dim);
  cursor: pointer;
  transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
}
.cs-pat:hover { color: var(--t-body); }
.cs-pat.on {
  border-color: var(--accent-mid);
  color: var(--accent-text);
  background: var(--accent-ghost);
}
.cs-range { width: 100%; accent-color: var(--accent); }

.cs-warn {
  margin: 0 0 12px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.55;
  border-radius: 8px;
  border-left: 2px solid var(--warn, #f5b23c);
  background: var(--n-3);
  color: var(--t-dim);
}
.cs-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--n-5);
}
.cs-reset {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--n-5);
  background: var(--n-3);
  color: var(--t-body);
  cursor: pointer;
}
.cs-reset:hover:not(:disabled) { border-color: var(--n-7); }
.cs-reset:disabled { opacity: 0.4; cursor: default; }
</style>
