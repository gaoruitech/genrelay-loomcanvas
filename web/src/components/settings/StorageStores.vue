<template>
  <div class="stores" data-testid="storage-stores">
    <ul ref="listEl" class="st-list" tabindex="-1" :aria-label="t('settings.storage.health.storesLabel')">
      <li
        v-for="s in rows"
        :key="s.key"
        class="st-row"
        :class="[s.state, { on: s.active }]"
        :data-testid="'storage-store-' + s.key"
        :data-state="s.state"
      >
        <div class="st-main">
          <div class="st-name">
            <span v-if="s.local" class="st-where plain">{{ t('settings.storage.stores.local') }}</span>
            <span v-else class="st-where">{{ s.where }}</span>
            <span v-if="s.active" class="lc-tag ok" data-role="active">{{ t('settings.storage.stores.active') }}</span>
            <span v-if="s.env" class="lc-chip o" data-role="env">{{ t('settings.storage.stores.env') }}</span>
          </div>
          <p class="st-sub">{{ s.sub }}</p>
        </div>
        <div class="st-state">
          <span class="lc-st" :class="STATE_CLASS[s.state]" data-role="state">{{ t('settings.storage.stores.state.' + s.state) }}</span>
          <small v-if="s.since" data-role="since">{{ t('settings.storage.stores.downSince', { time: s.since }) }}</small>
        </div>
        <div class="st-act">
          <button
            v-if="s.bucket?.removable"
            type="button"
            class="lc-btn sm"
            :disabled="busy"
            :data-testid="'storage-forget-' + s.key"
            @click="target = s.bucket"
          >{{ t('settings.storage.stores.forget') }}</button>
        </div>
      </li>
    </ul>

    <p v-if="anyDown" class="lc-help st-note" data-testid="storage-stores-down">{{ t('settings.storage.stores.downHelp') }}</p>
    <p v-else-if="rows.length > 1" class="lc-help st-note">{{ t('settings.storage.stores.help') }}</p>

    <!-- 去掉之后那一行（和它上面的按钮）就没了：焦点交给列表 -->
    <TeamDialog
      v-if="target" :title="t('settings.storage.stores.forgetTitle')" :width="460" :busy="busy" role="alertdialog"
      data-testid="storage-forget-dialog" :fallback-focus="() => listEl"
      @close="target = null" @submit="forget"
    >
      <p class="st-target">{{ whereOf(target) }}</p>
      <p>{{ t('settings.storage.stores.forgetText') }}</p>
      <p>{{ t('settings.storage.stores.forgetKeep') }}</p>
      <template #foot>
        <button class="lc-btn" type="button" :disabled="busy" data-autofocus @click="target = null">{{ t('common.cancel') }}</button>
        <button class="lc-btn danger" type="submit" :disabled="busy" data-testid="storage-forget-ok">{{ t('settings.storage.stores.forget') }}</button>
      </template>
    </TeamDialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 读取文件时会去找的每一个存储：本地磁盘（始终读取），加上服务端列出的各个存储桶。
 * 正在写入的排第一；其余的是不再写入、但之前存在那里的文件仍从那里读的。每个带着它现在的状态，
 * 能去掉的（保存过、已经不写入的）有一颗「不再读取」：确认之后 DELETE /api/admin/storage/buckets/:id，
 * 把服务端回来的新状态交给上层（changed）。列表过期了（那个桶已经不在、又成了写入的那个）就请上层重取（stale）。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { adminApi, unwrap, apiErrorCode, apiErrorMessage } from '@/utils/api'
import { formatRecent } from '@/components/space/format'
import TeamDialog from '@/components/team/TeamDialog.vue'
import type { StorageBucket, StorageStatus } from '@/types'

const props = defineProps<{ status: StorageStatus }>()
const emit = defineEmits<{ (e: 'changed', status: StorageStatus): void; (e: 'stale'): void }>()
const { t } = useI18n()

type State = StorageBucket['state']
const STATE_CLASS: Record<State, string> = { ok: 'ok', unreachable: 'err', secret_unreadable: 'err' }

