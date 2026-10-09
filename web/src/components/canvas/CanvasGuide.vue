<template>
  <!-- 空画布引导卡：加了节点或点过「知道了」后不再出现 -->
  <div v-if="showCard" class="cg-card">
    <div class="cg-card-ico">
      <svg viewBox="0 0 24 24" width="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/></svg>
    </div>
    <div class="cg-card-title">{{ t('library.guide.cardTitle') }}</div>
    <div class="cg-card-sub">{{ t('library.guide.cardSub') }}</div>
    <div class="cg-card-actions">
      <button class="cg-cbtn primary" @click="onFromTemplate">{{ t('library.guide.fromTemplate') }}</button>
      <button class="cg-cbtn" @click="openDrawer">{{ t('library.guide.openGuide') }}</button>
    </div>
    <button class="cg-card-dismiss" @click="dismissCard">{{ t('library.guide.dismiss') }}</button>
  </div>

  <!-- 教程抽屉：不遮画布，可边看边操作 -->
  <transition name="cg-slide">
    <aside v-if="open" class="cg-drawer" @keydown.esc="close">
      <div class="cg-head">
        <span class="cg-badge">
          <svg viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        </span>
        <span class="cg-title">{{ t('library.guide.title') }}</span>
        <button class="cg-close" :title="t('common.close')" @click="close">×</button>
      </div>

      <nav class="cg-toc">
        <a v-for="s in sections" :key="s.id" :class="['cg-toc-a', { on: activeId === s.id }]" @click="scrollTo(s.id)">{{ s.title }}</a>
      </nav>

      <div ref="bodyEl" class="cg-body" @scroll="onScroll">
        <section v-for="(s, i) in sections" :key="s.id" :ref="el => setSecRef(s.id, el)" class="cg-sec">
          <h4><span class="cg-num">{{ i + 1 }}</span>{{ s.title }}</h4>
          <p v-if="s.intro" class="cg-intro">{{ s.intro }}</p>
          <ul class="cg-list">
            <li v-for="(it, j) in s.items" :key="j">{{ it }}</li>
          </ul>
          <div v-if="s.tip" class="cg-tip"><span>💡</span><span>{{ s.tip }}</span></div>
        </section>
        <div class="cg-end">
          <button class="cg-start" @click="close">{{ t('library.guide.start') }}</button>
        </div>
      </div>
    </aside>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, tm, rt } = useI18n()

const props = defineProps<{ modelValue: boolean; empty?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'open-templates'): void }>()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const CARD_KEY = 'canvas_guide_card_dismissed'
const cardDismissed = ref(readFlag(CARD_KEY))
function readFlag(k: string) { try { return localStorage.getItem(k) === '1' } catch { return false } }
function writeFlag(k: string) { try { localStorage.setItem(k, '1') } catch { /* ignore */ } }

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
// 每次打开回到顶部
watch(open, (v) => { if (v) nextTick(() => { if (bodyEl.value) bodyEl.value.scrollTop = 0; activeId.value = SECTION_IDS[0] }) })
</script>

<style scoped>
/* 引导卡 */
.cg-card {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 30; width: 340px; max-width: calc(100vw - 32px);
  background: var(--n-2); border: 1px solid var(--n-5); border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0,0,0,.28); padding: 24px; text-align: center;
}
.cg-card-ico { width: 46px; height: 46px; border-radius: 13px; background: var(--accent-ghost, var(--film-2)); color: var(--accent-text); display: grid; place-items: center; margin: 0 auto 12px; }
.cg-card-title { font-size: 16px; font-weight: 800; color: var(--t-max); }
.cg-card-sub { font-size: 13px; color: var(--t-dim); margin: 6px 0 16px; }
.cg-card-actions { display: flex; gap: 8px; justify-content: center; }
.cg-cbtn { font-size: 13px; border-radius: 10px; padding: 9px 16px; cursor: pointer; border: 1px solid var(--line-2); background: var(--n-3); color: var(--t-body); }
.cg-cbtn:hover { border-color: var(--accent-text); color: var(--accent-text); }
.cg-cbtn.primary { background: var(--btn-bg, var(--accent-text)); color: var(--btn-fg, #111); border-color: transparent; font-weight: 600; }
.cg-card-dismiss { margin-top: 14px; border: 0; background: none; color: var(--t-dim); font-size: 12px; cursor: pointer; }
.cg-card-dismiss:hover { color: var(--t-body); }

/* 抽屉 */
.cg-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 40;
  width: 400px; max-width: 92vw; display: flex; flex-direction: column;
  background: var(--n-2); border-left: 1px solid var(--n-5);
  box-shadow: -12px 0 40px rgba(0,0,0,.22);
}
.cg-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px 12px; border-bottom: 1px solid var(--line-1, var(--n-5)); }
.cg-badge { width: 32px; height: 32px; border-radius: 9px; background: var(--accent-ghost, var(--film-2)); color: var(--accent-text); display: grid; place-items: center; flex: none; }
.cg-title { font-size: 16px; font-weight: 800; color: var(--t-max); }
.cg-close { margin-left: auto; border: 0; background: none; color: var(--t-dim); font-size: 24px; line-height: 1; cursor: pointer; }
.cg-close:hover { color: var(--t-max); }

.cg-toc { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 18px; border-bottom: 1px solid var(--line-1, var(--n-5)); }
.cg-toc-a { font-size: 11.5px; color: var(--t-body); background: var(--n-3); border: 1px solid var(--line-2); border-radius: 999px; padding: 4px 10px; cursor: pointer; }
.cg-toc-a:hover { border-color: var(--accent-text); color: var(--accent-text); }
.cg-toc-a.on { background: var(--accent-ghost, var(--film-2)); color: var(--accent-text); border-color: transparent; font-weight: 700; }

.cg-body { flex: 1; overflow-y: auto; padding: 6px 18px 0; }
.cg-sec { padding: 16px 0; border-bottom: 1px dashed var(--line-1, var(--n-5)); scroll-margin-top: 8px; }
.cg-sec h4 { margin: 0 0 8px; font-size: 14px; color: var(--t-max); display: flex; align-items: center; gap: 8px; }
.cg-num { width: 20px; height: 20px; border-radius: 6px; background: var(--accent-text); color: var(--n-black, #111); display: grid; place-items: center; font-size: 11px; font-weight: 800; flex: none; }
.cg-intro { margin: 0 0 8px; font-size: 12.5px; color: var(--t-body); line-height: 1.7; }
.cg-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
.cg-list li { font-size: 13px; color: var(--t-body); line-height: 1.6; padding-left: 14px; position: relative; }
.cg-list li::before { content: ""; position: absolute; left: 2px; top: 9px; width: 5px; height: 5px; border-radius: 50%; background: var(--accent-text); }
.cg-tip { margin-top: 10px; display: flex; gap: 8px; background: var(--accent-ghost, var(--film-2)); border-radius: 9px; padding: 9px 11px; font-size: 12px; color: var(--t-body); line-height: 1.6; }
.cg-end { padding: 18px 0 24px; }
.cg-start { width: 100%; border: 0; border-radius: 10px; padding: 11px; font-size: 14px; font-weight: 600; cursor: pointer; background: var(--btn-bg, var(--accent-text)); color: var(--btn-fg, #111); }

.cg-slide-enter-active, .cg-slide-leave-active { transition: transform .22s ease; }
.cg-slide-enter-from, .cg-slide-leave-to { transform: translateX(100%); }

@media (max-width: 480px) {
  .cg-drawer { width: 100%; max-width: 100%; }
}
</style>
