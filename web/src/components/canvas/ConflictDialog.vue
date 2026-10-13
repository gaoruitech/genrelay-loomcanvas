<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask" data-testid="conflict-dialog">
      <div v-dialog class="lc-dialog cfd" role="alertdialog" aria-modal="true" :aria-labelledby="uid + '-t'" :aria-describedby="uid + '-d'">
        <div class="cfd-head">
          <span class="cfd-ic"><LcIcon name="warn" size="l" /></span>
          <h2 :id="uid + '-t'">{{ t('canvas.conflict.title') }}</h2>
        </div>
        <p :id="uid + '-d'" class="cfd-desc">
          <template v-if="conflict.by?.name"><b>{{ conflict.by.name }}</b> {{ t('canvas.conflict.descBy', { time: when }) }}</template>
          <template v-else>{{ t('canvas.conflict.descAnon', { time: when }) }}</template>
          {{ t('canvas.conflict.choose') }}
        </p>

        <div class="cfd-opts">
          <button ref="firstEl" class="cfd-opt rec" type="button" :disabled="busy || !canCopy" data-testid="conflict-copy" @click="emit('copy')">
            <span class="cfd-oi"><LcIcon name="copy" /></span>
            <span class="cfd-ot">
              <b>{{ t('canvas.conflict.copy') }}</b>
              <small>{{ canCopy ? t('canvas.conflict.copyDesc') : t('canvas.conflict.copyUnavailable') }}</small>
            </span>
            <span v-if="canCopy" class="lc-bd rec">{{ t('canvas.conflict.recommended') }}</span>
          </button>
          <button class="cfd-opt" type="button" :disabled="busy" data-testid="conflict-reload" @click="emit('reload')">
            <span class="cfd-oi"><LcIcon name="refresh" /></span>
            <span class="cfd-ot">
              <b>{{ t('canvas.conflict.reload') }}</b>
              <small>{{ conflict.by?.name ? t('canvas.conflict.reloadDescBy', { name: conflict.by.name }) : t('canvas.conflict.reloadDesc') }}</small>
            </span>
          </button>
          <button class="cfd-opt" type="button" :disabled="busy || !conflict.canOverwrite" data-testid="conflict-overwrite" @click="emit('overwrite')">
            <span class="cfd-oi"><LcIcon name="upload" /></span>
            <span class="cfd-ot">
              <b>{{ t('canvas.conflict.overwrite') }}</b>
              <small>{{ conflict.canOverwrite
                ? (conflict.by?.name ? t('canvas.conflict.overwriteDescBy', { name: conflict.by.name }) : t('canvas.conflict.overwriteDesc'))
                : t('canvas.conflict.overwriteDenied') }}</small>
            </span>
            <LcIcon v-if="!conflict.canOverwrite" name="lock" size="s" class="cfd-lock" />
          </button>
        </div>
        <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 保存冲突：这张画布在我改的这段时间里被别人保存过，我这次的改动没有存上。
 * 不做任何自动合并，让人选一次：把我的版本另存为副本（默认、推荐）/ 载入最新版本（放弃我的）/
 * 用我的版本覆盖（只有创建者、管理员、团长能选，不能选时也摆出来并说明原因）。
 * 没有关闭按钮：选完之前不再自动保存，放着不管只会让没保存的改动越攒越多。
 */
import { vDialog } from '@/directives/dialog'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { formatRecent } from '@/components/space/format'
import type { SaveConflict } from '@/composables/useCanvasCollab'

const props = defineProps<{
  conflict: SaveConflict
  /** 后端能不能把一份文档另存成新画布 */
  canCopy: boolean
  busy: boolean
  error?: string
}>()
const emit = defineEmits<{ (e: 'copy'): void; (e: 'reload'): void; (e: 'overwrite'): void }>()

const { t } = useI18n()
const uid = `cf-${Math.random().toString(36).slice(2, 8)}`
const firstEl = ref<HTMLButtonElement | null>(null)
const when = computed(() => formatRecent(props.conflict.at) || t('canvas.conflict.justNow'))
onMounted(async () => { await nextTick(); firstEl.value?.focus() })
</script>

<style scoped>
.cfd { width: 560px; padding: 24px; }
.cfd-head { display: flex; align-items: center; gap: 14px; }
.cfd-ic { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: var(--warn); background: var(--warning-dim); }
.cfd-head h2 { font: 600 18px/1.4 var(--f-disp); color: var(--text); margin: 0; }
.cfd-desc { margin: 16px 0 18px; color: var(--text-2); line-height: 1.7; }
.cfd-desc b { color: var(--text); font-weight: 600; }
.cfd-opts { display: flex; flex-direction: column; gap: 10px; }
.cfd-opt {
  display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 16px; text-align: left; border-radius: var(--r-md);
  border: 1px solid var(--line-2); background: rgb(var(--c-film) / .04); color: var(--text-2); transition: border-color .15s, background .15s;
}
.cfd-opt:hover:not(:disabled) { border-color: var(--line-3); background: rgb(var(--c-film) / .1); }
.cfd-opt:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.cfd-opt.rec:not(:disabled) { border-color: rgb(var(--c-cyan) / .7); background: rgb(var(--c-cyan) / .08); }
.cfd-opt:disabled { opacity: .55; cursor: not-allowed; }
.cfd-oi { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: rgb(var(--c-film) / .12); color: var(--text-2); }
.cfd-ot { flex: 1; min-width: 0; }
.cfd-ot b { display: block; font-weight: 600; font-size: 14px; color: var(--text); line-height: 1.4; }
.cfd-ot small { display: block; font-size: 13px; color: var(--text-2); line-height: 1.6; margin-top: 2px; }
.cfd-lock { color: var(--text-3); }
.lc-error-text { margin: 14px 0 0; }
@media (max-width: 600px) { .cfd { padding: 18px; } }
</style>
