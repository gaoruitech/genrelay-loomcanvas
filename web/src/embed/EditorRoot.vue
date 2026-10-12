<template>
  <!-- 只嵌编辑器时的根：没有外壳、没有启动信息、没有账号。TDesign 的弹层挂在本产品自己的根元素里。 -->
  <t-config-provider :global-config="tdConfig">
    <router-view />
  </t-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { TDESIGN_LOCALES } from '@/locales/tdesign'
import { useEmbed } from './context'

const app = useAppStore()
const embed = useEmbed()
const tdConfig = computed(() => ({ ...TDESIGN_LOCALES[app.locale], attach: () => embed.portal as HTMLElement }))
</script>
