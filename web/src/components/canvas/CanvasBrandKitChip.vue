<template>
  <div ref="root" class="bkc">
    <button
      ref="btn" type="button" class="bkc-chip" :class="{ on: open, set: !!current }"
      v-tip="open ? '' : current ? t('brandKit.chip.tip', { name: current.name }) : t('brandKit.chip.tipNone')"
      :aria-label="t('brandKit.chip.label')" aria-haspopup="dialog" :aria-expanded="open"
      data-testid="kit-chip" @click.stop="toggle"
    >
      <BrandKitThumbs :images="current?.refImages" />
      <span class="bkc-name">{{ current ? current.name : t('brandKit.chip.none') }}</span>
      <svg class="bkc-chev" :class="{ up: open }" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Teleport :to="$lcPortal">
      <div v-if="open" ref="pop" v-dialog="{ onEscape: close, modal: false }" class="lc-menu bkc-pop" role="dialog" :aria-label="t('brandKit.pop.title')" :style="menuStyle" data-testid="kit-pop" @mousedown.stop @wheel.stop>
        <div class="bkc-h">{{ t('brandKit.pop.title') }}</div>
        <p class="bkc-what">{{ t('brandKit.explain.summary') }}</p>
        <!-- 集成方关了成本显示（features.cost）：同一段话，不提「预估成本」（和品牌包页用的是同一句） -->
        <p v-if="more" class="bkc-what dim">{{ $feat.cost ? t('brandKit.explain.limits') : t('brandKit.explain.limitsNoCost') }}</p>
        <button type="button" class="bkc-more" :aria-expanded="more" @click="toggleMore">{{ more ? t('brandKit.node.hide') : t('brandKit.pop.limits') }}</button>

        <div class="bkc-sub">{{ t('brandKit.pop.pick') }}</div>
        <div class="bkc-list" role="radiogroup" :aria-label="t('brandKit.pop.title')">
          <button type="button" class="bkc-row" :class="{ on: !current }" role="radio" :aria-checked="!current" data-kit="" @click="pick('')">
            <span class="bkc-rd" />
            <span class="bkc-main">
              <b>{{ t('brandKit.pop.none') }}</b>
              <small>{{ t('brandKit.pop.noneDesc') }}</small>
            </span>
          </button>
          <div v-for="k in kits" :key="k.id" class="bkc-row" :class="{ on: current?.id === k.id }">
            <button type="button" class="bkc-pick" role="radio" :aria-checked="current?.id === k.id" :data-kit="k.id" @click="pick(k.id)">
              <span class="bkc-rd" />
              <BrandKitThumbs :images="k.refImages" size="m" :max="2" />
              <span class="bkc-main">
                <b><span class="bkc-n">{{ k.name }}</span><span v-if="k.isDefault" class="lc-tag bkc-tag" v-tip="t('brandKit.isDefault')">{{ t('brandKit.defaultTag') }}</span></b>
                <small>{{ brandKitSummary(k) }}</small>
              </span>
            </button>
            <button v-if="canManage && k.canManage !== false" type="button" class="lc-tb sm bkc-edit" v-tip="t('brandKit.pop.edit', { name: k.name })" :aria-label="t('brandKit.pop.edit', { name: k.name })" @click="onEdit(k)"><LcIcon name="edit" size="s" /></button>
          </div>
          <p v-if="!kits.length" class="bkc-empty">{{ t('brandKit.pop.empty') }} {{ t('brandKit.page.example') }}</p>
        </div>

        <p v-if="missing" class="bkc-note warn">{{ t('brandKit.pop.missing') }}</p>
        <p v-if="exceptions" class="bkc-note">{{ t('brandKit.pop.exceptions', { n: exceptions }, exceptions) }}</p>

        <div class="bkc-foot">
          <router-link class="lc-btn sm ghost" :to="{ name: 'brand-kits' }" data-testid="kit-manage"><LcIcon name="settings" size="s" />{{ t('brandKit.pop.manage') }}</router-link>
          <span class="lc-sp" />
          <button v-if="canManage" type="button" class="lc-btn sm" data-testid="kit-new" @click="onCreate"><LcIcon name="plus" size="s" />{{ t('brandKit.pop.create') }}</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * 画布顶栏上的品牌包：一颗显示「这张画布现在套用哪个」的 chip，点开是选择面板。
 * 品牌包按画布选，这里是唯一的入口；面板里先用一段话说清它是什么、运行时会做什么。
 */
import { vDialog } from '@/directives/dialog'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import BrandKitThumbs from '@/components/brandkit/BrandKitThumbs.vue'
import { useFloatingMenu } from '@/composables/useFloatingMenu'
import { brandKitSummary, type BrandKit } from '@/composables/useBrandKits'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  kits: BrandKit[]
  /** 这张画布选的品牌包 id；空串 = 没选 */
  modelValue: string
  /** 有几个节点单独设置了品牌包 */
  exceptions?: number
  /** 列表已经拉到了：之前不能把「查不到」当成「被删了」 */
  loaded?: boolean
  /** 能不能新建、修改品牌包（团队里的成员只能选用） */
  canManage?: boolean
}>(), { canManage: true })
const emit = defineEmits<{
  (e: 'update:modelValue', id: string): void
  (e: 'edit', kit: BrandKit): void
  (e: 'create'): void
}>()

