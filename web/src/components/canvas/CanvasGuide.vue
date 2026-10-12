<template>
  <!-- 空画布引导卡：加了节点或点过「知道了」后不再出现 -->
  <div v-if="showCard" class="cg-card">
    <div class="cg-card-ico"><LcIcon name="canvas" size="l" /></div>
    <div class="cg-card-title">{{ t('library.guide.cardTitle') }}</div>
    <div class="cg-card-sub">{{ t('library.guide.cardSub') }}</div>
    <div class="cg-card-actions">
      <button class="lc-btn primary quiet" @click="onFromTemplate">{{ t('library.guide.fromTemplate') }}</button>
      <button class="lc-btn" @click="openDrawer">{{ t('library.guide.openGuide') }}</button>
    </div>
    <button class="lc-btn ghost sm cg-card-dismiss" @click="dismissCard">{{ t('library.guide.dismiss') }}</button>
  </div>

  <!-- 教程抽屉：不遮画布，可边看边操作 -->
  <transition name="cg-slide">
    <aside v-if="open" class="cg-drawer" @keydown.esc="close">
      <div class="cg-head">
        <span class="cg-badge"><LcIcon name="book" /></span>
        <span class="cg-title">{{ t('library.guide.title') }}</span>
        <button class="lc-tb sm cg-close" :title="t('common.close')" :aria-label="t('common.close')" @click="close"><LcIcon name="x" size="s" /></button>
      </div>

      <nav class="cg-toc">
        <button v-for="s in sections" :key="s.id" type="button" :class="['cg-toc-a', { on: activeId === s.id }]" @click="scrollTo(s.id)">{{ s.title }}</button>
      </nav>

      <div ref="bodyEl" class="cg-body" @scroll="onScroll">
        <section v-for="(s, i) in sections" :key="s.id" :ref="el => setSecRef(s.id, el)" class="cg-sec">
          <h4><span class="cg-num">{{ i + 1 }}</span>{{ s.title }}</h4>
          <p v-if="s.intro" class="cg-intro">{{ s.intro }}</p>
          <ul class="cg-list">
            <li v-for="(it, j) in s.items" :key="j">{{ it }}</li>
          </ul>
          <div v-if="s.tip" class="lc-alert info cg-tip"><LcIcon name="info" size="s" /><span>{{ s.tip }}</span></div>
        </section>
        <div class="cg-end">
          <button class="lc-btn primary quiet block" @click="close">{{ t('library.guide.start') }}</button>
        </div>
      </div>
    </aside>
  </transition>
</template>

<script setup lang="ts">
import { lcLocal } from '@/utils/storage'
import { ref, computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'

const { t, tm, rt } = useI18n()

const props = defineProps<{ modelValue: boolean; empty?: boolean; /** 打开时先跳到哪一节；不传从头看 */ section?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'open-templates'): void }>()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const CARD_KEY = 'canvas_guide_card_dismissed'
const cardDismissed = ref(readFlag(CARD_KEY))
function readFlag(k: string) { try { return lcLocal.getItem(k) === '1' } catch { return false } }
function writeFlag(k: string) { try { lcLocal.setItem(k, '1') } catch { /* ignore */ } }

const showCard = computed(() => !!props.empty && !cardDismissed.value && !open.value)

function close() { open.value = false }
function openDrawer() { open.value = true }
function dismissCard() { cardDismissed.value = true; writeFlag(CARD_KEY) }
function onFromTemplate() { emit('open-templates') }

interface Sec { id: string; title: string; intro: string; items: string[]; tip: string }
// 章节顺序在这里定，文案全在 locales/modules/library.ts 的 guide.sections 下（两种语言同一棵键树）
const SECTION_IDS = [
  'start', 'models', 'ui', 'basic', 'nodes', 'source', 'gen', 'cost', 'run', 'tools',
  'link', 'brand', 'group', 'layout', 'lib', 'share', 'view', 'keys', 'faq',
]
const sections = computed<Sec[]>(() => SECTION_IDS.map((id) => {
  const raw = tm(`library.guide.sections.${id}`) as any
  const text = (m: any) => (m ? rt(m) : '')
  return {
    id,
    title: text(raw?.title),
    intro: text(raw?.intro),
    items: Array.isArray(raw?.items) ? raw.items.map(text) : [],
    tip: text(raw?.tip),
  }
}))

