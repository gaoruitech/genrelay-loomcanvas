<template>
  <GenHead mode="tag" kit-entry />

  <div class="gn-stage">
    <GenMedia layout="c" :selected="selected" @detail="emit('detail')" @expand="emit('expand')" />
    <!-- 源视频这种「整段素材」的输入口对着画面；提示词和参考图的口对着下面各自的字段 -->
    <GenHandle v-for="p in sourcePorts" :key="p.id" :port="p" label="tag" />
    <GenHandle v-if="output" :port="output" />
  </div>

  <div class="gn-cb">
    <div class="gn-cfld" :class="{ f: focused }">
      <GenHandle v-if="promptPort" :port="promptPort" label="tag" class="at-prompt" />
      <GenPromptField ref="promptRef" variant="node" @focused="focused = $event" />

      <div class="gn-crefs" :class="{ two: imagePorts.length > 1 }">
        <GenHandle v-for="(p, i) in imagePorts" :key="p.id" :port="p" label="tag" :style="{ top: `calc(50% + ${i * 20}px)` }" />
        <GenRefs v-if="g.imageRefs.length" sm />
        <span v-else-if="imagePorts.length" class="gn-crefs-none">{{ imagePorts[0].off ? imagePorts[0].title : t('gen.refs.none', { name: imagePorts[0].label }) }}</span>
        <span v-if="focused && g.hasOwnPrompt" class="gn-crefs-r gf-count">{{ g.prompt.length }} / {{ PROMPT_MAX }}</span>
      </div>

      <!-- 聚焦时才出现：@ 的用法、放大、清空。按下时不让输入框失焦，否则这一行会在点到之前消失 -->
      <div v-if="focused && g.hasOwnPrompt" class="gn-chint">
        <!-- 只读：@ 的用法、「Ctrl+Enter 运行」都用不上，只留「放大」（长提示词要能整段看） -->
        <span>{{ g.viewOnly ? '' : g.imageRefs.length ? t('gen.prompt.atHint') : t('gen.prompt.runHint') }}</span>
        <span>
          <button type="button" class="gf-link nodrag" @mousedown.prevent.stop @click.stop="promptRef?.openExpand()">{{ t('gen.prompt.expand') }}</button>
          <button v-if="!g.viewOnly" type="button" class="gf-link nodrag" :disabled="!g.prompt" @mousedown.prevent.stop @click.stop="g.prompt = ''">{{ t('common.clear') }}</button>
        </span>
      </div>
    </div>

    <!-- 品牌包不在这里占一行：选不选中节点都一样高，连线才不会跳。它在表头的那颗标记里（点开能看、能改） -->
    <GenNotes tight />

    <!-- 模型、参数、成本、运行并成一行，永远只有一行：放不下时先收紧留白，再把参数收成「第一项 +N」，最后才让模型名收缩 -->
    <div ref="rowRef" class="gn-crow" :class="`fit-${fit}`" :data-fit="fit" data-testid="gen-row">
      <GenRunButton v-if="g.isRunning" variant="bar" />
      <template v-else>
        <GenModelField variant="chip-sm" />
        <GenParamsField variant="chip-sm" :compact="fit >= 3" />
        <GenCost />
        <GenRunButton variant="md" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 布局 c · 一体化卡片：所有东西都在节点上。结果在最上面，底下只有一个会自己长高的提示词框
 * （字数和 @ 的提示聚焦时才出现），模型、参数、成本、运行并成一行；端口对着它所输入的字段。
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState, PROMPT_MAX } from '@/composables/useGenNode'
import { CANVAS_NODE_UI_KEY } from '@/composables/nodeLayout'
import { createRowFit } from './rowFit'
import GenHead from './GenHead.vue'
import GenMedia from './GenMedia.vue'
import GenHandle from './GenHandle.vue'
import GenPromptField from './GenPromptField.vue'
import GenRefs from './GenRefs.vue'
import GenNotes from './GenNotes.vue'
import GenModelField from './GenModelField.vue'
import GenParamsField from './GenParamsField.vue'
import GenCost from './GenCost.vue'
import GenRunButton from './GenRunButton.vue'

