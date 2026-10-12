<template>
  <Teleport to="body">
    <div v-if="open && form" class="lc-mask lc-sheet bke-mask" @click.self="close">
      <form class="lc-dialog bke" role="dialog" aria-modal="true" :aria-label="title" data-testid="kit-editor" @submit.prevent="save">
        <div class="lc-dialog-head">
          <span>{{ title }}</span>
          <button class="lc-x" type="button" :title="t('common.close')" :aria-label="t('common.close')" @click="close">×</button>
        </div>

        <div class="lc-dialog-body bke-body">
          <div class="srow">
            <div class="k"><label for="bke-name">{{ t('brandKit.editor.name') }}<span class="lc-required">*</span></label></div>
            <div class="v">
              <input id="bke-name" ref="nameInput" v-model="form.name" class="lc-input" maxlength="40" autocomplete="off" :placeholder="t('brandKit.editor.namePlaceholder')" :disabled="saving" />
              <span class="lc-help">{{ t('brandKit.editor.nameHelp') }}</span>
            </div>
          </div>

          <div class="srow">
            <div class="k"><label for="bke-prefix">{{ t('brandKit.editor.promptPrefix') }}</label></div>
            <div class="v">
              <textarea id="bke-prefix" v-model="form.promptPrefix" class="lc-textarea" rows="3" maxlength="1000" :placeholder="t('brandKit.editor.promptPrefixPlaceholder')" :disabled="saving"></textarea>
              <span class="lc-help">{{ t('brandKit.editor.promptPrefixHelp') }}</span>
            </div>
          </div>

          <div class="srow">
            <div class="k"><label for="bke-neg">{{ t('brandKit.editor.negative') }}</label></div>
            <div class="v">
              <textarea id="bke-neg" v-model="form.negativePrompt" class="lc-textarea bke-sm" rows="2" maxlength="500" :placeholder="t('brandKit.editor.negativePlaceholder')" :disabled="saving"></textarea>
              <span class="lc-help">{{ t('brandKit.editor.negativeHelp', { lead: t('brandKit.negativeLead') }) }}</span>
            </div>
          </div>

          <div class="srow">
            <div class="k">{{ t('brandKit.editor.refImages') }}</div>
            <div class="v">
              <div class="bke-thumbs">
                <div v-for="(u, i) in form.refImages" :key="u + i" class="bke-thumb">
                  <img :src="canvasImageThumb(u, 96)" alt="" />
                  <button class="bke-thumb-x" type="button" :title="t('common.remove')" :aria-label="t('common.remove')" :disabled="saving" @click="form.refImages.splice(i, 1)"><LcIcon name="x" size="s" /></button>
                </div>
                <button
                  v-if="form.refImages.length < BRAND_KIT_MAX_REFS"
                  class="bke-thumb add" type="button"
                  :disabled="uploading || saving"
                  :title="t('common.upload')" :aria-label="t('common.upload')"
                  @click="fileInput?.click()"
                ><span v-if="uploading" class="lc-ring spin sm" aria-hidden="true" /><LcIcon v-else name="plus" /></button>
                <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles" />
              </div>
              <span class="lc-help">{{ t('brandKit.editor.refImagesHelp', { max: BRAND_KIT_MAX_REFS }) }}</span>
            </div>
          </div>

          <div class="srow low">
            <div id="bke-default-lbl" class="k">{{ t('brandKit.editor.isDefault') }}</div>
            <div class="v">
              <button
                type="button" class="lc-switch" :class="{ on: form.isDefault }" role="switch"
                :aria-checked="form.isDefault" aria-labelledby="bke-default-lbl" :disabled="saving"
                data-testid="kit-default" @click="form.isDefault = !form.isDefault"
              />
              <span class="lc-help">{{ t('brandKit.editor.isDefaultHelp') }}</span>
            </div>
          </div>
        </div>

        <div class="lc-dialog-foot bke-foot">
          <ConfirmPop
            v-if="form.id"
            :text="t('brandKit.editor.removeConfirm', { name: kit?.name || form.name })"
            :hint="t('brandKit.editor.removeHint')"
            @ok="remove"
          >
            <button class="lc-btn danger" type="button" :disabled="saving" data-testid="kit-delete"><LcIcon name="trash" size="s" />{{ t('common.delete') }}</button>
          </ConfirmPop>
          <span class="lc-sp" />
          <button class="lc-btn" type="button" :disabled="saving" @click="close">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary quiet" type="submit" :disabled="saving || uploading" data-testid="kit-save">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 品牌包的编辑表单，一个弹窗：素材库的「品牌包」页和画布顶栏的选择器共用。
 * 在画布里改品牌包不用离开画布。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import LcIcon from '@/components/LcIcon.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import { brandKitApi, apiErrorMessage } from '@/utils/api'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { BRAND_KIT_MAX_REFS, type BrandKit } from '@/composables/useBrandKits'

