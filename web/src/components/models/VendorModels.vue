<template>
  <div class="vm">
    <button
      type="button"
      class="vm-head"
      :aria-expanded="open"
      @click="open = !open"
    >
      <LcIcon name="chev" size="s" class="vm-chevron" :class="{ open }" />
      <span class="vm-title">{{ t('modelsPage.provider.supported') }}</span>
      <span class="vm-count">{{ t('modelsPage.provider.supportedCount', { n: vendor.models.length }) }}</span>
    </button>

    <div v-if="open" class="vm-body">
      <div v-for="g in groups" :key="g.kind" class="vm-group">
        <div class="vm-kind">
          <span class="lc-bd" :class="g.kind">{{ t('modelsPage.kinds.' + g.kind) }}</span>
          <span v-if="!g.models.length" class="vm-none">{{ t('modelsPage.provider.supportedNone') }}</span>
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
      <p class="vm-hint">{{ t('modelsPage.provider.supportedHint') }}</p>
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
import LcIcon from '@/components/LcIcon.vue'
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
.vm { border: 1px solid var(--line); border-radius: var(--r-md); background: var(--well); margin-bottom: 16px; }
.vm-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 10px 12px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left;
  border-radius: var(--r-md);
}
.vm-chevron { color: var(--text-3); transition: transform .15s ease; }
.vm-chevron.open { transform: rotate(90deg); }
.vm-title { font-size: 13px; font-weight: 600; color: var(--text); }
.vm-count { font-size: 12px; color: var(--text-3); }
.vm-body { padding: 0 12px 10px; max-height: 280px; overflow-y: auto; border-top: 1px solid var(--line); }
.vm-group { padding-top: 10px; }
.vm-kind { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.vm-none { font-size: 12px; color: var(--text-3); }
.vm-list { list-style: none; margin: 0; padding: 0; }
.vm-row { padding: 7px 0; border-bottom: 1px solid var(--line); }
.vm-row:last-child { border-bottom: 0; }
.vm-name { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; }
.vm-label { font-size: 13px; font-weight: 500; color: var(--text); }
.vm-id { font-family: var(--f-mono); font-size: 12px; color: var(--text-3); word-break: break-all; }
.vm-caps { margin-top: 3px; font-size: 12px; color: var(--text-2); line-height: 1.55; }
.vm-hint { margin-top: 10px; font-size: 12px; color: var(--text-3); line-height: 1.5; }
</style>
