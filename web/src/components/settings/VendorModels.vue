<template>
  <div class="vm">
    <button
      type="button"
      class="vm-head"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg class="vm-chevron" :class="{ open }" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="vm-title">{{ t('settings.providers.supported') }}</span>
      <span class="vm-count">{{ t('settings.providers.supportedCount', { n: vendor.models.length }) }}</span>
    </button>

    <div v-if="open" class="vm-body">
      <div v-for="g in groups" :key="g.kind" class="vm-group">
        <div class="vm-kind">
          <span class="kind-badge" :class="g.kind">{{ t('settings.models.kinds.' + g.kind) }}</span>
          <span v-if="!g.models.length" class="vm-none">{{ t('settings.providers.supportedNone') }}</span>
        </div>
        <ul v-if="g.models.length" class="vm-list">
          <li v-for="m in g.models" :key="m.model" class="vm-row">
            <div class="vm-name">
              <span class="vm-label">{{ m.label }}</span>
              <code class="vm-id">{{ m.model }}</code>
            </div>
            <div class="vm-caps">{{ capsSummary(m).join(' · ') }}</div>
          </li>
        </ul>
      </div>
      <p class="vm-hint">{{ t('settings.providers.supportedHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「此服务商支持的模型」：按 图片 / 视频 / 对话 分组，每行是显示名、上游模型名和一行能力摘要。
 * 内容全部来自后端的服务商模型清单，这里不做任何推断。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { capsSummary } from '@/utils/modelCaps'
import type { ModelKind, Vendor } from '@/types'

const props = withDefaults(defineProps<{
  vendor: Vendor
  /** 初始是否展开 */
  expanded?: boolean
}>(), { expanded: true })

const { t } = useI18n()
const open = ref(props.expanded)

const KINDS: ModelKind[] = ['image', 'video', 'chat']
const groups = computed(() => KINDS.map(kind => ({ kind, models: props.vendor.models.filter(m => m.kind === kind) })))
</script>

<style scoped>
@import './tab-shared.css';

.vm { border: 1px solid var(--n-5); border-radius: var(--radius-lg); background: var(--n-1); margin-bottom: 16px; }
.vm-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 10px 12px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left;
}
.vm-chevron { width: 12px; height: 12px; flex: none; color: var(--t-dim); transition: transform .15s ease; }
.vm-chevron.open { transform: rotate(90deg); }
.vm-title { font-size: 13px; font-weight: 600; color: var(--t-strong); }
.vm-count { font-size: 12px; color: var(--t-dim); }
.vm-body { padding: 0 12px 10px; max-height: 300px; overflow-y: auto; border-top: 1px solid var(--line-1); }
.vm-group { padding-top: 10px; }
.vm-kind { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.vm-none { font-size: 12px; color: var(--t-dim); }
.vm-list { list-style: none; margin: 0; padding: 0; }
.vm-row { padding: 7px 0; border-bottom: 1px solid var(--line-1); }
.vm-row:last-child { border-bottom: 0; }
.vm-name { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; }
.vm-label { font-size: 13px; font-weight: 500; color: var(--t-max); }
.vm-id { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11.5px; color: var(--t-dim); word-break: break-all; }
.vm-caps { margin-top: 3px; font-size: 12px; color: var(--t-body); line-height: 1.55; }
.vm-hint { margin-top: 10px; font-size: 12px; color: var(--t-dim); line-height: 1.5; }
</style>
