<template>
  <div v-if="open" class="lc-mask lc-sheet bk-mask" @click.self="close">
    <div class="lc-dialog bk-modal">
      <div class="lc-dialog-head">
        <span class="bk-title">{{ t('library.brandKit.title') }}<span class="bk-sub">{{ t('library.brandKit.subtitle') }}</span></span>
        <button class="lc-x" :title="t('common.close')" @click="close">×</button>
      </div>

      <div class="bk-body">
        <!-- 左：列表 -->
        <div class="bk-list">
          <button class="bk-new" @click="startNew">{{ t('library.brandKit.create') }}</button>
          <div v-if="!kits.length" class="bk-empty">{{ t('library.brandKit.listEmpty') }}</div>
          <button
            v-for="k in kits"
            :key="k.id"
            class="bk-item"
            :class="{ on: editing && editing.id === k.id }"
            @click="startEdit(k)"
          >
            <span class="bk-item-n">{{ k.name }}</span>
            <span class="bk-item-m">
              <span v-if="k.isDefault" class="lc-chip bk-tag">{{ t('library.brandKit.isDefault') }}</span>
              <span class="bk-item-c">{{ t('library.brandKit.refCount', { n: (k.refImages || []).length }) }}</span>
            </span>
          </button>
        </div>

        <!-- 右：编辑 -->
        <div class="bk-edit">
          <div v-if="!editing" class="bk-empty">{{ t('library.brandKit.pickHint') }}</div>
          <template v-else>
            <div class="bk-f">
              <label>{{ t('library.brandKit.name') }}</label>
              <input v-model="editing.name" class="lc-input" maxlength="40" :placeholder="t('library.brandKit.namePlaceholder')" />
            </div>

            <div class="bk-f">
              <label>
                {{ t('library.brandKit.refImages') }}
                <span class="bk-hint">{{ t('library.brandKit.refImagesHint', { max: MAX_REFS }) }}</span>
              </label>
              <div class="bk-thumbs">
                <div v-for="(u, i) in editing.refImages" :key="u + i" class="bk-thumb">
                  <img :src="canvasImageThumb(u, 96)" alt="" />
                  <button class="bk-thumb-x" :title="t('common.remove')" @click="editing.refImages.splice(i, 1)">×</button>
                </div>
                <button
                  v-if="editing.refImages.length < MAX_REFS"
                  class="bk-thumb add"
                  :disabled="uploading"
                  :title="t('common.upload')"
                  @click="fileInput?.click()"
                ><template v-if="uploading">…</template><LcIcon v-else name="plus" /></button>
                <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles" />
              </div>
            </div>

            <div class="bk-f">
              <label>{{ t('library.brandKit.promptPrefix') }} <span class="bk-hint">{{ t('library.brandKit.promptPrefixHint') }}</span></label>
              <textarea v-model="editing.promptPrefix" class="lc-textarea" rows="3" maxlength="1000"
                :placeholder="t('library.brandKit.promptPrefixPlaceholder')"></textarea>
            </div>

            <div class="bk-f">
              <label>
                {{ t('library.brandKit.negative') }}
                <span class="bk-hint">{{ t('library.brandKit.negativeHint') }}</span>
              </label>
              <textarea v-model="editing.negativePrompt" class="lc-textarea bk-ta-sm" rows="2" maxlength="500"
                :placeholder="t('library.brandKit.negativePlaceholder')"></textarea>
            </div>

            <div class="bk-row">
              <label class="lc-check">
                <input type="checkbox" v-model="editing.isDefault" />
                <span class="box" />
                <span>{{ t('library.brandKit.autoApply') }}</span>
              </label>
            </div>
          </template>
        </div>
      </div>

      <div class="lc-dialog-foot bk-foot">
        <button v-if="editing && editing.id" class="lc-btn danger" @click="remove">{{ t('common.delete') }}</button>
        <span class="bk-spacer"></span>
        <button class="lc-btn" @click="close">{{ t('common.close') }}</button>
        <button v-if="editing" class="lc-btn primary quiet" :disabled="saving" @click="save">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 品牌包管理弹窗：左边列表，右边编辑。
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { brandKitApi, apiErrorMessage } from '@/utils/api'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import type { BrandKit } from '@/composables/useBrandKits'

const { t } = useI18n()

const MAX_REFS = 5

const props = defineProps<{ open: boolean; kits: BrandKit[] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed'): void }>()

const editing = ref<BrandKit | null>(null)
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// 弹窗关掉时清掉编辑态，免得下次打开还停在上一个上面
watch(() => props.open, (v) => { if (!v) editing.value = null })

function blank(): BrandKit {
  return {
    id: '', name: '', refImages: [], promptPrefix: '', negativePrompt: '',
    defaultRatio: '', defaultModel: '', isDefault: false,
  }
}
function startNew() { editing.value = blank() }
function startEdit(k: BrandKit) {
  // 深拷一份再改：直接改列表里那个对象，取消时就回不去了
  editing.value = JSON.parse(JSON.stringify({ ...k, refImages: [...(k.refImages || [])] }))
}
function close() { emit('close') }

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length || !editing.value) return
  uploading.value = true
  for (const f of files) {
    if (editing.value.refImages.length >= MAX_REFS) {
      MessagePlugin.warning(t('library.brandKit.maxRefs', { max: MAX_REFS }))
      break
    }
    try {
      editing.value.refImages.push(await uploadCanvasImage(f))
    } catch (err: any) {
      MessagePlugin.error(t('library.brandKit.uploadItemFailed', {
        name: f.name, reason: apiErrorMessage(err, t('common.uploadFailed')),
      }))
    }
  }
  uploading.value = false
}

