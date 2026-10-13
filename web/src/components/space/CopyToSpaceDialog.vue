<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @click.self="close">
      <div v-dialog="{ onEscape: close, busy }" class="lc-dialog cts" role="dialog" aria-modal="true" :aria-label="title" data-testid="copy-to-dialog">
        <div class="lc-dialog-head">
          <span class="cts-h">{{ title }}</span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" :disabled="busy" @click="close">×</button>
        </div>

        <!-- 复制完了：说清楚放到哪儿了，可以过去看 -->
        <template v-if="done">
          <div class="lc-dialog-body cts-done">
            <span class="cts-ok"><LcIcon name="check" size="l" /></span>
            <p>{{ t(`spaces.copy.done.${kind}`, { space: spaceLabel(done.spaceId), n: done.files }) }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" @click="close">{{ t('common.close') }}</button>
            <button v-if="space.canSwitch && pages.has(kind === 'canvas' ? 'canvas' : 'assets')" ref="openBtn" class="lc-btn primary" type="button" @click="openCopy">{{ t(`spaces.copy.open.${kind}`) }}</button>
          </div>
        </template>

        <template v-else>
          <div class="lc-dialog-body">
            <p class="cts-what">{{ t(`spaces.copy.what.${kind}`, { name }) }}</p>
            <div v-if="loading" class="cts-list" aria-busy="true"><i class="cts-sk" /><i class="cts-sk" /></div>
            <p v-else-if="!rows.length" class="lc-empty">{{ t('spaces.copy.noTarget') }}</p>
            <template v-else>
              <!-- 去不了的也列出来，灰着，下面写为什么：不让人猜「怎么少了一个」 -->
              <div ref="listEl" class="cts-list" role="radiogroup" :aria-label="t('spaces.copy.target')" @keydown="onListKey">
                <button
                  v-for="s in rows"
                  :key="s.id"
                  type="button"
                  class="cts-item"
                  :class="{ on: target === s.id, off: !s.available }"
                  role="radio"
                  :aria-checked="target === s.id"
                  :aria-disabled="!s.available || undefined"
                  :aria-describedby="s.available ? undefined : uid + '-' + s.id"
                  :disabled="busy"
                  :tabindex="s.available && (target ? target === s.id : s.id === firstAvailable) ? 0 : -1"
                  :data-target="s.id"
                  :data-reason="s.reason || undefined"
                  @click="pick(s)"
                >
                  <SpaceAvatar :name="s.kind === 'team' ? s.name : app.user?.username" :src="s.avatar" :seed="s.kind === 'team' ? s.id : app.user?.id" :size="32" />
                  <span class="cts-it">
                    <b>{{ nameOf(s) }}</b>
                    <small v-if="s.available">{{ s.kind === 'team' ? t('spaces.copy.teamSub', { role: t('spaces.role.' + s.role) }) : t('spaces.copy.personalSub') }}</small>
                    <small v-else :id="uid + '-' + s.id" class="cts-why"><LcIcon :name="s.current ? 'check' : 'lock'" size="s" />{{ reasonOf(s) }}</small>
                  </span>
                  <i v-if="s.available" class="cts-radio" aria-hidden="true" />
                </button>
              </div>
              <p v-if="!anyAvailable" class="lc-alert warn cts-none" role="status" data-testid="copy-none"><LcIcon name="warn" /><span>{{ t('spaces.copy.noneAvailable') }}</span></p>
              <ul v-else class="cts-notes">
                <li>{{ t('spaces.copy.noteFiles') }}</li>
                <li v-if="kind === 'canvas'">{{ t('spaces.copy.noteCanvas') }}</li>
                <li v-if="targetIsTeam">{{ t(`spaces.copy.noteTeam.${kind}`) }}</li>
              </ul>
            </template>
            <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
            <button class="lc-btn primary" type="button" :disabled="busy || !target" data-act="copy-submit" @click="copy">{{ busy ? t('spaces.copy.copying') : t('spaces.copy.submit') }}</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
let seq = 0
</script>

<script setup lang="ts">
/**
 * 「复制到…」：把一张画布或一条资产复制到自己所在的另一个空间（个人空间 ↔ 团队，或另一个团队）。
 * 文件会在目标空间名下另存一份，所以源空间以后被删也不影响副本。
 *
 * 能去哪儿问服务端（GET /api/spaces/copy-targets，和复制接口是同一套判断）：自己所在的每个空间都在里面，
 * 去不了的也列出来、灰着、写明原因——团长关了「允许复制到个人空间」、目标团队被停用 / 已解散、
 * 那一类素材已经放满、以及「就是现在这个空间」。取不到（老服务端）时按空间列表自己算，只列能去的。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useSpaceStore, spaceParam } from '@/stores/space'
import { workflowApi, userAssetApi, teamApi, unwrap, apiErrorMessage } from '@/utils/api'
import { vDialog } from '@/directives/dialog'
import { usePageOpen } from '@/embed/links'
import LcIcon from '@/components/LcIcon.vue'
import SpaceAvatar from './SpaceAvatar.vue'
import type { CopyTarget } from '@/types'

const props = defineProps<{
  kind: 'canvas' | 'asset'
  id: string
  name: string
  /** 素材的种类（product / brand / reference / output）：目标空间那一类放满了也算去不了 */
  assetKind?: string
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'copied', out: { spaceId: string; id: string }): void }>()