defineProps<{ selected?: boolean }>()
const emit = defineEmits<{ (e: 'detail'): void; (e: 'expand'): void }>()
const { t } = useI18n()
const g = useGenNodeState()
const ui = inject(CANVAS_NODE_UI_KEY, undefined)

const output = computed(() => g.ports.find(p => p.type === 'source'))
const promptPort = computed(() => g.ports.find(p => p.id === 'text-in'))
const imagePorts = computed(() => g.ports.filter(p => p.type === 'target' && p.dataType === 'image'))
const sourcePorts = computed(() => g.ports.filter(p => p.type === 'target' && p.dataType === 'video'))

/* ── 底下那一行放不放得下 ──
   节点宽度是定死的，而模型名、参数、成本、「重新运行」的长度随模型和语言变。成本和运行钮不让位，其余按顺序让：
     0  都按自己的宽度排（模型名最长 132px）
     1  只收紧留白：间距和 chip、运行钮的内边距小一点 —— 一个字都不少
     2  再收紧一档（仍然一个字都不少）
     3  参数 chip 收成「第一项 +N」（完整的在悬停提示和弹层里）
     4  还不够：模型名收缩成省略号（悬停提示和下拉里有全名）
   运行钮在这一行里只有字、不带三角（见 GenRunButton）：每个节点都一样，不随放不放得下而变。
   每次内容变了都从 0 重新量：换成短名字的模型后要能放回去。量的是布局宽度，不受画布缩放影响。 */
const rowRef = ref<HTMLElement | null>(null)
const fit = ref(0)
/* 怎么保证停得下来（至多五步、不重入、补量排到宏任务里）见 rowFit.ts。这里只管「换一档」和「量一次」：
   量的是这一行自己的 scrollWidth / clientWidth —— 行高定死、节点宽度定死，换档不会让节点变大变小，
   所以没有「收紧 → 尺寸变了 → 又要量」这一圈；这里也不挂 ResizeObserver。 */
let fitTimer: number | null = null
const rowFit = createRowFit({
  max: 4,
  apply: async (level) => { fit.value = level; await nextTick() },
  fits: () => { const el = rowRef.value; return !el || el.clientWidth <= 0 || el.scrollWidth <= el.clientWidth },
  defer: (run, ms) => { fitTimer = window.setTimeout(() => { fitTimer = null; run() }, ms) },
})
const refit = () => { void rowFit.request() }
/* 监听的是拼出来的一个字符串：这一行里的字真的变了才重量。以前监听的是一个每次都新建的数组，里面读着 modelOpts
   （模型清单、团队上限每刷新一次它就换一个新数组 —— 有节点开始跑 / 跑完都会刷新）：这一行一个字没变，画布上每个
   节点也都从第 0 档重新量一遍。 */
watch(() => JSON.stringify([g.modelLabel, g.paramsSummary, g.costText, g.runLabel, g.isRunning, g.modelOpts.length, g.viewOnly]), refit, { flush: 'post' })
onMounted(() => {
  refit()
  // 网络字体晚到时字宽会变：换上来之后再量一次
  if (typeof document !== 'undefined' && document.fonts?.ready) void document.fonts.ready.then(refit)
})
onBeforeUnmount(() => {
  rowFit.stop()
  if (fitTimer !== null) { window.clearTimeout(fitTimer); fitTimer = null }
})

const focused = ref(false)
const promptRef = ref<InstanceType<typeof GenPromptField> | null>(null)
// 画布上选中这个节点后直接打字：焦点落进这里的提示词框
onMounted(() => ui?.registerPromptFocus(g.id, () => { promptRef.value?.focus() }))
onBeforeUnmount(() => ui?.registerPromptFocus(g.id, null))
</script>
