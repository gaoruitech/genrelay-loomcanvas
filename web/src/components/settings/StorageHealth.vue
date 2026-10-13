<template>
  <SettingsCard :title="t('settings.storage.health.title')" :desc="t('settings.storage.health.desc')" data-testid="storage-status">
    <template #aside>
      <span v-if="checkedAt" class="hc-when" data-testid="storage-checked">{{ t('settings.storage.health.checkedAt', { time: clock }) }}</span>
      <button type="button" class="lc-btn sm" :disabled="refreshing" data-testid="storage-refresh" @click="emit('refresh')">
        <LcIcon name="refresh" size="s" :class="{ spinning: refreshing }" />{{ t('settings.storage.health.refresh') }}
      </button>
    </template>

    <!-- 新文件存不下来：最要紧的一句，放在最上面 -->
    <div v-if="status.writable === false" class="lc-alert hc-alert" role="alert" data-testid="storage-not-writable">
      <LcIcon name="warn" />
      <div class="hc-alert-body">
        <b>{{ t('settings.storage.notWritable.title') }}</b>
        <p>{{ t('settings.storage.notWritable.text') }}</p>
        <button type="button" class="lc-btn sm" data-testid="storage-fix-secret" @click="emit('fix-secret')">
          <LcIcon name="key" size="s" />{{ t('settings.storage.secretAgain') }}
        </button>
      </div>
    </div>
    <div v-else-if="status.secretUnreadable" class="lc-alert warn hc-alert" role="status" data-testid="storage-secret-unreadable">
      <LcIcon name="warn" />
      <div class="hc-alert-body">
        <p>{{ t(savedBucketLost ? 'settings.storage.secretUnreadable' : 'settings.storage.secretUnreadableEnv') }}</p>
        <button type="button" class="lc-btn sm" data-testid="storage-fix-secret" @click="emit('fix-secret')">
          <LcIcon name="key" size="s" />{{ t('settings.storage.secretAgain') }}
        </button>
      </div>
    </div>

    <div class="srow low">
      <div class="k">{{ t('settings.storage.health.writesTo') }}</div>
      <div class="v">
        <div class="inline">
          <span class="lc-st" :class="status.writable === false ? 'err' : 'ok'" data-testid="storage-driver">{{ t('settings.storage.driver.' + status.driver) }}</span>
          <span class="lc-chip o" data-testid="storage-source">{{ t('settings.storage.source.' + status.source) }}</span>
        </div>
        <p v-if="status.driver === 's3' && activeBucket" class="hc-where">{{ activeBucket }}</p>
        <p class="txt hc-line">{{ status.driver === 's3' ? t('settings.storage.health.deliveryLine', { how: t('settings.storage.delivery.' + (status.delivery || 'proxy')) }) : t('settings.storage.localLine') }}</p>
      </div>
    </div>

    <!-- 存不了新文件的时候服务端回的是 unavailable：这不是地址配置的问题，说清楚要先修好存储，不给改地址的建议 -->
    <div v-if="status.upstream && (status.writable !== false || status.upstream === 'unavailable')" class="srow low" data-testid="storage-upstream" :data-upstream="status.upstream">
      <div class="k">{{ t('settings.storage.health.upstreamLabel') }}</div>
      <div class="v">
        <div class="inline">
          <b class="hc-mode">{{ t('settings.storage.upstream.' + status.upstream + '.name') }}</b>
          <span v-if="status.upstream === 'inline'" class="lc-tag warn">{{ t('settings.storage.upstream.limited') }}</span>
          <span v-else-if="status.upstream === 'unavailable'" class="lc-tag err">{{ t('settings.storage.upstream.unavailableTag') }}</span>
        </div>
        <p class="txt hc-line">{{ t('settings.storage.upstream.' + status.upstream + '.text') }}</p>
        <div v-if="status.upstream === 'inline'" class="hc-limited" data-testid="storage-upstream-limited">
          <p>{{ t('settings.storage.upstream.inlineAffected') }}</p>
          <p>{{ t(status.driver === 's3' ? 'settings.storage.upstream.inlineFixS3' : 'settings.storage.upstream.inlineFixLocal') }}</p>
          <button v-if="status.driver === 's3'" type="button" class="lc-btn sm" data-testid="storage-go-presign" @click="emit('go-presign')">
            {{ t('settings.storage.upstream.goPresign') }}
          </button>
        </div>
      </div>
    </div>

    <div class="srow low">
      <div class="k">{{ t('settings.storage.health.storesLabel') }}</div>
      <div class="v">
        <StorageStores :status="status" @changed="emit('changed', $event)" @stale="emit('refresh')" />
        <p v-if="polling" class="lc-help hc-auto" data-testid="storage-polling">{{ t('settings.storage.health.auto', { n: polling }) }}</p>
      </div>
    </div>
  </SettingsCard>
