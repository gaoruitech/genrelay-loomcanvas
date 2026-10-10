<template>
  <div ref="pageEl" class="lc-page" @scroll.passive="onScroll">
    <div class="lc-page-inner">
      <div class="lc-page-head">
        <div class="lc-sp">
          <h1 class="lc-ph1">{{ t('settings.title') }}</h1>
          <p class="lc-ph-sub">{{ app.isOwner ? t('settings.subOwner') : t('settings.sub') }}</p>
        </div>
      </div>

      <div class="set">
        <nav ref="navEl" class="set-nav" :aria-label="t('settings.navLabel')">
          <a
            v-for="s in sections"
            :key="s.id"
            :href="'#' + s.id"
            :class="{ on: active === s.id }"
            :aria-current="active === s.id ? 'true' : undefined"
            :data-nav="s.id"
            @click.prevent="go(s.id)"
          ><LcIcon :name="s.icon" />{{ t('settings.nav.' + s.id) }}</a>
        </nav>

        <div ref="colEl" class="set-col">
          <template v-if="app.isOwner">
            <StorageSection />
            <LimitsSection />
          </template>
          <AppearanceSection />
          <AccountSection />
          <template v-if="app.isOwner">
            <SiteSection />
            <UsersSection />
          </template>
          <p v-if="app.bootstrap?.version" class="version">LoomCanvas {{ app.bootstrap.version }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置：一页到底。左边是分区的锚点目录（滚动时高亮跟随，点一下滚到那个分区），右边各分区的卡片依次排开。
 * 存储 / 运行限制 / 站点 / 用户管理只有所有者有；其他人只看到外观和账号与安全，对应的接口也不会去调。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import LcIcon from '@/components/LcIcon.vue'
import StorageSection from '@/components/settings/StorageSection.vue'
import LimitsSection from '@/components/settings/LimitsSection.vue'
import AppearanceSection from '@/components/settings/AppearanceSection.vue'
import AccountSection from '@/components/settings/AccountSection.vue'
import SiteSection from '@/components/settings/SiteSection.vue'
import UsersSection from '@/components/settings/UsersSection.vue'

const { t } = useI18n()
const route = useRoute()
const app = useAppStore()

const ALL = [
  { id: 'storage', icon: 'disk', owner: true },
  { id: 'limits', icon: 'bolt', owner: true },
  { id: 'appearance', icon: 'eye', owner: false },
  { id: 'account', icon: 'shield', owner: false },
  { id: 'site', icon: 'site', owner: true },
  { id: 'users', icon: 'users', owner: true },
] as const
const sections = computed(() => ALL.filter(s => !s.owner || app.isOwner))

const pageEl = ref<HTMLElement | null>(null)
const navEl = ref<HTMLElement | null>(null)
const colEl = ref<HTMLElement | null>(null)
const active = ref<string>('')

const sectionEl = (id: string) => colEl.value?.querySelector<HTMLElement>('#' + id) || null

/** 窄屏上目录是贴在顶上的一排，滚到分区时要把它的高度让出来 */
function topGap(): number {
  const nav = navEl.value
  return nav && getComputedStyle(nav).position === 'sticky' && nav.offsetHeight < 80 ? nav.offsetHeight + 12 : 24
}

/** 分区顶边相对滚动容器内容的位置 */
function offsetOf(el: HTMLElement): number {
  const page = pageEl.value!
  return el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop
}

// ---- 滚动时高亮跟随 ----
function spy() {
  const page = pageEl.value
  if (!page) return
  const list = sections.value
  let cur: string = list[0]?.id || ''
  // 到底了：最后几个分区可能矮到永远够不着顶，直接算最后一个
  if (page.scrollTop > 0 && page.scrollTop + page.clientHeight >= page.scrollHeight - 2) {
    cur = list[list.length - 1]?.id || cur
  } else {
    const line = page.scrollTop + topGap() + 40
    for (const s of list) {
      const el = sectionEl(s.id)
      if (el && offsetOf(el) <= line) cur = s.id
    }
  }
  if (cur !== active.value) {
    active.value = cur
    void nextTick(revealNav)
  }
}

/** 窄屏的横向目录：当前项滚到看得见的地方 */
function revealNav() {
  const nav = navEl.value
  const item = nav?.querySelector<HTMLElement>('a.on')
  if (!nav || !item || nav.scrollWidth <= nav.clientWidth) return
  const left = item.offsetLeft - 16
  const right = item.offsetLeft + item.offsetWidth + 16
  if (left < nav.scrollLeft) nav.scrollTo({ left: Math.max(0, left) })
  else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: right - nav.clientWidth })
}

