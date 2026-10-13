<template>
  <SettingsSection id="teams" icon="users" :title="t('settings.teams.title')" :desc="t('settings.teams.desc')">
    <TeamFeatureCard @saved="list?.reload()" />
    <TeamRequestsCard />
    <TeamListCard ref="list" />
    <div class="lc-alert info note" data-testid="teams-note">
      <LcIcon name="shield" /><span>{{ t('settings.teams.note') }}</span>
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * 团队（仅超级管理员）：三张卡片 ——
 *  - 团队功能：每人最多建几个、每个团队最多多少人、动态保留多久；
 *  - 创建团队的申请：逐条批准或拒绝（批准 = 给那个账号授权）；
 *  - 团队列表：只有名称和数字，停用 / 恢复、调整上限、指定新团长、永久删除。
 * 超级管理员在这里看不到任何团队里的内容。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import SettingsSection from './SettingsSection.vue'
import TeamFeatureCard from './TeamFeatureCard.vue'
import TeamRequestsCard from './TeamRequestsCard.vue'
import TeamListCard from './TeamListCard.vue'

const { t } = useI18n()
/** 站点默认值改了以后，列表里「用默认值」的团队跟着变 */
const list = ref<InstanceType<typeof TeamListCard> | null>(null)
</script>

<style scoped>
.note { align-items: flex-start; line-height: 1.7; }
.note :deep(svg) { color: var(--cyan); }
</style>