const { t, te } = useI18n()
const router = useRouter()
const app = useAppStore()
const space = useSpaceStore()
const pages = usePageOpen()
const uid = `lc-cts-${++seq}`

const title = computed(() => t(`spaces.copy.title.${props.kind}`))

/* ===== 去处 ===== */
const targets = ref<CopyTarget[]>([])
const loading = ref(true)
const listEl = ref<HTMLElement | null>(null)

/** 服务端不认识这个接口时：自己所在的别的空间，而且是开着的（和以前一样，只有能去的） */
function localTargets(): CopyTarget[] {
  const blocked = space.isTeam && !space.isTeamOwner && space.settings?.copyToPersonal === false
  return space.spaces
    .filter((s) => (s.kind !== 'team' ? !!space.currentId && !blocked : s.id !== space.currentId && (s.status || 'active') === 'active'))
    .map((s) => ({
      id: s.kind === 'team' ? s.id : 'personal', kind: s.kind === 'team' ? 'team' as const : 'personal' as const, name: s.kind === 'team' ? s.name : '',
      avatar: s.avatar || '', role: s.role, status: 'active' as const, current: false, available: true, reason: '' as const, message: '',
    }))
}
async function loadTargets(focus = true) {
  loading.value = true
  try {
    targets.value = unwrap(await teamApi.copyTargets(props.kind, props.kind === 'asset' ? props.assetKind : undefined)).targets || []
  } catch {
    targets.value = localTargets()
  } finally {
    loading.value = false
  }
  const open = rows.value.filter((s) => s.available)
  // 只有一个去处：直接选上
  if (open.length === 1) target.value = open[0].id
  else if (!open.some((s) => s.id === target.value)) target.value = ''
  // 列表出来之后焦点放到第一个能选的上（没有就留在弹窗上）
  await nextTick()
  if (focus) listEl.value?.querySelector<HTMLElement>('.cts-item[tabindex="0"]')?.focus({ preventScroll: true })
}
onMounted(() => loadTargets())

/** 能去的在前，去不了的在后，当前空间垫底；各自保持服务端给的顺序（个人空间、然后按加入的先后） */
const rows = computed(() => {
  const rank = (s: CopyTarget) => (s.available ? 0 : s.current ? 2 : 1)
  return targets.value.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s)
})
const anyAvailable = computed(() => rows.value.some((s) => s.available))
const firstAvailable = computed(() => rows.value.find((s) => s.available)?.id || '')
const target = ref('')
const targetIsTeam = computed(() => !!target.value && target.value !== 'personal')

const nameOf = (s: { kind: string; name: string }) => (s.kind === 'team' ? s.name || t('spaces.team') : t('spaces.personal'))
const spaceLabel = (id: string) => {
  if (id === 'personal' || !id) return t('spaces.personal')
  return targets.value.find((s) => s.id === id)?.name || space.spaces.find((s) => s.id === id)?.name || t('spaces.team')
}
/** 去不了的原因：认识的原因码用自己的话（两种语言都有），不认识的用服务端按当前语言写好的那句 */
function reasonOf(s: CopyTarget): string {
  const key = 'spaces.copy.reason.' + s.reason
  return s.reason && te(key) ? t(key) : s.message || t('spaces.copy.reason.unknown')
}