// ---- 滚到某个分区 ----
/** 正在往哪个分区去。上面的分区还在加载、高度会变，到位之前跟着重新对齐；用户自己一滚就放手 */
let target = ''
let targetTimer = 0
let raf = 0

function align(smooth: boolean) {
  const page = pageEl.value
  const el = target ? sectionEl(target) : null
  if (!page || !el) return
  const top = Math.max(0, offsetOf(el) - topGap())
  page.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
}

function release() {
  target = ''
  window.clearTimeout(targetTimer)
}

function go(id: string, smooth = true) {
  if (!sectionEl(id)) return
  target = id
  active.value = id
  void nextTick(revealNav)
  align(smooth)
  window.clearTimeout(targetTimer)
  targetTimer = window.setTimeout(release, 2500)
}

function onScroll() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    // 正在去某个分区的路上：高亮已经定好了，别在途中来回跳
    if (!target) spy()
  })
}

let ro: ResizeObserver | null = null
const USER_SCROLL = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const

function fromHash(smooth: boolean) {
  const id = route.hash.replace(/^#/, '')
  if (id && sections.value.some(s => s.id === id)) go(id, smooth)
  else spy()
}

onMounted(() => {
  const page = pageEl.value
  if (page) for (const ev of USER_SCROLL) page.addEventListener(ev, release, { passive: true })
  if (colEl.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (target) align(false); else spy() })
    ro.observe(colEl.value)
  }
  void nextTick(() => fromHash(false))
})
onBeforeUnmount(() => {
  const page = pageEl.value
  if (page) for (const ev of USER_SCROLL) page.removeEventListener(ev, release)
  ro?.disconnect()
  release()
  if (raf) cancelAnimationFrame(raf)
})
// 已经在设置页时从用户菜单点「账号与安全」
watch(() => route.hash, () => fromHash(true))
</script>

<style scoped>
.lc-page-inner { max-width: 1280px; }
.set { display: grid; grid-template-columns: 184px minmax(0, 1fr); gap: 32px; margin-top: 24px; align-items: start; }
.set-nav { display: grid; gap: 2px; position: sticky; top: 24px; }
.set-nav a {
  height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-radius: 10px;
  color: var(--text-2); text-decoration: none; font-size: 14px; border-left: 2px solid transparent; white-space: nowrap;
  transition: background .15s, color .15s;
}
.set-nav a:hover { color: var(--text); background: rgba(124, 160, 255, .08); }
.set-nav a.on { color: var(--text); background: rgba(59, 123, 255, .14); border-left-color: var(--cyan); }
.set-nav a.on :deep(.lc-ic) { color: var(--cyan); }
.set-col { min-width: 0; }
.version { margin-top: 24px; font: 12px var(--f-mono); color: var(--text-3); }

@media (max-width: 900px) {
  .set { grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 16px; }
  /* 目录变成贴在顶上的一排，自己横向滚动，页面不跟着变宽 */
  .set-nav {
    display: flex; gap: 8px; top: 0; z-index: 5; margin: 0 -20px; padding: 10px 20px;
    overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
    background: var(--bg-0); border-bottom: 1px solid var(--line);
  }
  .set-nav::-webkit-scrollbar { display: none; }
  .set-nav a {
    flex: none; height: 32px; padding: 0 12px; gap: 6px; border-radius: 16px; font-size: 13px;
    border: 1px solid var(--line-2);
  }
  .set-nav a.on { border-color: var(--cyan); background: rgba(63, 216, 255, .1); color: var(--text); }
  .set-nav a :deep(.lc-ic) { width: 14px; height: 14px; }
}
@media (max-width: 600px) {
  .set-nav { margin: 0 -16px; padding: 10px 16px; }
}
</style>