async function save() {
  const k = editing.value
  if (!k) return
  if (!k.name.trim()) { MessagePlugin.warning(t('library.brandKit.nameRequired')); return }
  saving.value = true
  try {
    const body = {
      name: k.name, refImages: k.refImages, promptPrefix: k.promptPrefix,
      negativePrompt: k.negativePrompt, isDefault: k.isDefault,
    }
    const res = k.id ? await brandKitApi.update(k.id, body) : await brandKitApi.create(body)
    if (res.data.result === 0) {
      MessagePlugin.success(k.id ? t('common.saved') : t('library.brandKit.created'))
      editing.value = null
      emit('changed')
    } else {
      MessagePlugin.error(res.data.message || t('library.brandKit.saveFailed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('library.brandKit.saveFailed')))
  } finally {
    saving.value = false
  }
}

async function remove() {
  const k = editing.value
  if (!k?.id) return
  const ok = await new Promise<boolean>((resolve) => {
    const dlg = DialogPlugin.confirm({
      header: t('library.brandKit.removeTitle'),
      body: t('library.brandKit.removeConfirm', { name: k.name }),
      confirmBtn: t('common.delete'), cancelBtn: t('common.cancel'),
      zIndex: 9100,
      onConfirm: () => { dlg.destroy(); resolve(true) },
      onCancel: () => { dlg.destroy(); resolve(false) },
      onClose: () => { dlg.destroy(); resolve(false) },
    })
  })
  if (!ok) return
  try {
    const res = await brandKitApi.remove(k.id)
    if (res.data.result === 0) {
      MessagePlugin.success(t('library.brandKit.removed'))
      editing.value = null
      emit('changed')
    } else {
      MessagePlugin.error(res.data.message || t('library.brandKit.removeFailed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('library.brandKit.removeFailed')))
  }
}
</script>

<style scoped>
.bk-mask { z-index: 9000; }
.bk-modal { width: 800px; }
.bk-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
.bk-sub { font: 400 12px var(--f-body); color: var(--text-3); }

.bk-body { flex: 1; display: grid; grid-template-columns: 240px 1fr; min-height: 340px; overflow: hidden; }
.bk-list { border-right: 1px solid var(--line); padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.bk-new {
  flex: none; height: 40px; display: flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px dashed var(--line-3); background: transparent; color: var(--text-2);
  border-radius: 10px; font-size: 13px; cursor: pointer;
}
.bk-new:hover { border-color: var(--cyan); color: var(--cyan-soft); }
.bk-item {
  flex: none; text-align: left; border: 1px solid var(--line); background: var(--grad-card);
  border-radius: 10px; padding: 10px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 4px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.bk-item:hover { border-color: var(--line-3); }
.bk-item.on { border-color: rgba(63, 216, 255, .55); box-shadow: var(--glow-s); }
.bk-item-n { font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-item-m { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.bk-item-c { font-size: 12px; color: var(--text-3); }
.bk-tag { height: 18px; font-size: 11px; }

.bk-edit { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.bk-empty { font-size: 13px; color: var(--text-3); line-height: 1.7; padding: 10px 0; }
.bk-f { display: flex; flex-direction: column; gap: 6px; }
.bk-f label { font-size: 13px; color: var(--text-2); display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.bk-hint { font-size: 12px; color: var(--text-3); font-weight: 400; }
.bk-ta-sm { min-height: 60px; }

.bk-thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
.bk-thumb { position: relative; width: 56px; height: 56px; padding: 0; border-radius: 9px; overflow: hidden; border: 1px solid var(--line); background: var(--media-bg); }
.bk-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bk-thumb.add {
  display: grid; place-items: center; background: rgba(4, 9, 28, .3);
  border: 1px dashed var(--line-3); color: var(--text-3); font-size: 16px; cursor: pointer;
}
.bk-thumb.add:hover:not(:disabled) { border-color: var(--cyan); color: var(--cyan-soft); }
.bk-thumb-x {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0;
  border: none; border-radius: 5px; background: rgba(4, 9, 28, .7); color: var(--on-scrim); font-size: 13px; line-height: 18px; cursor: pointer;
}

.bk-row { display: flex; gap: 20px; flex-wrap: wrap; font-size: 13px; }
.bk-foot { align-items: center; }
.bk-spacer { flex: 1; }

@media (max-width: 700px) {
  .bk-body { display: flex; flex-direction: column; overflow-y: auto; min-height: 0; }
  .bk-list { flex: none; border-right: none; border-bottom: 1px solid var(--line); max-height: 190px; }
  .bk-edit { overflow: visible; }
}
</style>
