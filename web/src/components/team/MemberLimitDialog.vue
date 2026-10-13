<template>
  <TeamDialog :title="t('team.memberLimit.title', { name: member.name })" :busy="saving" @close="emit('close')" @submit="submit">
    <!-- 这个人本月用了多少、离上限多远：和成员名单、用量页是同一份数字 -->
    <section v-if="side" class="ml-now" :aria-label="t('team.memberLimit.now', { month })" data-testid="member-limit-now">
      <h3>{{ t('team.memberLimit.now', { month }) }}</h3>
      <LimitSide dense member :side="side" :currency="currency" :resets-at="limitsNow?.resetsAt" :timezone="limitsNow?.timezone" />
    </section>

    <div v-for="f in FIELDS" :key="f.key" class="ml-f" role="group" :aria-label="t('team.memberLimit.' + f.key)">
      <span class="ml-l">{{ t('team.memberLimit.' + f.key) }}</span>
      <div class="lc-seg">
        <button type="button" :class="{ on: !form[f.key].custom }" :aria-pressed="!form[f.key].custom" @click="form[f.key].custom = false">
          {{ t('team.memberLimit.follow', { value: defaultText(f.key) }) }}
        </button>
        <button type="button" :class="{ on: form[f.key].custom }" :aria-pressed="form[f.key].custom" :data-act="'custom-' + f.key" @click="pickCustom(f.key)">
          {{ t('team.memberLimit.custom') }}
        </button>
      </div>
      <LimitInput
        v-if="form[f.key].custom"
        :ref="(el) => { inputs[f.key] = el as LimitInputRef | null }"
        v-model="form[f.key].text"
        :kind="f.key"
        :currency="currency"
        :label="t('team.memberLimit.' + f.key)"
        :invalid="bad === f.key"
        :disabled="saving"
        :placeholder="t('team.memberLimit.placeholder')"
      />
    </div>
    <p class="lc-help">{{ t('team.memberLimit.help') }}</p>
    <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>

    <template #foot>
      <button class="lc-btn" type="button" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="lc-btn primary" type="submit" :disabled="saving">{{ saving ? t('common.saving') : t('common.save') }}</button>
    </template>
  </TeamDialog>
</template>

<script setup lang="ts">
/**
 * 调整一名成员的每月上限（只有团长）。次数、预估金额各自可以「跟全员默认值」（传 null）或单独设一个数。
 * 范围由服务端再核一遍（validation.int_range / validation.range），它的话原样显示。
 */
import { computed, nextTick, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamApi, unwrap } from '@/utils/api'
import { formatMoney } from '@/utils/cost'
import { formatInt } from '@/components/space/format'
import TeamDialog from './TeamDialog.vue'
import LimitInput from './LimitInput.vue'
import LimitSide from '@/components/space/LimitSide.vue'
import { monthText } from '@/utils/budget'
import { useTeamPage, parseLimitText, limitText } from './context'
import type { LimitSide as LimitSideData, TeamMember } from '@/types'
import { useEmbed } from '@/embed/context'

type Key = 'runs' | 'amount'
interface LimitInputRef { focus: () => void }

const props = defineProps<{ member: TeamMember }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', m: TeamMember): void }>()

const { t } = useI18n()
const page = useTeamPage()
const ALL_FIELDS: { key: Key }[] = [{ key: 'runs' }, { key: 'amount' }]
/** 集成方关了成本显示（features.cost）：金额那一项不出。存的时候照样带着它原来的值（见 submit），不会被悄悄清掉 */
const FIELDS = useEmbed().features.cost ? ALL_FIELDS : ALL_FIELDS.filter((f) => f.key !== 'amount')

const currency = computed(() => page.detail.value?.limits?.currency || props.member.usage?.currency || 'CNY')
const defaults = computed(() => page.detail.value?.limits?.memberDefault || { runs: null, amount: null })
const limitsNow = computed(() => page.detail.value?.limits || null)
const month = computed(() => monthText(limitsNow.value?.month))
/** 成员名单里那一行带的本月数字，拼成「一侧」：条、明细、状态都是服务端给的 */
const side = computed<LimitSideData | null>(() => {
  const m = props.member
  if (!m.usage?.breakdown || !m.effective) return null
  return {
    runs: m.effective.runs, amount: m.effective.amount, uncounted: m.usage.uncounted,
    breakdown: m.usage.breakdown, effective: m.effective,
  }
})

const own = props.member.limits
const form = reactive<Record<Key, { custom: boolean; text: string }>>({
  runs: { custom: !!own?.custom.runs, text: own?.custom.runs ? limitText(own.runs) : '' },
  amount: { custom: !!own?.custom.amount, text: own?.custom.amount ? limitText(own.amount) : '' },
})
const inputs = reactive<Record<Key, LimitInputRef | null>>({ runs: null, amount: null })

function defaultText(key: Key) {
  const v = defaults.value[key]
  if (v == null) return t('spaces.limits.unlimited')
  return key === 'runs' ? t('spaces.limits.runs', { n: formatInt(v) }) : formatMoney(v, currency.value)
}
async function pickCustom(key: Key) {
  form[key].custom = true
  await nextTick()
  inputs[key]?.focus()
}

const saving = ref(false)
const error = ref('')
const bad = ref<Key | ''>('')

async function submit() {
  if (saving.value) return
  error.value = ''
  bad.value = ''
  const limits: Record<Key, number | null> = { runs: null, amount: null }
  for (const { key } of ALL_FIELDS) {
    if (!form[key].custom) continue
    const v = parseLimitText(form[key].text, key === 'runs')
    if (v == null) {
      bad.value = key
      error.value = t(form[key].text.trim() ? 'team.limitInput.bad.' + key : 'team.memberLimit.needNumber')
      return
    }
    limits[key] = v
  }
  saving.value = true
  try {
    emit('saved', unwrap(await teamApi.updateMember(page.teamId, props.member.id, { limits })))
  } catch (err) {
    error.value = page.explain(err)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.ml-now { padding: 14px 16px; border-radius: var(--r-md); border: 1px solid var(--line); background: rgb(var(--c-film) / .04); }
.ml-now h3 { margin: 0 0 12px; font: 500 13px/1.4 var(--f-body); color: var(--text-2); }
.ml-f { display: grid; gap: 8px; margin-top: 16px; justify-items: start; }
.ml-l { font-size: 13px; color: var(--text); font-weight: 500; }
.ml-f :deep(.li) { width: 220px; max-width: 100%; }
.lc-help { display: block; margin-top: 16px; }
</style>
