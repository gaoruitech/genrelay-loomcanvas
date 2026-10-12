<template>
  <div class="lc-page">
    <div class="lc-page-inner">
      <div class="lc-page-head">
        <div class="bk-head-text">
          <h1 class="lc-ph1">{{ t('assetsPage.title') }}</h1>
          <p class="lc-ph-sub">{{ t('assetsPage.sub') }}</p>
        </div>
        <span class="lc-sp" />
        <button v-if="kits.length" class="lc-btn primary bk-new" type="button" :disabled="atLimit" data-testid="kit-create" @click="openEditor(null)">
          <LcIcon name="plus" />{{ t('brandKit.page.create') }}
        </button>
      </div>

      <AssetsTabs current="brand-kits" />

      <div v-if="failed && !kits.length" class="lc-alert bk-error" role="alert">
        <LcIcon name="warn" />
        <span>{{ t('brandKit.page.loadFailed') }}</span>
        <button class="lc-btn sm" type="button" @click="load(true)">{{ t('common.retry') }}</button>
      </div>

      <div v-else-if="!loaded" class="bk-grid" aria-busy="true">
        <div v-for="n in 3" :key="n" class="lc-card bk-card skel-card" aria-hidden="true">
          <span class="skel w40" /><span class="skel w70" /><span class="skel w50" />
        </div>
      </div>

      <!-- 一个都没有：先把它是什么讲清楚，再给一个具体的例子 -->
      <div v-else-if="!kits.length" class="lc-card bk-empty" data-testid="kit-empty">
        <span class="bk-ti"><LcIcon name="star" size="l" /></span>
        <h2>{{ t('brandKit.page.emptyTitle') }}</h2>
        <p>{{ t('brandKit.explain.summary') }}</p>
        <p class="eg">{{ t('brandKit.page.example') }}</p>
        <p class="dim">{{ t('brandKit.explain.limits') }}</p>
        <button class="lc-btn primary" type="button" data-testid="kit-create" @click="openEditor(null)"><LcIcon name="plus" />{{ t('brandKit.page.create') }}</button>
        <small>{{ t('brandKit.page.howTo') }}</small>
      </div>

      <template v-else>
        <section class="lc-card bk-about" data-testid="kit-about">
          <h2><LcIcon name="info" size="s" />{{ t('brandKit.page.aboutTitle') }}</h2>
          <p>{{ t('brandKit.explain.summary') }}</p>
          <p class="dim">{{ t('brandKit.explain.limits') }}</p>
          <p class="dim">{{ t('brandKit.page.howTo') }}</p>
        </section>

        <div class="bk-grid">
          <article v-for="k in kits" :key="k.id" class="lc-card bk-card" :data-kit="k.id">
            <div class="bk-refs" :class="{ none: !k.refImages.length }">
              <template v-if="k.refImages.length">
                <span v-for="u in k.refImages" :key="u" class="lc-thumb bk-ref"><img :src="canvasImageThumb(u, 96)" alt="" loading="lazy" /></span>
              </template>
              <span v-else>{{ t('brandKit.page.noRefs') }}</span>
            </div>

            <div class="bk-body">
              <h3 :title="k.name"><span>{{ k.name }}</span><span v-if="k.isDefault" class="lc-tag">{{ t('brandKit.isDefault') }}</span></h3>
              <p class="bk-sum">{{ brandKitSummary(k) }}</p>
              <dl v-if="k.promptPrefix.trim() || k.negativePrompt.trim()" class="bk-text">
                <template v-if="k.promptPrefix.trim()"><dt>{{ t('brandKit.page.prefixLabel') }}</dt><dd :title="k.promptPrefix">{{ k.promptPrefix }}</dd></template>
                <template v-if="k.negativePrompt.trim()"><dt>{{ t('brandKit.page.negativeLabel') }}</dt><dd :title="k.negativePrompt">{{ k.negativePrompt }}</dd></template>
              </dl>
            </div>

            <footer class="bk-foot">
              <span class="bk-used">{{ k.usedBy ? t('brandKit.usedBy', { n: k.usedBy }, k.usedBy) : t('brandKit.usedByNone') }}</span>
              <span class="lc-sp" />
              <button
                class="lc-tb sm" :class="{ on: k.isDefault }" type="button" :disabled="busy === k.id"
                :title="k.isDefault ? t('brandKit.page.unsetDefault') : t('brandKit.page.setDefault')"
                :aria-label="k.isDefault ? t('brandKit.page.unsetDefault') : t('brandKit.page.setDefault')"
                :aria-pressed="k.isDefault" data-act="default" @click="toggleDefault(k)"
              ><LcIcon name="star" size="s" /></button>
              <button class="lc-tb sm" type="button" :disabled="busy === k.id || atLimit" :title="t('brandKit.page.duplicate')" :aria-label="t('brandKit.page.duplicate')" data-act="duplicate" @click="duplicate(k)"><LcIcon name="copy" size="s" /></button>
              <ConfirmPop :text="t('brandKit.editor.removeConfirm', { name: k.name })" :hint="t('brandKit.editor.removeHint')" @ok="remove(k)">
                <button class="lc-tb sm bk-del" type="button" :disabled="busy === k.id" :title="t('common.delete')" :aria-label="t('common.delete')" data-act="delete"><LcIcon name="trash" size="s" /></button>
              </ConfirmPop>
              <button class="lc-btn sm" type="button" data-act="edit" @click="openEditor(k)"><LcIcon name="edit" size="s" />{{ t('common.edit') }}</button>
            </footer>
          </article>
        </div>

        <p class="bk-count">{{ t('brandKit.page.count', { n: kits.length, max: MAX_KITS }) }}</p>
      </template>
    </div>

    <BrandKitEditorDialog :open="editor.open" :kit="editor.kit" @close="editor.open = false" @saved="onSaved" @removed="onSaved" />
  </div>
