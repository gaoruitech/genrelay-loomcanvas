<template>
  <div class="nlc" role="radiogroup" :aria-labelledby="labelledby">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="nlc-card"
      :class="{ on: o.value === modelValue }"
      role="radio"
      :aria-checked="o.value === modelValue"
      :disabled="disabled"
      :data-testid="`node-layout-${o.value}`"
      @click="emit('update:modelValue', o.value)"
    >
      <!-- 缩略图是按这种布局的真实比例画出来的示意，不是截图 -->
      <span class="nlc-thumb" aria-hidden="true">
        <svg v-if="o.value === 'a'" viewBox="0 0 168 104">
          <rect class="node" x="56" y="8" width="56" height="58" rx="5" />
          <rect class="media" x="56" y="16" width="56" height="42" />
          <path class="art" d="M56 50l14-12 10 8 12-14 20 18v8H56z" />
          <circle class="dot" cx="106" cy="12" r="1.6" />
          <path class="txt" d="M61 62h22" />
          <rect class="panel" x="34" y="72" width="100" height="24" rx="6" />
          <path class="txt" d="M41 79h56M41 84h34" />
          <rect class="chip" x="41" y="88" width="20" height="5" rx="2.5" />
          <rect class="chip" x="64" y="88" width="16" height="5" rx="2.5" />
          <rect class="run" x="112" y="87" width="16" height="6" rx="3" />
        </svg>
        <svg v-else-if="o.value === 'b'" viewBox="0 0 168 104">
          <rect class="node" x="14" y="16" width="50" height="40" rx="5" />
          <rect class="media" x="14" y="24" width="50" height="24" />
          <path class="art" d="M14 44l11-9 8 6 10-10 21 14v3H14z" />
          <circle class="dot" cx="58" cy="20" r="1.6" />
          <path class="txt" d="M19 52h26" />
          <rect class="run" x="55" y="50" width="6" height="4" rx="1.5" />
          <rect class="node ghost" x="14" y="64" width="50" height="32" rx="5" />
          <rect class="panel" x="98" y="6" width="64" height="92" rx="6" />
          <path class="txt" d="M105 15h24" />
          <rect class="well" x="105" y="21" width="50" height="22" rx="3" />
          <path class="txt" d="M109 27h40M109 32h32M109 37h20" />
          <rect class="well" x="105" y="48" width="50" height="8" rx="3" />
          <rect class="chip" x="105" y="61" width="14" height="6" rx="3" />
          <rect class="chip" x="122" y="61" width="14" height="6" rx="3" />
          <rect class="chip" x="139" y="61" width="14" height="6" rx="3" />
          <rect class="run" x="131" y="86" width="24" height="7" rx="3.5" />
        </svg>
        <svg v-else viewBox="0 0 168 104">
          <rect class="node" x="48" y="5" width="72" height="94" rx="5" />
          <rect class="media" x="48" y="13" width="72" height="40" />
          <path class="art" d="M48 45l18-14 12 9 16-18 26 22v9H48z" />
          <circle class="dot" cx="114" cy="9" r="1.6" />
          <rect class="well" x="53" y="58" width="62" height="24" rx="3" />
          <path class="txt" d="M57 64h52M57 69h40" />
          <rect class="chip" x="57" y="74" width="12" height="5" rx="2" />
          <rect class="chip" x="53" y="87" width="20" height="6" rx="3" />
          <rect class="chip" x="76" y="87" width="16" height="6" rx="3" />
          <rect class="run" x="99" y="86" width="16" height="8" rx="3.5" />
        </svg>
      </span>
      <span class="nlc-name">{{ o.name }}<i v-if="o.value === 'a'" class="lc-chip">{{ t('settings.appearance.nodeLayoutDefault') }}</i></span>
      <span class="nlc-desc">{{ o.desc }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 「节点布局」三选一：每张卡片是这种布局的示意图 + 名字 + 一句话说明，点了就生效。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NodeLayout } from '@/composables/nodeLayout'

defineProps<{ modelValue: NodeLayout; disabled?: boolean; labelledby?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: NodeLayout): void }>()
const { t } = useI18n()

const options = computed<{ value: NodeLayout; name: string; desc: string }[]>(() => [
  { value: 'a', name: t('settings.appearance.layoutA'), desc: t('settings.appearance.layoutADesc') },
  { value: 'b', name: t('settings.appearance.layoutB'), desc: t('settings.appearance.layoutBDesc') },
  { value: 'c', name: t('settings.appearance.layoutC'), desc: t('settings.appearance.layoutCDesc') },
])
</script>

<style scoped>
.nlc { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%; }
.nlc-card {
  display: grid; align-content: start; gap: 8px; min-width: 0; padding: 10px 10px 12px; border-radius: var(--r-md);
  border: 1px solid var(--line-2); background: rgba(124, 160, 255, .04); color: var(--text-2); text-align: left; cursor: pointer;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.nlc-card:hover:not(:disabled) { border-color: var(--line-3); background: rgba(124, 160, 255, .08); }
.nlc-card:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.nlc-card.on { border-color: var(--cyan); background: rgba(63, 216, 255, .08); box-shadow: 0 0 0 1px var(--cyan) inset; }
.nlc-card:disabled { opacity: .6; cursor: default; }
.nlc-thumb {
  display: block; border-radius: 9px; overflow: hidden; border: 1px solid var(--line);
  background:
    linear-gradient(var(--film-1) 1px, transparent 1px) 0 0 / 14px 14px,
    linear-gradient(90deg, var(--film-1) 1px, transparent 1px) 0 0 / 14px 14px,
    linear-gradient(180deg, var(--bg-0), var(--bg-1));
}
.nlc-thumb svg { display: block; width: 100%; height: auto; }
.nlc-thumb .node { fill: #172552; stroke: var(--line-2); stroke-width: 1; }
.nlc-thumb .node.ghost { opacity: .5; }
.nlc-thumb .media { fill: #1a1f6b; }
.nlc-thumb .art { fill: #5b2a9a; opacity: .8; }
.nlc-thumb .dot { fill: var(--ok); }
.nlc-thumb .panel { fill: #14214c; stroke: var(--line-2); stroke-width: 1; }
.nlc-thumb .well { fill: rgba(4, 9, 28, .62); stroke: var(--line); stroke-width: 1; }
.nlc-thumb .txt { fill: none; stroke: var(--text-3); stroke-width: 2; stroke-linecap: round; opacity: .7; }
.nlc-thumb .chip { fill: rgba(124, 160, 255, .12); stroke: var(--line-2); stroke-width: .8; }
.nlc-thumb .run { fill: #56c8ff; }
.nlc-card.on .nlc-thumb .node:not(.ghost), .nlc-card.on .nlc-thumb .panel { stroke: var(--cyan); }
.nlc-name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; font-weight: 600; color: var(--text); }
.nlc-name .lc-chip { flex: none; font-style: normal; font-weight: 400; height: 18px; padding: 0 6px; font-size: 11px; }
.nlc-desc { font-size: 12px; line-height: 1.6; color: var(--text-3); }
@media (max-width: 720px) {
  .nlc { grid-template-columns: 1fr; }
  .nlc-card { grid-template-columns: 132px minmax(0, 1fr); grid-template-rows: auto 1fr; column-gap: 12px; row-gap: 4px; }
  .nlc-thumb { grid-row: 1 / 3; }
}
@media (prefers-reduced-motion: reduce) { .nlc-card { transition: none; } }
</style>
