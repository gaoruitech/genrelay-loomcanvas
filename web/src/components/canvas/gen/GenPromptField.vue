<template>
  <div class="gf-prompt" :class="[variant, { focused, 'is-up': g.upstream.connected }]" @mousedown.stop @click.stop>
    <!-- 提示词来自上游文本节点：只读展示，就是运行时会发出去的那一份 -->
    <template v-if="g.upstream.connected">
      <div v-if="variant !== 'node'" class="gf-up-h">
        <LcIcon name="branch" size="s" />{{ t('gen.prompt.fromUpstream') }}<span>{{ t('gen.prompt.readOnly') }}</span>
      </div>
      <div class="gf-up-q" :class="{ empty: !g.upstream.text }" :title="g.upstream.text" data-testid="gen-upstream">
        <span v-if="variant === 'node'" class="gf-up-tag">{{ t('gen.prompt.upstreamTag') }}</span>{{ g.upstream.text || t('gen.prompt.upstreamEmpty') }}
      </div>
    </template>
    <div v-else-if="!g.hasOwnPrompt" class="gf-up-q empty">{{ t('gen.prompt.connectText') }}</div>

    <!-- 节点自己的提示词。连了上游时它只是备用：上游有内容就整段用上游的 -->
    <div v-if="g.hasOwnPrompt" class="gf-ta" :class="{ fallback: g.upstream.connected }">
      <span v-if="g.upstream.connected" class="gf-ta-l" :title="t('gen.prompt.fallbackTip')">{{ t('gen.prompt.fallback') }}</span>
      <div class="gf-ta-box">
        <div ref="hlRef" class="gf-hl" aria-hidden="true" v-html="highlighted" />
        <textarea
          ref="taRef"
          v-model="g.prompt"
          class="gf-textarea nodrag nowheel"
          :placeholder="g.upstream.connected ? t('gen.prompt.fallbackPlaceholder') : g.placeholder"
          :maxlength="PROMPT_MAX"
          rows="1"
          data-testid="gen-prompt"
          @input="onInput"
          @keydown="onKeydown"
          @focus="onFocus"
          @blur="onBlur"
          @scroll="syncScroll"
          @wheel.stop
        />
      </div>
    </div>

    <!-- 大语言模型：系统提示词（可选） -->
    <div v-if="g.kind === 'llm'" class="gf-ta sys">
      <span class="gf-ta-l">{{ t('gen.prompt.system') }}</span>
      <div class="gf-ta-box">
        <textarea
          ref="sysRef"
          v-model="g.systemPrompt"
          class="gf-textarea nodrag nowheel"
          :placeholder="t('nodeui.llm.systemPromptPlaceholder')"
          :maxlength="PROMPT_MAX"
          :disabled="g.isRunning"
          rows="1"
          data-testid="gen-system"
          @input="fitSys"
          @keydown="onSysKeydown"
          @focus="onFocus"
          @blur="onBlur"
          @wheel.stop
        />
      </div>
    </div>

    <!-- 输入图小签 + 清空 / 字数 / 放大。布局 c 的节点自己排这一行（端口要对着它） -->
    <div v-if="meta && (g.hasOwnPrompt || g.imageRefs.length)" class="gf-pm">
      <GenRefs sm />
      <span v-if="g.imageRefs.length && g.hasOwnPrompt && variant === 'inspector'" class="gf-pm-hint">{{ t('gen.prompt.atHint') }}</span>
      <span v-if="g.hasOwnPrompt" class="gf-pm-r">
        <button v-if="g.prompt" type="button" class="gf-link" data-testid="gen-clear" @click.stop="g.prompt = ''">{{ t('common.clear') }}</button>
        <span class="gf-count" data-testid="gen-count-chars">{{ g.prompt.length }} / {{ PROMPT_MAX }}</span>
        <button type="button" class="gf-ib-plain" :title="t('nodes.action.expand')" :aria-label="t('nodes.action.expand')" data-testid="gen-expand" @click.stop="openExpand"><GenIconExpand /></button>
      </span>
    </div>

    <MentionPicker
      :open="g.mention.picker.open"
      :items="g.mention.matches()"
      :active="g.mention.picker.active"
      :x="g.mention.picker.x"
      :y="g.mention.picker.y"
      :width="g.mention.picker.width"
      @pick="g.mention.pick"
      @hover="g.mention.picker.active = $event"
    />

    <!-- 放大编辑：脱离面板居中，和原位那个框是同一段提示词 -->
    <Teleport to="body">
      <div v-if="expanded" class="gf-expand nodrag nowheel" role="dialog" aria-modal="true" :aria-label="g.promptLabel" data-testid="gen-expand-editor" @click.stop @mousedown.stop @wheel.stop>
        <div class="gf-expand-h">
          <span>{{ g.title }} · {{ g.promptLabel }}</span>
          <button type="button" class="gf-ib-plain" :title="t('nodes.action.collapse')" :aria-label="t('nodes.action.collapse')" @click.stop="expanded = false"><LcIcon name="x" size="s" /></button>
        </div>
        <textarea
          ref="bigRef"
          v-model="g.prompt"
          class="gf-expand-ta"
          :placeholder="g.placeholder"
          :maxlength="PROMPT_MAX"
          @input="g.mention.onInput"
          @keydown="onBigKeydown"
          @blur="g.mention.close"
        />
        <div class="gf-expand-f">
          <button type="button" class="gf-link" :disabled="!g.prompt" @click.stop="g.prompt = ''">{{ t('common.clear') }}</button>
          <span class="gf-count">{{ g.prompt.length }} / {{ PROMPT_MAX }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * 提示词这一项，三种布局共用：
 *   composer   布局 a 的输入条
 *   inspector  布局 b 的属性面板
 *   node       布局 c 节点里的输入框（没聚焦时收成两行）
 *
 * 上游文本节点连进来时，上游的内容只读展示（运行时发出去的就是它），节点自己写的那段标成「备用」——
 * 执行器的规则是「上游有内容就整段用上游的，上游是空的才用自己写的」，这里不改它。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState, PROMPT_MAX } from '@/composables/useGenNode'
