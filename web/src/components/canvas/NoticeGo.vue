<template>
  <!-- 在画布里点过去会离开正在编辑的画布：开新标签页。地址栏不归本产品管（memory 路由）时新标签页打不开应用里的地址，就在原地跳 -->
  <RouterLink
    v-if="open"
    class="ng nodrag"
    :to="go.to"
    :target="pages.newTab ? '_blank' : undefined"
    :rel="pages.newTab ? 'noopener' : undefined"
    data-testid="notice-go"
    @click.stop
    @mousedown.stop
  >{{ go.label }}</RouterLink>
</template>

<script setup lang="ts">
/**
 * 节点上一条说明后面跟着的去处（「打开 设置 → 存储」「打开模型管理」）。
 * 那一页在这次挂载里不存在（集成方没开放，或者只嵌了编辑器）就什么都不出，不给一个点了没反应的链接。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { usePageOpen } from '@/embed/links'
import type { NoticeGo } from '@/composables/useStorageNotice'

const props = defineProps<{ go: NoticeGo }>()
const pages = usePageOpen()
const open = computed(() => pages.to(props.go.to))
</script>

<style scoped>
.ng { margin-left: 4px; color: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
.ng:focus-visible { outline: none; box-shadow: var(--ring); border-radius: 4px; }
</style>