</template>

<script setup lang="ts">
/**
 * 素材库 › 品牌包：建、改、复制、删、设默认都在这里。
 * 页面先讲清楚品牌包是什么、运行时会做什么（和画布顶栏选择器里是同一段话），再列出每一个。
 * 给哪张画布用，是在那张画布的顶栏上选的。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import AssetsTabs from '@/components/AssetsTabs.vue'
import BrandKitEditorDialog from '@/components/brandkit/BrandKitEditorDialog.vue'
import { brandKitApi, apiErrorMessage } from '@/utils/api'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { useBrandKits, brandKitSummary, type BrandKit } from '@/composables/useBrandKits'

const { t } = useI18n()

/** 每个账号最多几个（后端同一个上限） */
const MAX_KITS = 50

const { kits, loaded, failed, load } = useBrandKits()
const atLimit = computed(() => kits.value.length >= MAX_KITS)
onMounted(() => { void load() })

const editor = ref<{ open: boolean; kit: BrandKit | null }>({ open: false, kit: null })
function openEditor(kit: BrandKit | null) { editor.value = { open: true, kit } }
function onSaved() {
  editor.value.open = false
  void load(true)
}

/** 正在对哪一个做操作：它的按钮先禁用，免得连点 */
const busy = ref('')

async function toggleDefault(k: BrandKit) {
  busy.value = k.id
  try {
    const next = !k.isDefault
    const res = await brandKitApi.update(k.id, { isDefault: next })
    if (res.data.result !== 0) throw new Error(res.data.message || '')
    MessagePlugin.success(next ? t('brandKit.page.defaultSet', { name: k.name }) : t('brandKit.page.defaultCleared'))
    await load(true)
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('brandKit.page.updateFailed')))
  } finally {
    busy.value = ''
  }
}

async function duplicate(k: BrandKit) {
  busy.value = k.id
  try {
    const res = await brandKitApi.create({
      name: t('common.copyName', { name: k.name }).slice(0, 40),
      refImages: k.refImages, promptPrefix: k.promptPrefix, negativePrompt: k.negativePrompt,
      // 默认只能有一个，副本不抢
      isDefault: false,
    })
    if (res.data.result !== 0) throw new Error(res.data.message || '')
    MessagePlugin.success(t('brandKit.page.duplicated'))
    await load(true)
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('brandKit.page.duplicateFailed')))
  } finally {
    busy.value = ''
  }
}

async function remove(k: BrandKit) {
  busy.value = k.id
  try {
    const res = await brandKitApi.remove(k.id)
    if (res.data.result !== 0) throw new Error(res.data.message || '')
    MessagePlugin.success(t('brandKit.editor.removed'))
    await load(true)
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('brandKit.editor.removeFailed')))
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.bk-head-text { min-width: 0; flex: 1 1 320px; }
.bk-new { height: 40px; padding: 0 20px; }
.bk-error { margin-top: 16px; align-items: center; }
.bk-error > span { flex: 1; min-width: 0; }