import { knownMentionRanges } from '@/composables/canvasImageRefs'
import LcIcon from '@/components/LcIcon.vue'
import GenIconExpand from './GenIconExpand.vue'
import MentionPicker from '../MentionPicker.vue'
import GenRefs from './GenRefs.vue'

const props = defineProps<{
  variant: 'composer' | 'inspector' | 'node'
  /** 输入图、清空、字数、放大这一行要不要由这里画 */
  meta?: boolean
}>()
const emit = defineEmits<{ (e: 'escape'): void; (e: 'focused', v: boolean): void }>()

const { t } = useI18n()
const g = useGenNodeState()

const taRef = ref<HTMLTextAreaElement | null>(null)
const sysRef = ref<HTMLTextAreaElement | null>(null)
const hlRef = ref<HTMLElement | null>(null)
const bigRef = ref<HTMLTextAreaElement | null>(null)
const focused = ref(false)
const expanded = ref(false)

/* 高度跟着内容长：各布局的下限 / 上限不同；布局 c 没聚焦时固定两行 */
const LIMITS = { composer: [66, 220], inspector: [104, 280], node: [40, 240] } as const
function fit() {
  const el = taRef.value
  if (!el) return
  const [min, max] = LIMITS[props.variant]
  if (props.variant === 'node' && !focused.value) { el.style.height = `${min}px`; el.scrollTop = 0; syncScroll(); return }
  el.style.height = 'auto'
  el.style.height = `${Math.min(max, Math.max(g.upstream.connected ? 22 : min, el.scrollHeight))}px`
  syncScroll()
}
function fitSys() {
  const el = sysRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(160, Math.max(22, el.scrollHeight))}px`
}
function syncScroll() {
  if (hlRef.value && taRef.value) hlRef.value.scrollTop = taRef.value.scrollTop
}
watch(() => [g.prompt, g.upstream.connected, focused.value], () => nextTick(fit))
watch(() => g.systemPrompt, () => nextTick(fitSys))
onMounted(() => { fit(); fitSys() })

/**
 * 文本框底下垫一层同样排版的字，只给 @图1 这样的指代上一块底色 —— 看得出哪几个字是在指一张图。
 * 只标真能对上输入图的名字（和运行时的校验是同一套规则）；对不上的保持原样，运行时执行器会拦下来说明。
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const highlighted = computed(() => {
  const text = g.prompt
  let out = ''
  let last = 0
  for (const r of knownMentionRanges(text, g.imageRefs)) {
    out += esc(text.slice(last, r.start)) + `<mark>${esc(text.slice(r.start, r.end))}</mark>`
    last = r.end
  }
  // 末尾补一个换行：文本以换行结尾时，底下这层才会和文本框一样多出一行
  return out + esc(text.slice(last)) + '\n'
})

function onInput(e: Event) { g.mention.onInput(e); fit() }
function onFocus() { focused.value = true; emit('focused', true) }
function onBlur() {
  g.mention.close()
  focused.value = false
  emit('focused', false)
}
function runKey(e: KeyboardEvent): boolean {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void g.run(); return true }
  return false
}
function onKeydown(e: KeyboardEvent) {
  // @ 候选框开着时，方向键 / 回车 / Esc 都是它的
  const picking = g.mention.picker.open
  g.mention.onKeydown(e)
  if (picking) return
  if (runKey(e)) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).blur(); emit('escape') }
}
function onSysKeydown(e: KeyboardEvent) {
  if (runKey(e)) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).blur(); emit('escape') }
}
function onBigKeydown(e: KeyboardEvent) {
  const picking = g.mention.picker.open
  g.mention.onKeydown(e)
  if (picking) return
  if (runKey(e)) { expanded.value = false; return }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); expanded.value = false; nextTick(() => taRef.value?.focus()) }
}

function openExpand() {
  expanded.value = true
  nextTick(() => {
    const el = bigRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

/** 把焦点放进提示词框，光标落在末尾。没有自己的提示词框（文本类节点）就落到系统提示词上 */
function focus() {
  const el = taRef.value || sysRef.value
  if (!el) return false
  el.focus({ preventScroll: true })
  el.setSelectionRange(el.value.length, el.value.length)
  return true
}
defineExpose({ focus, openExpand, focused })
</script>
