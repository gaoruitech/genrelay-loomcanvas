<template>
  <section :id="id" class="sp" :aria-labelledby="id + '-h'">
    <header class="sp-head">
      <div class="sp-t">
        <h2 :id="id + '-h'"><LcIcon :name="icon" />{{ title }}</h2>
        <p class="sp-d"><slot name="desc">{{ desc }}</slot></p>
      </div>
      <div v-if="$slots.action" class="sp-act"><slot name="action" /></div>
    </header>
    <div class="sp-body"><slot /></div>
  </section>
</template>

<script setup lang="ts">
/** 设置页的一个分区：标题 + 一句说明 + 可选的主操作，下面是若干张卡片（SettingsCard）。一次只显示一个分区。 */
import LcIcon from '@/components/LcIcon.vue'

defineProps<{ id: string; icon: string; title: string; desc?: string }>()
</script>

<style scoped>
.sp { min-width: 0; }
.sp-head { display: flex; align-items: flex-start; gap: 16px 24px; flex-wrap: wrap; margin-bottom: 24px; }
.sp-t { flex: 1 1 320px; min-width: 0; }
.sp-t h2 { font: 600 20px/1.4 var(--f-disp); color: var(--text); display: flex; align-items: center; gap: 10px; }
.sp-t h2 :deep(.lc-ic) { color: var(--cyan); flex: none; }
.sp-d { color: var(--text-2); font-size: 13px; line-height: 1.7; margin-top: 6px; max-width: 640px; }
.sp-act { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sp-body { display: grid; gap: 24px; min-width: 0; }
@media (max-width: 600px) {
  .sp-head { margin-bottom: 16px; }
  .sp-t h2 { font-size: 18px; }
  .sp-body { gap: 16px; }
}
</style>
