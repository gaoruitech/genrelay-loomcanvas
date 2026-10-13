<template>
  <SettingsSection id="appearance" icon="eye" :title="t('settings.appearance.title')" :desc="desc">
    <!-- 每个人自己的：语言存在这台浏览器里，主题和节点布局存在账号上。三项都被集成方关掉时（只有超级管理员还进得来）这张卡片不出 -->
    <SettingsCard v-if="$feat.localeSwitch || $feat.themeSwitch || $feat.nodeLayoutSwitch" :title="t('settings.appearance.personalTitle')" :desc="t('settings.appearance.personalDesc')" data-testid="appearance-personal">
      <div v-if="$feat.localeSwitch" class="srow">
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
      <!-- 主题：深色 / 浅色 / 跟随系统。跟着账号存在服务端，同时记在这台浏览器上（没登录的页面和首帧用） -->
      <div v-if="$feat.themeSwitch" class="srow">
        <div id="ap-theme-lbl" class="k">{{ t('settings.appearance.theme') }}</div>
        <div class="v">
          <ThemeChooser :model-value="app.theme" labelledby="ap-theme-lbl" @update:model-value="pickTheme" />
          <span v-if="themeHelp" class="lc-help" data-testid="appearance-theme-help">{{ themeHelp }}</span>
        </div>
      </div>
      <!-- 画布上生成节点的布局：跟着账号存在服务端，点了就生效 -->
      <div v-if="$feat.nodeLayoutSwitch" class="srow">
        <div id="ap-layout-lbl" class="k">{{ t('settings.appearance.nodeLayout') }}</div>
        <div class="v">
          <NodeLayoutChooser :model-value="app.nodeLayout" labelledby="ap-layout-lbl" @update:model-value="pickLayout" />
          <span class="lc-help" data-testid="appearance-layout-help">{{ nodeLayoutHelp }}</span>
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
                <span class="logo-preview" :class="{ bad: logoBroken }" data-testid="appearance-logo-preview">
                  <img v-if="logoShown && !logoBroken" :src="logoShown" alt="" @error="logoBroken = true" />
                  <LcIcon v-else :name="logoBroken ? 'warn' : 'image'" />
                </span>
                <input
                  id="ap-logo" ref="logoInput" v-model.trim="form.logoUrl" class="lc-input" :class="{ 'is-err': logoBroken }"
                  :placeholder="t('settings.appearance.logoPlaceholder')" :disabled="saving" spellcheck="false" autocomplete="off"
                  @input="logoTyped = true"
                />
                <button type="button" class="lc-btn" :disabled="saving || uploading" data-testid="appearance-logo-upload" @click="fileRef?.click()">
                  <LcIcon name="upload" size="s" />{{ uploading ? t('common.uploading') : t('common.upload') }}
                </button>
                <button
                  v-if="form.logoUrl" type="button" class="lc-btn ghost" :disabled="saving || uploading"
                  data-testid="appearance-logo-remove" @click="removeLogo"
                >{{ t('settings.appearance.logoRemove') }}</button>
                <input ref="fileRef" type="file" accept="image/*" hidden data-testid="appearance-logo-file" @change="onFile" />
              </div>
              <span v-if="logoBroken" class="lc-help err" role="alert">{{ t('settings.appearance.logoBroken') }}</span>
              <span class="lc-help">{{ t('settings.appearance.logoHelp') }}</span>
            </div>
          </div>

          <!-- 有 Logo 时旁边写不写站点名称：本身带着名称的 Logo（字标）可以单独出现。右边是页头上会是什么样 -->
          <div class="srow low">
            <div id="ap-showname-lbl" class="k">{{ t('settings.appearance.showSiteName') }}</div>
            <div class="v">
              <div class="inline">
                <button
                  type="button" class="lc-switch" :class="{ on: form.showSiteName }" role="switch" :aria-checked="form.showSiteName"
                  aria-labelledby="ap-showname-lbl" aria-describedby="ap-showname-help" :disabled="saving || !form.logoUrl"
                  data-testid="appearance-show-name" @click="form.showSiteName = !form.showSiteName"
                />
                <span v-if="form.logoUrl" class="sn-state" data-testid="appearance-show-name-state">{{ form.showSiteName ? t('settings.appearance.showSiteNameOn') : t('settings.appearance.showSiteNameOff') }}</span>
                <span v-if="logoShown && !logoBroken" class="lockup" aria-hidden="true" data-testid="appearance-lockup">
                  <span class="lc-logo"><img :src="logoShown" class="lc-logo-img" alt="" /><span v-if="form.showSiteName" class="lc-logo-name">{{ form.siteName || 'LoomCanvas' }}</span></span>
                </span>
              </div>
              <span id="ap-showname-help" class="lc-help">{{ form.logoUrl ? t('settings.appearance.showSiteNameHelp') : t('settings.appearance.showSiteNameNoLogo') }}</span>
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
 * 外观：界面语言（每个人自己的，存在浏览器里）、主题和画布节点布局（每个人自己的，存在账号上），
 * 以及超级管理员才能改的实例默认值（站点名称、Logo、Logo 旁边写不写名称、默认语言）。
 * 主题是每个人自己的偏好，没有「站点默认主题」这个设置项：没选过的账号一律是深色。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { apiErrorMessage } from '@/utils/api'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { useAdminSettings } from '@/composables/useAdminSettings'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import LcSelect from '@/components/LcSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import type { NodeLayout } from '@/composables/nodeLayout'
