<template>
  <span class="pn" :class="{ gone, stack }" :data-person-state="state">
    <SpaceAvatar v-if="avatar" class="pn-av" :name="name" :seed="person?.id || name" shape="round" :size="avatar" />
    <span v-tip="{ text: title, clipped: true }" class="pn-name">{{ name }}</span>
    <span v-if="you" class="pn-you">{{ t('spaces.person.you') }}</span>
    <span v-if="note" class="lc-tag pn-tag">{{ note }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 一个人的名字：全站提到人的地方共用（规则见 utils/person.ts）。
 * 已离开团队 / 账号已删除的人名字照旧，后面跟一个灰色标签；名字没留下来的写中性的称呼。
 * avatar 给一个边长就带上圆头像。名字太长时自己截断（悬停看整句，v-tip），标签不截。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import { personName, personNote, personState, personTitle } from '@/utils/person'
import type { Person } from '@/types'

const props = withDefaults(defineProps<{
  person?: Partial<Person> | null
  /** 头像边长（像素）；0 = 不带头像 */
  avatar?: number
  /** 名字后面加「（你）」 */
  you?: boolean
  /** 标签另起一行（窄的格子里） */
  stack?: boolean
}>(), { person: null, avatar: 0, you: false, stack: false })

// 用组件里的 t：切换语言时跟着重渲染（utils/person.ts 读的是同一个全局语言）
const { t, locale } = useI18n()
const state = computed(() => personState(props.person))
const gone = computed(() => state.value !== 'active')
const name = computed(() => (locale.value, personName(props.person)))
const note = computed(() => (locale.value, personNote(props.person)))
const title = computed(() => (locale.value, personTitle(props.person)))
</script>

<style scoped>
.pn { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; vertical-align: middle; }
.pn-av { flex: none; }
.pn-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pn-you { flex: none; color: var(--text-3); font-weight: 400; }
.pn-tag { flex: none; font-weight: 400; white-space: nowrap; }
.pn.gone .pn-name { color: var(--text-2); }
.pn.gone .pn-av { opacity: .6; filter: grayscale(.6); }
.pn.stack { flex-wrap: wrap; row-gap: 2px; }
</style>
