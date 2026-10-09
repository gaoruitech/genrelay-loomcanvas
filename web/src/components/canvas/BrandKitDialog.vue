<template>
  <div v-if="open" class="bk-mask" @click.self="close">
    <div class="bk-modal">
      <div class="bk-head">
        <span class="bk-title">{{ t('library.brandKit.title') }}</span>
        <span class="bk-sub">{{ t('library.brandKit.subtitle') }}</span>
        <button class="bk-close" :title="t('common.close')" @click="close">×</button>
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
              <span v-if="k.isDefault" class="bk-tag">{{ t('library.brandKit.isDefault') }}</span>
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
              <input v-model="editing.name" class="bk-in" maxlength="40" :placeholder="t('library.brandKit.namePlaceholder')" />
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
                >{{ uploading ? '…' : '+' }}</button>
                <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles" />
              </div>
            </div>

            <div class="bk-f">
              <label>{{ t('library.brandKit.promptPrefix') }} <span class="bk-hint">{{ t('library.brandKit.promptPrefixHint') }}</span></label>
              <textarea v-model="editing.promptPrefix" class="bk-in ta" rows="3" maxlength="1000"
                :placeholder="t('library.brandKit.promptPrefixPlaceholder')"></textarea>
            </div>

            <div class="bk-f">
              <label>
                {{ t('library.brandKit.negative') }}
                <span class="bk-hint">{{ t('library.brandKit.negativeHint') }}</span>
              </label>
              <textarea v-model="editing.negativePrompt" class="bk-in ta" rows="2" maxlength="500"
                :placeholder="t('library.brandKit.negativePlaceholder')"></textarea>
            </div>

            <div class="bk-row">
              <label class="bk-ck">
                <input type="checkbox" v-model="editing.isDefault" />
                <span>{{ t('library.brandKit.autoApply') }}</span>
              </label>
            </div>
          </template>
        </div>
      </div>

      <div class="bk-foot">
        <button v-if="editing && editing.id" class="bk-btn danger" @click="remove">{{ t('common.delete') }}</button>
        <span class="bk-spacer"></span>
        <button class="bk-btn" @click="close">{{ t('common.close') }}</button>
        <button v-if="editing" class="bk-btn primary" :disabled="saving" @click="save">
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
.bk-mask { position: fixed; inset: 0; z-index: 9000; background: var(--scrim); display: flex; align-items: center; justify-content: center; }
.bk-modal {
  width: 780px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  background: var(--n-3); border: 1px solid var(--n-5); border-radius: 12px;
  color: var(--t-strong); overflow: hidden;
}
.bk-head { display: flex; align-items: baseline; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--n-5); }
.bk-title { font-weight: 600; color: var(--t-max); }
.bk-sub { font-size: 12px; color: var(--t-dim); }
.bk-close { margin-left: auto; background: none; border: none; color: var(--t-dim); font-size: 22px; line-height: 1; cursor: pointer; }

.bk-body { display: grid; grid-template-columns: 240px 1fr; min-height: 340px; overflow: hidden; }
.bk-list { border-right: 1px solid var(--n-5); padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.bk-new {
  border: 1px dashed var(--n-5); background: transparent; color: var(--t-body);
  border-radius: 7px; padding: 8px; font-size: 12.5px; cursor: pointer;
}
.bk-new:hover { border-color: var(--accent-text); color: var(--accent-text); }
.bk-item {
  text-align: left; border: 1px solid var(--n-5); background: var(--n-2);
  border-radius: 7px; padding: 9px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 4px;
}
.bk-item:hover, .bk-item.on { border-color: var(--accent-text); }
.bk-item-n { font-size: 13px; font-weight: 600; color: var(--t-max); }
.bk-item-m { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.bk-item-c { font-size: 11px; color: var(--t-dim); }
.bk-tag { font-size: 10px; padding: 1px 6px; border-radius: 100px; border: 1px solid var(--n-5); color: var(--t-body); }

.bk-edit { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.bk-empty { font-size: 12.5px; color: var(--t-dim); line-height: 1.75; padding: 10px 0; }
.bk-f { display: flex; flex-direction: column; gap: 6px; }
.bk-f label { font-size: 12px; color: var(--t-body); display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.bk-hint { font-size: 10.5px; color: var(--t-dim); font-weight: 400; }
.bk-in {
  background: var(--n-2); border: 1px solid var(--n-5); border-radius: 6px;
  padding: 7px 10px; font-size: 13px; color: var(--t-strong); outline: none; font-family: inherit;
}
.bk-in:focus { border-color: var(--accent-text); }
.bk-in.ta { resize: vertical; line-height: 1.6; }

.bk-thumbs { display: flex; flex-wrap: wrap; gap: 7px; }
.bk-thumb { position: relative; width: 54px; height: 54px; border-radius: 6px; overflow: hidden; border: 1px solid var(--n-5); background: var(--n-2); }
.bk-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bk-thumb.add {
  display: flex; align-items: center; justify-content: center;
  border-style: dashed; color: var(--t-dim); font-size: 18px; cursor: pointer;
}
.bk-thumb.add:hover { border-color: var(--accent-text); color: var(--accent-text); }
.bk-thumb-x {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; padding: 0;
  border: none; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; line-height: 16px; cursor: pointer;
}

.bk-row { display: flex; gap: 20px; flex-wrap: wrap; }
.bk-ck { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--t-body); cursor: pointer; }

.bk-foot { display: flex; align-items: center; gap: 8px; padding: 13px 20px; border-top: 1px solid var(--n-5); }
.bk-spacer { flex: 1; }
.bk-btn {
  padding: 7px 14px; border-radius: 8px; font-size: 13px; cursor: pointer;
  background: var(--n-3); border: 1px solid var(--n-5); color: var(--t-body); transition: all .15s ease;
}
.bk-btn:hover:not(:disabled) { border-color: var(--accent-text); color: var(--accent-text); }
.bk-btn:disabled { opacity: .5; cursor: not-allowed; }
.bk-btn.primary { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--accent-text); }
.bk-btn.primary:hover:not(:disabled) { background: var(--btn-bg-hover); color: var(--btn-fg); }
.bk-btn.danger:hover { border-color: #e06a5c; color: #e06a5c; }

@media (max-width: 700px) {
  .bk-body { grid-template-columns: 1fr; }
  .bk-list { border-right: none; border-bottom: 1px solid var(--n-5); max-height: 180px; }
}
</style>