import type { ThemePref } from '@/composables/useTheme'
import NodeLayoutChooser from './NodeLayoutChooser.vue'
import ThemeChooser from './ThemeChooser.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsCard from './SettingsCard.vue'
import SaveBar from './SaveBar.vue'
import { useSectionDirty } from './dirty'
import { joinSentences } from './sentences'
import { useEmbed } from '@/embed/context'
import { isPageOpen } from '@/embed/options'

const { t, locale } = useI18n()
const app = useAppStore()
const embed = useEmbed()

/**
 * 说明文字是按这次挂载里有什么拼的，关掉的东西不提：
 * 语言 / 主题 / 节点布局可以各自关掉；宿主管登录时（features.account 关着）不说「跟着账号走」——
 * 那时偏好跟的是宿主的那个人，后端不认识他的话只留在这个页面里；没有外壳就没有顶栏上的图标；
 * 没有登录页（宿主管登录）、没有分享页（分享关了或那一页没开放）时不拿它们举例。
 */
const say = (key: string) => t('settings.appearance.' + key)
const desc = computed(() => {
  const f = embed.features
  const kept = f.account && (f.themeSwitch && f.nodeLayoutSwitch ? 'keptBoth' : f.themeSwitch ? 'keptTheme' : f.nodeLayoutSwitch ? 'keptLayout' : '')
  const own = joinSentences([f.localeSwitch && say('desc.language'), kept && say('desc.' + kept)], locale.value)
  const site = app.isOwner && say('desc.site')
  return joinSentences([own || (!site && say('desc.plain')), site], locale.value)
})
const themeHelp = computed(() => {
  const signIn = !embed.hostAuth
  const share = embed.features.share && isPageOpen(embed, 'share')
  return joinSentences([
    embed.features.account && say('themeKept'),
    embed.shell !== 'none' && say('themeTopBar'),
    signIn && share ? say('themeBrowserBoth') : signIn ? say('themeBrowserSignIn') : share ? say('themeBrowserShare') : '',
  ], locale.value)
})
const nodeLayoutHelp = computed(() => joinSentences([
  say('nodeLayoutWhat'), embed.features.account && say('nodeLayoutKept'), isPageOpen(embed, 'canvas') && say('nodeLayoutMenu'),
], locale.value))

const { form, loading, loadError, saving, dirty, load, save, reset } = useAdminSettings(
  ['siteName', 'logoUrl', 'showSiteName', 'defaultLocale'] as const,
  { siteName: '', logoUrl: '', showSiteName: true, defaultLocale: 'zh-CN' },
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

/** 主题同理：立刻换，再存到账号上；没存上会改回去 */
async function pickTheme(v: ThemePref) {
  if (v === app.theme) return
  try {
    await app.setTheme(v)
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('shell.theme.failed')))
  }
}

const error = ref('')
const uploading = ref(false)
const fileRef = ref<HTMLInputElement | null>(null)
/** 填的地址加载不出图片：预览位换成警告，输入框标红（照样能存，可能只是这台机器够不着那个地址） */
const logoBroken = ref(false)
/** 预览用的地址：跟着输入框走，但等手停下来再换（不然每敲一个字符就去请求一张不存在的图） */
const logoShown = ref('')
let logoTimer = 0
/** 这一次改动是在输入框里敲出来的（@input 先于 watch 触发） */
let logoTyped = false
watch(() => form.value.logoUrl, (v) => {
  window.clearTimeout(logoTimer)
  const show = () => { logoBroken.value = false; logoShown.value = v }
  // 敲出来的等手停下；别处来的（加载出来、上传完、移除、放弃修改）立刻换
  if (logoTyped && v) logoTimer = window.setTimeout(show, 500)
  else show()
  logoTyped = false
}, { immediate: true })
onBeforeUnmount(() => window.clearTimeout(logoTimer))
const logoInput = ref<HTMLInputElement | null>(null)
/** 移除 Logo：清空地址，保存后顶栏和登录页回到默认图标。「移除」这颗按钮跟着消失，焦点交给地址框（不让它丢掉） */
function removeLogo() {
  form.value.logoUrl = ''
  logoInput.value?.focus()
}

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
.logo-row { display: flex; align-items: center; gap: 10px; max-width: 600px; }
.logo-preview.bad { color: var(--warn); border-color: rgb(var(--c-warn) / .5); }
.logo-row .lc-input { flex: 1; min-width: 0; }
.logo-row .lc-btn { height: 40px; }
/* 预览和顶栏里显示的是同一个大小（高 28px，最宽 132px，见 LcLogo）：横版的图在这里也看得清，存之前就知道顶栏上会是什么样 */
.logo-preview {
  flex: none; display: grid; place-items: center; min-width: 40px; height: 40px; padding: 0 5px; color: var(--text-3);
  border-radius: var(--r-sm); border: 1px dashed var(--line-3); background: var(--well); overflow: hidden;
}
.logo-preview img { display: block; height: 28px; width: auto; max-width: 132px; object-fit: contain; }
.sn-state { color: var(--text-2); }
/* 页头上那一块（Logo + 名称）会是什么样：用的就是 LcLogo 的那几条样式 */
.lockup {
  display: inline-flex; align-items: center; min-width: 0; max-width: 100%; height: 40px; padding: 0 12px; margin-left: 4px;
  border-radius: var(--r-sm); border: 1px dashed var(--line-3); background: var(--well);
}
@media (max-width: 720px) { .srow > .v > .lang { max-width: none; } }
@media (max-width: 600px) {
  .stack { gap: 16px; }
  .logo-row { flex-wrap: wrap; }
  .logo-row .lc-input { flex: 1 1 60%; }
}
</style>