function pick(s: CopyTarget) {
  if (s.available && !busy.value) target.value = s.id
}
/** 单选组的键盘：上下左右在能选的之间走，走到哪个选哪个 */
function onListKey(e: KeyboardEvent) {
  const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
  if (!step || busy.value) return
  const open = rows.value.filter((s) => s.available)
  if (!open.length) return
  e.preventDefault()
  const at = open.findIndex((s) => s.id === target.value)
  const next = open[((at < 0 ? (step > 0 ? -1 : 0) : at) + step + open.length) % open.length]
  target.value = next.id
  void nextTick(() => listEl.value?.querySelector<HTMLElement>(`[data-target="${next.id}"]`)?.focus())
}

/* ===== 复制 ===== */
const busy = ref(false)
const error = ref('')
const done = ref<{ spaceId: string; id: string; files: number } | null>(null)
const openBtn = ref<HTMLButtonElement | null>(null)

function close() { if (!busy.value) emit('close') }

async function copy() {
  if (busy.value || !target.value) return
  busy.value = true
  error.value = ''
  try {
    if (props.kind === 'canvas') {
      const out = unwrap(await workflowApi.copyTo(props.id, target.value, props.name))
      done.value = { spaceId: out.spaceId, id: out.workflowId, files: out.files }
    } else {
      const out = unwrap(await userAssetApi.copyTo(props.id, target.value))
      done.value = { spaceId: out.spaceId, id: out.id, files: 1 }
    }
    emit('copied', { spaceId: done.value.spaceId, id: done.value.id })
    // 内容换了一屏：原来有焦点的那个按钮没了，焦点接到「过去看」上
    void nextTick(() => openBtn.value?.focus({ preventScroll: true }))
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
    // 开着弹窗的这会儿情况变了（刚被移出目标团队、团长刚关了开关、目标刚放满）：去处重新问一遍，空间列表也刷新
    void space.refresh()
    void loadTargets(false)
  } finally {
    busy.value = false
  }
}

/** 过去看：换到目标空间，画布直接打开，资产去素材库 */
async function openCopy() {
  if (!done.value) return
  const sp = done.value.spaceId === 'personal' ? '' : done.value.spaceId
  const to = props.kind === 'canvas' ? { name: 'canvas', params: { id: done.value.id, space: spaceParam(sp) } } : { name: 'assets', params: { space: spaceParam(sp) } }
  emit('close')
  await router.push(sp ? to : { ...to, query: { space: 'personal' } })
}
</script>

<style scoped>
.cts { width: 480px; }
.cts-h { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cts-what { margin: 0 0 14px; color: var(--text-2); line-height: 1.6; overflow-wrap: anywhere; }
.cts-list { display: flex; flex-direction: column; gap: 8px; }
.cts-item {
  display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px; text-align: left; border-radius: var(--r-md);
  border: 1px solid var(--line-2); background: rgb(var(--c-film) / .04); color: var(--text-2); transition: border-color .15s, background .15s;
}
.cts-item:hover:not(:disabled):not(.off) { border-color: var(--line-3); background: rgb(var(--c-film) / .08); }
.cts-item:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.cts-item.on { border-color: rgb(var(--c-cyan) / .7); background: rgb(var(--c-cyan) / .08); }
/* 去不了的：整行压暗，但原因那一行保持可读 */
.cts-item.off { cursor: not-allowed; background: none; border-style: dashed; }
.cts-item.off :deep(.sav), .cts-item.off .cts-it b { opacity: .55; }
.cts-it { flex: 1; min-width: 0; }
.cts-it b { display: block; font-weight: 600; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cts-it small { display: block; font-size: 12px; color: var(--text-3); }
.cts-it small.cts-why { display: flex; align-items: flex-start; gap: 6px; margin-top: 2px; color: var(--text-2); line-height: 1.5; overflow-wrap: anywhere; }
.cts-why :deep(svg) { flex: none; margin-top: 2px; color: var(--text-3); }
.cts-radio { flex: none; width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line-3); position: relative; }
.cts-item.on .cts-radio { border-color: var(--cyan); }
.cts-item.on .cts-radio::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--cyan); }
.cts-sk { display: block; height: 54px; border-radius: var(--r-md); background: rgb(var(--c-film) / .08); animation: lc-pulse 1.6s ease-in-out infinite; }
.cts-none { margin: 14px 0 0; }
.cts-notes { margin: 14px 0 0; padding-left: 18px; color: var(--text-3); font-size: 13px; line-height: 1.7; }
.cts-done { text-align: center; padding: 28px 24px 20px; }
.cts-done p { margin: 14px 0 0; color: var(--text-2); line-height: 1.7; }
.cts-ok { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; color: var(--ok); background: var(--success-dim); }
.lc-error-text { margin: 12px 0 0; }
</style>