interface Row {
  key: string
  local: boolean
  where: string
  active: boolean
  env: boolean
  state: State
  since: string
  sub: string
  bucket: StorageBucket | null
}

const whereOf = (b: { endpointHost: string; bucket: string; keyPrefix: string }) =>
  `${b.endpointHost} / ${b.bucket}${b.keyPrefix ? ' / ' + b.keyPrefix.replace(/\/+$/, '') : ''}`

function subOf(b: StorageBucket): string {
  if (b.state === 'secret_unreadable') return t('settings.storage.stores.sub.secret')
  if (b.active) return t('settings.storage.stores.sub.active')
  if (b.origin === 'env') return t('settings.storage.stores.sub.env')
  return t('settings.storage.stores.sub.earlier')
}

const rows = computed<Row[]>(() => {
  const s = props.status
  const localActive = s.driver === 'local'
  const local: Row = {
    key: 'local', local: true, where: '', active: localActive, env: false, state: 'ok', since: '',
    sub: t(localActive ? 'settings.storage.stores.sub.localActive' : 'settings.storage.stores.sub.local'), bucket: null,
  }
  const buckets: Row[] = (s.buckets || []).map((b) => ({
    key: b.id, local: false, where: whereOf(b), active: b.active, env: b.origin === 'env', state: b.state,
    since: b.state === 'unreachable' && b.downSince ? formatRecent(b.downSince) : '', sub: subOf(b), bucket: b,
  }))
  // 正在写入的排第一；本地磁盘不在写入时紧跟在它后面（查找文件时本地磁盘本来就是最先问的）
  const first = buckets.filter((b) => b.active)
  return localActive ? [local, ...buckets] : [...first, local, ...buckets.filter((b) => !b.active)]
})
const anyDown = computed(() => rows.value.some((r) => r.state === 'unreachable'))

const listEl = ref<HTMLElement | null>(null)
const target = ref<StorageBucket | null>(null)
const busy = ref(false)

async function forget() {
  const b = target.value
  if (!b || busy.value) return
  busy.value = true
  try {
    const next = unwrap(await adminApi.forgetStorageBucket(b.id))
    target.value = null
    emit('changed', next)
    MessagePlugin.success(t('settings.storage.stores.forgotten'))
  } catch (err) {
    target.value = null
    const code = apiErrorCode(err)
    // 列表是旧的：这个桶已经被去掉了，或者又成了正在写入的那个。说一声，按现在的样子重画
    if (code === 'storage.bucket_not_found') MessagePlugin.info(t('settings.storage.stores.gone'))
    else MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
    if (code.startsWith('storage.bucket_')) emit('stale')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.stores { min-width: 0; }
.st-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line-2); border-radius: 12px; overflow: hidden; outline: none; }
.st-list:focus-visible { box-shadow: var(--ring); }
.st-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 6px 16px;
  padding: 12px 14px; background: rgb(var(--c-well) / .35);
}
.st-row + .st-row { border-top: 1px solid var(--line); }
.st-row.unreachable, .st-row.secret_unreadable { background: rgb(var(--c-err) / .06); }
.st-main { min-width: 0; }
.st-name { display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; }
/* 先在空格处换行，一段实在放不下才从中间断 */
.st-where { font: 13px/1.5 var(--f-mono); color: var(--text); overflow-wrap: anywhere; min-width: 0; }
.st-where.plain { font-family: inherit; font-weight: 500; }
.st-sub { margin-top: 2px; font-size: 12px; line-height: 1.6; color: var(--text-3); }
.st-state { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.st-state small { font-size: 12px; color: var(--text-3); white-space: nowrap; }
/* 没有按钮的行也留出同样宽的一格，状态那一列才对得齐 */
.st-act { min-width: 76px; display: flex; justify-content: flex-end; }
.st-note { display: block; margin-top: 8px; max-width: 600px; }
.st-target { font: 13px/1.6 var(--f-mono); color: var(--text); overflow-wrap: anywhere; }

@media (max-width: 720px) {
  .st-row { grid-template-columns: minmax(0, 1fr) auto; }
  .st-main { grid-column: 1 / -1; }
  .st-state { flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; }
  .st-act { min-width: 0; }
}
</style>
