<template>
  <div
    class="lc-card cc"
    :class="{ team }"
    role="link"
    tabindex="0"
    :aria-label="canvas.name"
    @click="emit('open')"
    @keydown.enter.self="emit('open')"
  >
    <div class="lc-thumb cc-thumb">
      <img
        v-if="canvas.thumbnailType === 'image' && hasCover"
        loading="lazy"
        :src="canvasImageThumb(ensureHttps(canvas.thumbnail!))"
        alt=""
        @error="broken = true"
      />
      <template v-else-if="canvas.thumbnailType === 'video' && hasCover">
        <video :src="ensureHttps(canvas.thumbnail!)" preload="metadata" muted @error="broken = true" />
        <span class="play"><LcIcon name="play" /></span>
      </template>
      <span v-else class="cc-ph"><LcIcon name="canvas" size="xl" /></span>
      <VisibilityChip v-if="team && canvas.visibility" class="cc-vis" :value="canvas.visibility" />
      <span v-if="canvas.thumbnailType === 'image' || canvas.thumbnailType === 'video'" class="lc-bd tag" :class="canvas.thumbnailType">{{ t(`workbench.kind.${canvas.thumbnailType}`) }}</span>
      <!-- 有人正在编辑：压在封面底边上的一条 -->
      <div v-if="team && locked" class="cc-lock">
        <i aria-hidden="true" /><span>{{ canvas.lock!.mine || canvas.lock!.sameUser ? t('views.team.editingYou') : t('views.team.editing', { name: personName(canvas.lock!.by) }) }}</span>
      </div>
    </div>
    <div class="cc-meta">
      <h3 v-tip="{ text: canvas.name, clipped: true }">{{ canvas.name }}</h3>
      <div v-if="team" class="cc-foot">
        <div class="cc-by">
          <PersonName class="cc-who" :person="canvas.createdBy" :avatar="20" />
          <span class="cc-dot" aria-hidden="true">·</span>
          <small class="cc-time">{{ recent(canvas.lastEditedAt || canvas.updatedAt || canvas.createdAt, now) }}</small>
        </div>
        <!-- 「更多」是全站共用的那个菜单；点它、在它上面按键都不算点开画布 -->
        <span v-if="menuItems?.length" class="cc-more" @click.stop @keydown.stop>
          <ActionMenu :items="menuItems" :label="t('views.team.menuTip', { name: canvas.name })" @pick="emit('action', $event)" />
        </span>
      </div>
      <small v-else class="cc-created">{{ formatTime(canvas.createdAt) }}</small>
    </div>
    <slot name="ops" />
  </div>
</template>

<script setup lang="ts">
/**
 * 一张画布卡片：封面、名字、时间。画布列表和工作台首页共用。
 * 团队空间里（team）多三样：左上角的可见范围、底部的创建人、有人正在编辑时封面上的一条；
 * 操作收在右下角的「…」里：有哪几项由外面给（menuItems，见 CanvasActions.itemsOf），选了哪一项发 action。
 * 个人空间的样子不变，操作条走 ops 插槽。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WorkflowSummary } from '@/utils/api'
import { ensureHttps } from '@/utils/mediaUrl'
import { canvasImageThumb } from '@/utils/canvasMedia'
import LcIcon from '@/components/LcIcon.vue'
import PersonName from '@/components/PersonName.vue'
import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu.vue'
import VisibilityChip from '@/components/space/VisibilityChip.vue'
import { useCanvasCreate } from '@/components/workbench/useCanvasCreate'
import { lockActive, personName, useCanvasTime } from './canvasMeta'

const props = withDefaults(defineProps<{
  canvas: WorkflowSummary
  /** 团队空间里的样子 */
  team?: boolean
  /** 右下角「…」里的操作；不给（或者是空的）就没有这个按钮 */
  menuItems?: ActionMenuItem[]
  /** 「现在」：相对时间和锁有没有过期都按它算，外面定时往前拨 */
  now?: number
}>(), { team: false, menuItems: undefined, now: () => Date.now() })