const { t } = useI18n()

/** kit 为 null = 新建 */
const props = defineProps<{ open: boolean; kit: BrandKit | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', kit: BrandKit, created: boolean): void
  (e: 'removed', id: string): void
}>()

interface Form { id: string; name: string; refImages: string[]; promptPrefix: string; negativePrompt: string; isDefault: boolean }
const form = ref<Form | null>(null)
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

const title = computed(() => (form.value?.id ? t('brandKit.editor.editTitle') : t('brandKit.editor.createTitle')))

// 每次打开都从传进来的那份重新拷一份：直接改列表里的对象，取消时就回不去了
watch(() => props.open, (v) => {
  if (!v) { form.value = null; return }
  const k = props.kit
  form.value = {
    id: k?.id || '',
    name: k?.name || '',
    refImages: [...(k?.refImages || [])],
    promptPrefix: k?.promptPrefix || '',
    negativePrompt: k?.negativePrompt || '',
    isDefault: !!k?.isDefault,
  }
  if (!k) void nextTick(() => nameInput.value?.focus())
}, { immediate: true })

function close() { if (!saving.value) emit('close') }

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) { e.stopPropagation(); close() }
}
window.addEventListener('keydown', onKey, true)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  const f0 = form.value
  if (!files.length || !f0) return
  uploading.value = true
  for (const f of files) {
    if (f0.refImages.length >= BRAND_KIT_MAX_REFS) {
      MessagePlugin.warning(t('brandKit.editor.maxRefs', { max: BRAND_KIT_MAX_REFS }))
      break
    }
    try {
      f0.refImages.push(await uploadCanvasImage(f))
    } catch (err: any) {
      MessagePlugin.error(t('brandKit.editor.uploadItemFailed', {
        name: f.name, reason: apiErrorMessage(err, t('common.uploadFailed')),
      }))
    }
  }
  uploading.value = false
}

async function save() {
  const k = form.value
  if (!k || saving.value) return
  if (!k.name.trim()) {
    MessagePlugin.warning(t('brandKit.editor.nameRequired'))
    nameInput.value?.focus()
    return
  }
  saving.value = true
  try {
    const body = {
      name: k.name, refImages: k.refImages, promptPrefix: k.promptPrefix,
      negativePrompt: k.negativePrompt, isDefault: k.isDefault,
    }
    const res = k.id ? await brandKitApi.update(k.id, body) : await brandKitApi.create(body)
    if (res.data.result === 0 && res.data.data) {
      MessagePlugin.success(k.id ? t('common.saved') : t('brandKit.editor.created'))
      saving.value = false
      emit('saved', res.data.data as BrandKit, !k.id)
    } else {
      MessagePlugin.error(res.data.message || t('brandKit.editor.saveFailed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('brandKit.editor.saveFailed')))
  } finally {
    saving.value = false
  }
}

async function remove() {
  const k = form.value
  if (!k?.id || saving.value) return
  saving.value = true
  try {
    const res = await brandKitApi.remove(k.id)
    if (res.data.result === 0) {
      MessagePlugin.success(t('brandKit.editor.removed'))
      saving.value = false
      emit('removed', k.id)
    } else {
      MessagePlugin.error(res.data.message || t('brandKit.editor.removeFailed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('brandKit.editor.removeFailed')))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
@import '../settings/section-shared.css';

.bke { width: 640px; }
.bke-body { padding-top: 4px; padding-bottom: 12px; }
/* 弹窗比设置页窄：标签列收到 132px，控件占满剩下的 */
.bke-body .srow { grid-template-columns: 132px minmax(0, 1fr); gap: 8px 20px; }
.bke-body .srow > .v > .lc-input { max-width: none; }
.bke-body .lc-textarea { display: block; width: 100%; min-height: 84px; }
.bke-body .lc-textarea.bke-sm { min-height: 60px; }

.bke-thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
.bke-thumb {
  position: relative; width: 64px; height: 64px; padding: 0; border-radius: 10px; overflow: hidden;
  border: 1px solid var(--line); background: var(--media-bg);
}
.bke-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bke-thumb.add {
  display: grid; place-items: center; background: var(--well);
  border: 1px dashed var(--line-3); color: var(--text-3); cursor: pointer;
}
.bke-thumb.add:hover:not(:disabled) { border-color: var(--cyan); color: var(--cyan-soft); }
.bke-thumb.add:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.bke-thumb.add:disabled { cursor: default; }
.bke-thumb-x {
  position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; padding: 0;
  display: grid; place-items: center;
  border: 0; border-radius: 6px; background: rgb(var(--c-scrim) / .72); color: var(--on-scrim); cursor: pointer;
}
.bke-thumb-x:hover { background: rgb(var(--c-scrim) / .92); }
.bke-foot { align-items: center; }

@media (max-width: 720px) {
  .bke-body .srow { grid-template-columns: minmax(0, 1fr); }
}
</style>
