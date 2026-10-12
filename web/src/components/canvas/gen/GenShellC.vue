<template>
  <GenHead mode="tag" />

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
        <span>{{ g.imageRefs.length ? t('gen.prompt.atHint') : t('gen.prompt.runHint') }}</span>
        <span>
          <button type="button" class="gf-link nodrag" @mousedown.prevent.stop @click.stop="promptRef?.openExpand()">{{ t('gen.prompt.expand') }}</button>
          <button type="button" class="gf-link nodrag" :disabled="!g.prompt" @mousedown.prevent.stop @click.stop="g.prompt = ''">{{ t('common.clear') }}</button>
        </span>
      </div>
    </div>

    <GenNotes :kit="selected" tight />

    <!-- 模型、参数、成本、运行并成一行 -->
    <div class="gn-crow">
      <GenRunButton v-if="g.isRunning" variant="bar" />
      <template v-else>
        <GenModelField variant="chip-sm" />
        <GenParamsField variant="chip-sm" />
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
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState, PROMPT_MAX } from '@/composables/useGenNode'
import { CANVAS_NODE_UI_KEY } from '@/composables/nodeLayout'
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

const focused = ref(false)
const promptRef = ref<InstanceType<typeof GenPromptField> | null>(null)
// 画布上选中这个节点后直接打字：焦点落进这里的提示词框
onMounted(() => ui?.registerPromptFocus(g.id, () => { promptRef.value?.focus() }))
onBeforeUnmount(() => ui?.registerPromptFocus(g.id, null))
</script>