const emit = defineEmits<{ (e: 'open'): void; (e: 'action', key: string): void }>()

const { t } = useI18n()
const { formatTime } = useCanvasCreate()
const { recent } = useCanvasTime()

/** 封面取不到（资源被清理过）时退回占位图，不让浏览器画破图标 */
const broken = ref(false)
watch(() => props.canvas.thumbnail, () => { broken.value = false })
const hasCover = computed(() => !!props.canvas.thumbnail && !broken.value)

const locked = computed(() => lockActive(props.canvas.lock, props.now))
</script>

<style scoped>
.cc { position: relative; overflow: hidden; min-width: 0; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.cc:hover { border-color: var(--line-3); }
.cc:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
.cc-thumb { aspect-ratio: 16 / 10; }
/* 封面可能是浅色的图：徽标垫一层深底才读得出来 */
.cc-thumb .tag { box-shadow: 0 0 0 99px var(--tag-scrim) inset; }
.cc.team .cc-thumb .tag { left: auto; right: 8px; }
.cc-vis { position: absolute; left: 8px; top: 8px; max-width: calc(100% - 16px); }
.cc-ph {
  position: absolute; inset: 0; display: grid; place-items: center; color: rgb(var(--c-film-2) / .38);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .07), rgb(var(--c-violet) / .1));
}
.cc-lock {
  position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px;
  font-size: 12px; color: var(--on-scrim); background: rgb(var(--c-scrim) / .78);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
/* 这颗点压在深色遮罩上，不跟主题走：浅色主题的 --ok 是深绿，在这里看不见。光晕跟着点自己的颜色（--dot-glow 用的是 currentColor） */
.cc-lock i { flex: none; width: 7px; height: 7px; border-radius: 50%; color: var(--on-scrim-ok); background: currentColor; box-shadow: var(--dot-glow); }
.cc-lock span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 名字是主角、时间是配角 */
.cc-meta { padding: 12px 14px 14px; }
.cc-meta h3 { font: 600 14px/1.5 var(--f-body); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-created { display: block; margin-top: 2px; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.cc.team .cc-meta { padding-bottom: 10px; }
.cc-foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; min-height: 28px; }
.cc-by { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); }
.cc-who { min-width: 0; gap: 8px; }
.cc-who :deep(.pn-tag) { height: 18px; padding: 0 6px; font-size: 11px; }
.cc-dot { flex: none; color: var(--text-3); }
/* 创建人带着「已离开团队 / 账号已删除」标签时一行放不下（英文尤其）：时间换到下一行，名字至少留得住几个字 */
.cc-by:has(.pn.gone) { flex-wrap: wrap; row-gap: 2px; }
.cc-by:has(.pn.gone) .cc-who { max-width: 100%; flex-wrap: wrap; row-gap: 2px; }
.cc-by:has(.pn.gone) .cc-who :deep(.pn-name) { min-width: 3em; }
.cc-by:has(.pn.gone) .cc-dot { display: none; }
.cc-by:has(.pn.gone) .cc-time { flex-basis: 100%; }
.cc-time { flex: none; color: var(--text-3); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cc-more { flex: none; display: inline-flex; margin-right: -6px; }
.cc-more :deep(.am-btn) { color: var(--text-3); }
.cc-more :deep(.am-btn:hover), .cc-more :deep(.am-btn.on) { color: var(--text); }

@media (max-width: 600px) {
  .cc-meta { padding: 10px 12px 12px; }
  /* 两列的小卡片放不下一整行：时间换到名字下面 */
  .cc-by { flex-wrap: wrap; row-gap: 2px; }
  .cc-who { max-width: calc(100% - 28px); }
  .cc-dot { display: none; }
  .cc-time { flex-basis: 100%; }
  .cc-foot { align-items: flex-start; }
  .cc-lock { height: 26px; padding: 0 8px; }
  /* 小卡片的封面顶上放不下两个标签（英文的可见范围更长）：留可见范围，类型让位 */
  .cc.team .cc-thumb .tag { display: none; }
  .cc-vis { overflow: hidden; }
}
</style>
