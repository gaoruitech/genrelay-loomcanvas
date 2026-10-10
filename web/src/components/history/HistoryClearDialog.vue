<template>
  <!-- 清理确认：删掉就找不回来，必须先说清楚再动手 -->
  <div class="lc-mask" @click.self="close">
    <!-- 故意不用 form：在日期框里按回车不该直接触发删除 -->
    <div class="lc-dialog hc" role="dialog" aria-modal="true" :aria-label="t('history.clearDialog.title')">
      <div class="lc-dialog-head">
        <span>{{ t('history.clearDialog.title') }}</span>
        <button class="lc-x" type="button" :title="t('common.close')" :disabled="clearing" @click="close">×</button>
      </div>
      <div class="lc-dialog-body">
        <!-- TDesign 的输入框不接 id，没法用 for 关联；把控件包在 label 里，点文字同样能聚焦 -->
        <label class="lc-field">
          <span class="lc-label">{{ t('history.clearDialog.label') }}</span>
          <t-date-picker
            v-model="before"
            class="lc-date hc-date"
            value-type="YYYY-MM-DD"
            format="YYYY-MM-DD"
            allow-input
            clearable
            :placeholder="t('history.clearDialog.placeholder')"
            :disable-date="{ after: todayText }"
            :popup-props="DATE_POPUP"
          />
        </label>
        <p class="hc-text">{{ valid ? t('history.clearDialog.text', { date: before }) : t('history.clearDialog.pick') }}</p>
        <div class="lc-alert warn hc-warn"><LcIcon name="warn" /><span>{{ t('history.clearDialog.warn') }}</span></div>
      </div>
      <div class="lc-dialog-foot">
        <button class="lc-btn" type="button" :disabled="clearing" @click="close">{{ t('common.cancel') }}</button>
        <button class="lc-btn danger" type="button" :disabled="!valid || clearing" @click="confirm">{{ t('history.clearDialog.confirm') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import LcIcon from '@/components/LcIcon.vue'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { isoDate } from './historyFormat'

const emit = defineEmits<{ (e: 'close'): void; (e: 'cleared'): void }>()
const { t } = useI18n()

/** 日历弹层挂在 body 上，靠这个类名套用整站的配色（见 base.css） */
const DATE_POPUP = { overlayClassName: 'lc-date-popup' }
const todayText = isoDate(new Date())

const before = ref('')
/** 日历里未来的日子点不了，但输入框能手敲：这里再挡一次 */
const valid = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(before.value || '') && before.value <= todayText)
const clearing = ref(false)

function close() {
  if (!clearing.value) emit('close')
}

async function confirm() {
  if (!valid.value || clearing.value) return
  clearing.value = true
  try {
    const data = unwrap(await adminApi.clearUsageRecords(before.value))
    MessagePlugin.success(t('history.clearDialog.cleared', { n: Number(data?.deleted) || 0 }))
    emit('cleared')
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    clearing.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.hc { width: 460px; }
.hc-date { width: 100%; }
.hc-text { color: var(--text-2); font-size: 13px; line-height: 1.7; }
.hc-warn { margin-top: 12px; }
</style>
