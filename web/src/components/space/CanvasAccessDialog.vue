<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @click.self="!busy && emit('close')">
      <div v-dialog="{ onEscape: () => emit('close'), busy }" class="lc-dialog cad" role="dialog" aria-modal="true" :aria-label="t('spaces.access.title', { name: canvas.name })">
        <div class="lc-dialog-head">
          <span class="cad-h">{{ t('spaces.access.title', { name: canvas.name }) }}</span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </div>
        <div class="lc-dialog-body">
          <CanvasAccessPanel v-model="draft" :read-only="!canSet" :lock="canvas.lock" />
          <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" @click="emit('close')">{{ canSet ? t('common.cancel') : t('common.close') }}</button>
          <button v-if="canSet" class="lc-btn primary" type="button" :disabled="busy || draft === current" @click="save">{{ busy ? t('common.saving') : t('common.save') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 「团队权限」弹窗：改一张团队画布的可见范围。画布列表的卡片菜单用它；
 * 编辑器里「分享」弹窗的「团队内」页签用的是同一个面板（CanvasAccessPanel）。
 * 不能改的人（别人的画布）也能打开，看到的是只读的。
 */
import { vDialog } from '@/directives/dialog'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { workflowApi, unwrap, apiErrorMessage, type WorkflowSummary } from '@/utils/api'
import { MessagePlugin } from '@/utils/feedback'
import CanvasAccessPanel from './CanvasAccessPanel.vue'
import type { CanvasVisibility } from '@/types'

const props = defineProps<{ canvas: WorkflowSummary }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', canvas: WorkflowSummary): void }>()

const { t } = useI18n()
const current = computed<CanvasVisibility>(() => (props.canvas.visibility || 'team_view') as CanvasVisibility)
const draft = ref<CanvasVisibility>(current.value)
const canSet = computed(() => !!props.canvas.access?.canSetVisibility)
const busy = ref(false)
const error = ref('')

async function save() {
  if (busy.value || !canSet.value) return
  busy.value = true
  error.value = ''
  try {
    const out = unwrap(await workflowApi.setAccess(props.canvas.id, draft.value))
    MessagePlugin.success(t('spaces.access.saved', { level: t(`spaces.visibility.${draft.value}.label`) }))
    emit('saved', { ...props.canvas, ...out })
    emit('close')
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.cad { width: 560px; }
.cad-h { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-error-text { margin: 12px 0 0; }
</style>