const root = ref<HTMLElement | null>(null)
const btn = ref<HTMLElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const { open, menuStyle, toggle, close, updatePosition } = useFloatingMenu({ trigger: btn, menu: pop, root, gap: 12, fitHeight: true })

const current = computed(() => props.kits.find((k) => k.id === props.modelValue) || null)
/** 存着一个 id 但列表里没有：那个品牌包被删了 */
const missing = computed(() => !!props.loaded && !!props.modelValue && !current.value)

const more = ref(false)
function toggleMore() {
  more.value = !more.value
  void nextTick(updatePosition)
}

function pick(id: string) {
  if (id !== props.modelValue) emit('update:modelValue', id)
  close()
}
function onEdit(k: BrandKit) { close(); emit('edit', k) }
function onCreate() { close(); emit('create') }

defineExpose({ close })
</script>

<style scoped>
.bkc { display: flex; align-items: center; min-width: 0; flex: 0 1 auto; }
/* 跟保存状态之间的一道分隔 */
.bkc::before { content: ''; width: 1px; height: 18px; background: var(--line-2); margin: 0 10px 0 4px; flex: none; }
.bkc-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; min-width: 0; max-width: 220px; padding: 0 8px 0 5px;
  border: 1px solid transparent; border-radius: 8px; background: none; color: var(--text-3);
  font: inherit; font-size: 12px; cursor: pointer; transition: background .13s, border-color .13s, color .13s;
}
.bkc-chip.set { color: var(--text); }
.bkc-chip:hover { background: rgb(var(--c-film) / .1); color: var(--text); }
.bkc-chip.on { border-color: var(--cyan); background: var(--well); color: var(--text); }
.bkc-chip:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.bkc-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bkc-chev { width: 10px; height: 10px; flex: none; color: var(--text-3); transition: transform .15s; }
.bkc-chev.up { transform: rotate(180deg); }

@media (max-width: 640px) {
  .bkc::before { margin: 0 4px 0 2px; }
  .bkc-chip { padding: 0 4px; gap: 3px; }
  .bkc-name { display: none; }
}
</style>

<style>
/* 面板 Teleport 到了 body，scoped 管不到 */
.bkc-pop { width: 380px; max-width: calc(calc(100 * var(--lc-vw)) - 16px); padding: 16px; }
.bkc-pop .bkc-h { font: 600 14px/1.4 var(--f-disp); color: var(--text); }
.bkc-pop .bkc-what { margin: 8px 0 0; font-size: 12px; line-height: 1.7; color: var(--text-2); }
.bkc-pop .bkc-what.dim { color: var(--text-3); }
.bkc-pop .bkc-more {
  margin-top: 4px; padding: 0; border: 0; background: none; color: var(--cyan-soft); font: inherit; font-size: 12px; cursor: pointer;
}
.bkc-pop .bkc-more:hover { text-decoration: underline; text-underline-offset: 3px; }
.bkc-pop .bkc-sub { margin: 14px 0 8px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 12px; color: var(--text-3); }
.bkc-pop .bkc-list { display: grid; gap: 6px; max-height: 264px; overflow-y: auto; margin: 0 -4px; padding: 0 4px; }
.bkc-pop .bkc-row {
  display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; padding: 0 6px 0 0; text-align: left;
  border: 1px solid var(--line); border-radius: 10px; background: rgb(var(--c-well) / .3); color: var(--text); font: inherit;
  transition: border-color .13s, background .13s;
}
.bkc-pop button.bkc-row { padding: 8px 10px; gap: 10px; cursor: pointer; }
.bkc-pop .bkc-row:hover { border-color: var(--line-3); }
.bkc-pop .bkc-row.on { border-color: var(--cyan); background: rgb(var(--c-cyan) / .07); }
.bkc-pop .bkc-pick {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 4px 8px 10px;
  border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 10px;
}
.bkc-pop .bkc-pick:focus-visible, .bkc-pop button.bkc-row:focus-visible { outline: none; box-shadow: var(--ring); }
.bkc-pop .bkc-rd {
  width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid var(--line-3); flex: none; display: grid; place-items: center;
}
.bkc-pop .bkc-row.on .bkc-rd { border-color: var(--cyan); }
.bkc-pop .bkc-row.on .bkc-rd::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); }
.bkc-pop .bkc-main { min-width: 0; flex: 1; display: grid; gap: 1px; }
.bkc-pop .bkc-main b { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5; }
.bkc-pop .bkc-n { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.bkc-pop .bkc-main small { font-size: 12px; line-height: 1.5; color: var(--text-3); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.bkc-pop .bkc-tag { height: 18px; font-size: 11px; flex: none; }
.bkc-pop .bkc-edit { flex: none; color: var(--text-3); }
.bkc-pop .bkc-empty { margin: 4px 0 0; font-size: 12px; line-height: 1.7; color: var(--text-3); }
.bkc-pop .bkc-note { margin: 10px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-3); }
.bkc-pop .bkc-note.warn { color: var(--warn); }
.bkc-pop .bkc-foot { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
</style>
