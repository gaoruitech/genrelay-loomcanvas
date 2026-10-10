<template>
  <section class="lc-card sc">
    <header v-if="title" class="sc-head">
      <div class="sc-t">
        <h3>{{ title }}<slot name="tag" /></h3>
        <p v-if="desc || $slots.desc"><slot name="desc">{{ desc }}</slot></p>
      </div>
      <div v-if="$slots.aside" class="sc-aside"><slot name="aside" /></div>
    </header>
    <div class="sc-body"><slot /></div>
    <footer v-if="$slots.foot" class="sc-foot"><slot name="foot" /></footer>
  </section>
</template>

<script setup lang="ts">
/** 分区里的一张卡片：一个话题一张。标题 + 一句说明，右上角可以放一个小操作，底下可以放这张卡片自己的按钮。 */
defineProps<{ title?: string; desc?: string }>()
</script>

<style scoped>
.sc { padding: 20px 24px; min-width: 0; }
.sc-head { display: flex; align-items: flex-start; gap: 12px 20px; flex-wrap: wrap; margin-bottom: 8px; }
.sc-t { flex: 1 1 260px; min-width: 0; }
.sc-t h3 { font: 600 15px/1.5 var(--f-disp); color: var(--text); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-t p { color: var(--text-3); font-size: 13px; line-height: 1.65; margin-top: 2px; max-width: 600px; }
.sc-aside { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-body { min-width: 0; }
.sc-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); }
@media (max-width: 600px) {
  .sc { padding: 16px; }
}
</style>