</template>

<script setup lang="ts">
/**
 * 存储现在的情况（设置 → 存储 最上面那张卡片）：新文件存到哪、存不存得下来、
 * 文件怎样交给上游模型，以及读取文件时会去找的每一个存储和它们各自的状态。
 * 只显示，不改表单：要人去改的地方（重新填写密钥、填签名地址用的 Endpoint）发事件给上层，由它把焦点送过去。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import SettingsCard from './SettingsCard.vue'
import StorageStores from './StorageStores.vue'
import type { StorageStatus } from '@/types'

const props = defineProps<{
  status: StorageStatus
  refreshing?: boolean
  /** 这份状态是什么时候取的（毫秒时间戳） */
  checkedAt?: number
  /** 正在每隔几秒自动刷新（0 = 没有） */
  polling?: number
}>()
const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'fix-secret'): void
  (e: 'go-presign'): void
  (e: 'changed', status: StorageStatus): void
}>()
const { t } = useI18n()

const pad = (n: number) => String(n).padStart(2, '0')
const clock = computed(() => {
  const d = new Date(props.checkedAt || 0)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})
/** 正在写入的那个存储桶：主机 / 桶 / 前缀 */
const activeBucket = computed(() => {
  const b = (props.status.buckets || []).find((x) => x.active) || props.status.s3
  return b ? `${b.endpointHost} / ${b.bucket}${b.keyPrefix ? ' / ' + b.keyPrefix.replace(/\/+$/, '') : ''}` : ''
})
/**
 * 保存的那个存储桶是不是真的用不了。同一个桶同时写在 S3_* 环境变量里时，服务端用环境变量里的密钥，
 * 一切照常，只是仍然提醒把密钥重新填一遍。
 */
const savedBucketLost = computed(() => {
  const list = props.status.buckets
  return !list || list.some((b) => b.origin === 'saved' && b.state === 'secret_unreadable')
})
</script>

<style scoped>
@import './section-shared.css';

.hc-when { font: 12px var(--f-mono); color: var(--text-3); white-space: nowrap; }
.hc-alert { margin: 8px 0 4px; }
.hc-alert-body { min-width: 0; }
.hc-alert-body b { display: block; font-weight: 600; }
.hc-alert-body .lc-btn { margin-top: 10px; }
.hc-where { margin-top: 6px; font: 13px/1.6 var(--f-mono); color: var(--text); overflow-wrap: anywhere; }
.hc-line { margin-top: 4px; }
.hc-mode { font-weight: 600; font-size: 14px; color: var(--text); }
.hc-limited {
  margin-top: 10px; padding: 12px 14px; border-radius: 10px; max-width: 600px;
  border: 1px solid rgb(var(--c-warn) / .4); background: rgb(var(--c-warn) / .08);
  color: var(--alert-warn-fg); font-size: 13px; line-height: 1.7;
}
.hc-limited p + p { margin-top: 6px; }
.hc-limited .lc-btn { margin-top: 10px; }
.hc-auto { display: block; margin-top: 6px; }
.spinning { animation: spin 1s linear infinite; }
</style>
