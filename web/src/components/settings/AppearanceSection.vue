<template>
  <SettingsSection id="appearance" icon="eye" :title="t('settings.appearance.title')" :desc="app.isOwner ? t('settings.appearance.descOwner') : t('settings.appearance.desc')">
    <!-- 每个人自己的：语言存在这台浏览器里，节点布局存在账号上 -->
    <SettingsCard :title="t('settings.appearance.personalTitle')" :desc="t('settings.appearance.personalDesc')">
      <div class="srow">
        <div id="ap-lang-lbl" class="k">{{ t('settings.appearance.language') }}</div>
        <div class="v">
          <div class="ctl lang">
            <LcIcon name="globe" />
            <LcSelect
              :model-value="app.locale"
              :options="LOCALE_OPTIONS"
              aria-labelledby="ap-lang-lbl"
              data-testid="appearance-language"
              @update:model-value="app.setLocale($event)"
            />
          </div>
          <span class="lc-help">{{ t('settings.appearance.languageHelp') }}</span>
        </div>
      </div>
      <!-- 画布上生成节点的布局：跟着账号存在服务端，点了就生效 -->
      <div class="srow">
        <div id="ap-layout-lbl" class="k">{{ t('settings.appearance.nodeLayout') }}</div>
        <div class="v">
          <NodeLayoutChooser :model-value="app.nodeLayout" labelledby="ap-layout-lbl" @update:model-value="pickLayout" />
          <span class="lc-help">{{ t('settings.appearance.nodeLayoutHelp') }}</span>
        </div>
      </div>
    </SettingsCard>

    <!-- 超级管理员：这台实例对所有人的默认值 -->
    <template v-if="app.isOwner">
      <SettingsCard v-if="loading" :title="t('settings.appearance.brandTitle')">
        <div class="sk" aria-busy="true"><i /><i /><i /></div>
      </SettingsCard>
      <SettingsCard v-else-if="loadError" :title="t('settings.appearance.brandTitle')">
        <div class="sec-state">
          <p class="lc-error-text">{{ loadError }}</p>
          <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
        </div>
      </SettingsCard>

      <form v-else class="stack" @submit.prevent="submit">
        <SettingsCard :title="t('settings.appearance.brandTitle')" :desc="t('settings.appearance.brandDesc')">
          <template #tag><span class="lc-tag">{{ t('settings.everyone') }}</span></template>
          <div class="srow">
            <div class="k"><label for="ap-name">{{ t('settings.appearance.siteName') }}</label></div>
            <div class="v">
              <input id="ap-name" v-model.trim="form.siteName" class="lc-input" maxlength="40" placeholder="LoomCanvas" :disabled="saving" />
              <span class="lc-help">{{ t('settings.appearance.siteNameHelp') }}</span>
            </div>
          </div>

          <div class="srow">
            <div class="k"><label for="ap-logo">{{ t('settings.appearance.logo') }}</label></div>
            <div class="v">
              <div class="logo-row">
                <span class="logo-preview">
                  <img v-if="form.logoUrl" :src="form.logoUrl" alt="" />
                  <LcIcon v-else name="image" />
                </span>
                <input id="ap-logo" v-model.trim="form.logoUrl" class="lc-input" :placeholder="t('settings.appearance.logoPlaceholder')" :disabled="saving" />
                <button type="button" class="lc-btn" :disabled="saving || uploading" @click="fileRef?.click()">
                  <LcIcon name="upload" size="s" />{{ uploading ? t('common.uploading') : t('common.upload') }}
                </button>
                <input ref="fileRef" type="file" accept="image/*" hidden @change="onFile" />
              </div>
              <span class="lc-help">{{ t('settings.appearance.logoHelp') }}</span>
            </div>
          </div>

          <div class="srow">
            <div id="ap-locale-lbl" class="k">{{ t('settings.appearance.defaultLocale') }}</div>
            <div class="v">
              <div class="ctl lang">
                <LcIcon name="globe" />
                <LcSelect v-model="form.defaultLocale" :options="LOCALE_OPTIONS" :disabled="saving" aria-labelledby="ap-locale-lbl" data-testid="appearance-default-locale" />
              </div>
              <span class="lc-help">{{ t('settings.appearance.defaultsHelp') }}</span>
            </div>
          </div>
        </SettingsCard>

        <p v-if="error" class="lc-error-text sec-err" role="alert">{{ error }}</p>
        <SaveBar :dirty="dirty" :note="t('settings.appearance.saveNote')">
          <button v-if="dirty" class="lc-btn ghost" type="button" :disabled="saving" @click="discard">{{ t('settings.discard') }}</button>
          <button class="lc-btn primary quiet" type="submit" :disabled="saving || !dirty" data-testid="appearance-save">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </SaveBar>
      </form>
    </template>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * 外观：界面语言（每个人自己的，存在浏览器里）、画布节点布局（每个人自己的，存在账号上），
 * 以及超级管理员才能改的实例默认值（站点名称、Logo、默认语言）。
 * 界面只有一套霓虹深色主题，所以这里没有主题选项；服务端已经没有「默认主题」这个设置项。
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { apiErrorMessage } from '@/utils/api'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { useAdminSettings } from '@/composables/useAdminSettings'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import LcSelect from '@/components/LcSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import type { NodeLayout } from '@/composables/nodeLayout'
import NodeLayoutChooser from './NodeLayoutChooser.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsCard from './SettingsCard.vue'
import SaveBar from './SaveBar.vue'
import { useSectionDirty } from './dirty'