// ===== 目录跳转 & 高亮 =====
const activeId = ref(SECTION_IDS[0])
const bodyEl = ref<HTMLElement | null>(null)
const secRefs: Record<string, HTMLElement | null> = {}
function setSecRef(id: string, el: any) { secRefs[id] = (el as HTMLElement) || null }
function scrollTo(id: string) {
  activeId.value = id
  const el = secRefs[id]
  if (el && bodyEl.value) bodyEl.value.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' })
}
let scrollRaf = 0
function onScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const top = (bodyEl.value?.scrollTop || 0) + 16
    let cur = SECTION_IDS[0]
    for (const id of SECTION_IDS) {
      const el = secRefs[id]
      if (el && el.offsetTop <= top) cur = id
    }
    activeId.value = cur
  })
}
// 每次打开回到顶部；指定了章节（比如从「快捷键」入口进来）就直接到那一节
function jump() {
  nextTick(() => {
    const id = props.section && SECTION_IDS.includes(props.section) ? props.section : ''
    activeId.value = id || SECTION_IDS[0]
    if (!bodyEl.value) return
    bodyEl.value.scrollTop = id && secRefs[id] ? secRefs[id]!.offsetTop - 8 : 0
  })
}
watch(open, (v) => { if (v) jump() })
watch(() => props.section, () => { if (open.value) jump() })
</script>

<style scoped>
/* 引导卡：摆在编辑器正中（编辑器根是定位容器） */
.cg-card {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 8; width: 360px; max-width: calc(100% - 32px);
  background: linear-gradient(180deg, rgb(var(--c-glass-mid) / .96), rgb(var(--c-glass-lo) / .96));
  border: 1px solid var(--line-2); border-radius: var(--r-lg);
  box-shadow: var(--sh-2); padding: 24px; text-align: center;
}
.cg-card-ico {
  width: 48px; height: 48px; border-radius: 14px; margin: 0 auto 12px; display: grid; place-items: center;
  background: rgb(var(--c-cyan) / .12); color: var(--cyan); border: 1px solid rgb(var(--c-cyan) / .3);
}
.cg-card-title { font: 600 16px/1.4 var(--f-disp); color: var(--text); }
.cg-card-sub { font-size: 13px; color: var(--text-2); margin: 6px 0 16px; line-height: 1.6; }
.cg-card-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.cg-card-dismiss { margin-top: 12px; color: var(--text-3); }
@media (max-width: 520px) {
  .cg-card { padding: 20px 16px; }
  .cg-card-actions { flex-direction: column; }
}

/* 抽屉：贴着编辑器右边的一块玻璃，盖在生成队列圆钮上面 */
.cg-drawer {
  position: absolute; top: 16px; right: 16px; bottom: 16px; z-index: 30;
  width: 400px; max-width: calc(100% - 32px); display: flex; flex-direction: column;
  background: rgb(var(--c-glass) / .95); border: 1px solid var(--line-2); border-radius: 16px;
  box-shadow: var(--sh-2); overflow: hidden;
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.cg-head { display: flex; align-items: center; gap: 10px; padding: 14px 12px 12px 16px; border-bottom: 1px solid var(--line); }
.cg-badge {
  width: 32px; height: 32px; border-radius: 10px; flex: none; display: grid; place-items: center;
  background: rgb(var(--c-cyan) / .12); color: var(--cyan);
}
.cg-title { font: 600 15px/1.4 var(--f-disp); color: var(--text); }
.cg-close { margin-left: auto; }

.cg-toc { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 16px; border-bottom: 1px solid var(--line); max-height: 30%; overflow-y: auto; flex: none; }
.cg-toc-a {
  font-size: 12px; line-height: 1; color: var(--text-2); background: rgb(var(--c-film) / .08);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 9px; cursor: pointer;
}
.cg-toc-a:hover { border-color: var(--line-3); color: var(--text); }
.cg-toc-a.on { background: rgb(var(--c-blue) / .28); color: var(--text); border-color: var(--line-3); }

.cg-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 0; position: relative; }
.cg-sec { padding: 16px 0; border-bottom: 1px solid var(--line); scroll-margin-top: 8px; }
.cg-sec h4 { margin: 0 0 8px; font: 600 14px/1.4 var(--f-disp); color: var(--text); display: flex; align-items: center; gap: 8px; }
.cg-num {
  width: 20px; height: 20px; border-radius: 6px; flex: none; display: grid; place-items: center;
  background: rgb(var(--c-cyan) / .14); color: var(--cyan-soft); font: 600 11px/1 var(--f-mono);
}
.cg-intro { margin: 0 0 8px; font-size: 13px; color: var(--text-2); line-height: 1.7; }
.cg-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.cg-list li { font-size: 13px; color: var(--text-2); line-height: 1.65; padding-left: 14px; position: relative; }
.cg-list li::before { content: ''; position: absolute; left: 2px; top: 9px; width: 5px; height: 5px; border-radius: 50%; background: var(--cyan); }
.cg-tip { margin-top: 10px; font-size: 12px; }
.cg-end { padding: 16px 0 20px; }

.cg-slide-enter-active, .cg-slide-leave-active { transition: transform .22s ease, opacity .22s ease; }
.cg-slide-enter-from, .cg-slide-leave-to { transform: translateX(24px); opacity: 0; }

@media (max-width: 640px) {
  .cg-drawer { top: 8px; right: 8px; bottom: 8px; left: 8px; width: auto; max-width: none; }
}
</style>