/* 说明：一张不抢眼的卡片，正文限宽好读 */
.bk-about { margin-top: 16px; padding: 16px 20px; display: grid; gap: 6px; background: rgb(var(--c-well) / .3); }
.bk-about h2 { display: flex; align-items: center; gap: 8px; font: 600 14px/1.5 var(--f-disp); color: var(--text); }
.bk-about h2 :deep(svg) { color: var(--cyan); }
.bk-about p { font-size: 13px; line-height: 1.7; color: var(--text-2); max-width: 880px; }
.bk-about p.dim { color: var(--text-3); }

.bk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-top: 16px; }
.bk-card { display: flex; flex-direction: column; min-width: 0; overflow: hidden; transition: border-color .15s; }
.bk-card:not(.skel-card):hover { border-color: var(--line-3); }
.bk-refs { display: flex; gap: 6px; padding: 12px 12px 0; min-height: 68px; }
.bk-refs.none {
  margin: 12px 12px 0; padding: 0; min-height: 56px; align-items: center; justify-content: center; border-radius: 10px;
  border: 1px dashed var(--line-2); color: var(--text-3); font-size: 12px;
}
.bk-ref { width: 56px; height: 56px; border-radius: 10px; flex: none; border: 1px solid var(--line); }
.bk-body { flex: 1; min-width: 0; padding: 12px 16px 14px; display: grid; gap: 6px; align-content: start; }
.bk-body h3 { display: flex; align-items: center; gap: 8px; min-width: 0; font: 600 15px/1.5 var(--f-disp); color: var(--text); }
.bk-body h3 > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-body h3 .lc-tag { flex: none; }
.bk-sum { font-size: 12px; line-height: 1.6; color: var(--text-3); }
.bk-text { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin-top: 4px; font-size: 13px; line-height: 1.6; }
.bk-text dt { color: var(--text-3); white-space: nowrap; }
.bk-text dd { margin: 0; color: var(--text-2); overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; }
.bk-foot { display: flex; align-items: center; gap: 4px; padding: 10px 12px 10px 16px; border-top: 1px solid var(--line); }
.bk-foot .lc-btn { margin-left: 4px; }
.bk-used { font-size: 12px; color: var(--text-3); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-del:hover:not(:disabled) { color: var(--err-soft); background: rgb(var(--c-err) / .12); }
.bk-count { margin-top: 20px; text-align: center; font-size: 13px; color: var(--text-3); }

.skel-card { padding: 20px; gap: 12px; min-height: 180px; }
.skel { display: block; height: 12px; border-radius: 6px; background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }
.skel.w40 { width: 40%; height: 56px; border-radius: 10px; } .skel.w70 { width: 70%; } .skel.w50 { width: 50%; }

/* ---- 空态 ---- */
.bk-empty {
  margin-top: 16px; padding: 48px 24px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
  border-style: dashed; border-color: var(--line-3); background: rgb(var(--c-well) / .3);
}
.bk-ti {
  width: 48px; height: 48px; border-radius: 14px; flex: none; display: grid; place-items: center; color: var(--cyan);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .18), rgb(var(--c-violet) / .22));
  box-shadow: 0 0 0 1px rgb(var(--c-cyan) / .35) inset;
}
.bk-empty h2 { font: 600 16px/1.4 var(--f-disp); color: var(--text); margin-top: 8px; }
.bk-empty p { color: var(--text-2); font-size: 13px; max-width: 620px; line-height: 1.7; }
.bk-empty p.eg {
  text-align: left; padding: 12px 16px; border-radius: 10px; border: 1px solid var(--line); border-left: 2px solid var(--cyan);
  background: var(--well); color: var(--text);
}
.bk-empty p.dim { color: var(--text-3); font-size: 12px; }
.bk-empty .lc-btn { margin-top: 10px; }
.bk-empty small { color: var(--text-3); font-size: 12px; }

@media (max-width: 600px) {
  .bk-new { width: 100%; }
  .bk-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .bk-empty { padding: 32px 16px; }
}
</style>