const { t } = useI18n()
const app = useAppStore()

const { form, loading, loadError, saving, dirty, load, save, reset } = useAdminSettings(
  ['siteName', 'logoUrl', 'defaultLocale'] as const,
  { siteName: '', logoUrl: '', defaultLocale: 'zh-CN' },
)
// 实例设置只有超级管理员能读（其他人 403），不是就不去取
onMounted(() => { if (app.isOwner) void load() })
useSectionDirty(() => app.isOwner && dirty.value)

/** 选了就生效：本地先换，再存到账号上；没存上会自己改回去 */
async function pickLayout(v: NodeLayout) {
  if (v === app.nodeLayout) return
  try {
    await app.setNodeLayout(v)
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('settings.appearance.nodeLayoutFailed')))
  }
}

const error = ref('')
const uploading = ref(false)
const fileRef = ref<HTMLInputElement | null>(null)

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    form.value.logoUrl = await uploadCanvasImage(file)
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.uploadFailed')))
  } finally {
    uploading.value = false
  }
}

function discard() {
  error.value = ''
  reset()
}

async function submit() {
  error.value = ''
  try {
    await save()
    // 站点名称 / Logo 在顶栏上，存完立刻刷新启动信息
    await app.loadBootstrap()
    MessagePlugin.success(t('common.saved'))
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  }
}
</script>

<style scoped>
@import './section-shared.css';
.stack { display: grid; gap: 24px; min-width: 0; }
.srow > .v > .lang { position: relative; max-width: 260px; }
.lang > .lc-ic { position: absolute; left: 12px; top: 11px; color: var(--text-3); pointer-events: none; z-index: 1; }
.lang :deep(.lcs-trigger) { padding-left: 38px; }
.logo-row { display: flex; align-items: center; gap: 10px; max-width: 560px; }
.logo-row .lc-input { flex: 1; min-width: 0; }
.logo-row .lc-btn { height: 40px; }
.logo-preview {
  flex: none; display: grid; place-items: center; width: 40px; height: 40px; color: var(--text-3);
  border-radius: var(--r-sm); border: 1px dashed var(--line-3); background: var(--well); overflow: hidden;
}
.logo-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
@media (max-width: 720px) { .srow > .v > .lang { max-width: none; } }
@media (max-width: 600px) {
  .stack { gap: 16px; }
  .logo-row { flex-wrap: wrap; }
  .logo-row .lc-input { flex: 1 1 60%; }
}
</style>
