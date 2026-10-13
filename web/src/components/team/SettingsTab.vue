<template>
  <div v-if="team" class="st">
    <!-- 基本信息：名称、头像（团长和管理员），时区（团长） -->
    <section class="lc-card st-card" data-card="basic">
      <header class="st-head"><h2>{{ t('team.settings.basic.title') }}</h2></header>
      <form class="st-row" @submit.prevent="saveName">
        <div class="st-k"><label for="st-name">{{ t('team.settings.basic.name') }}</label></div>
        <div class="st-v">
          <input id="st-name" v-model="nameText" class="lc-input st-name" maxlength="40" autocomplete="off" :disabled="saving.name" />
          <button v-if="nameDirty" class="lc-btn primary quiet" type="submit" :disabled="saving.name || !nameText.trim()" data-act="save-name">
            {{ saving.name ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </form>
      <div class="st-row">
        <div class="st-k">
          <span>{{ t('team.settings.basic.avatar') }}</span>
          <small>{{ t('team.settings.basic.avatarHelp') }}</small>
        </div>
        <div class="st-v">
          <SpaceAvatar :name="team.name" :src="team.avatar" :seed="team.id" :size="36" />
          <input ref="fileEl" class="st-file" type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" aria-hidden="true" @change="onAvatarFile" />
          <button class="lc-btn sm" type="button" :disabled="saving.avatar" data-act="avatar-change" @click="fileEl?.click()">
            {{ saving.avatar ? t('common.uploading') : t('team.settings.basic.avatarChange') }}
          </button>
          <button v-if="team.avatar" class="lc-btn sm ghost" type="button" :disabled="saving.avatar" data-act="avatar-remove" @click="setAvatar('')">{{ t('common.remove') }}</button>
        </div>
      </div>
      <div class="st-row">
        <div class="st-k">
          <span id="st-zone-l">{{ t('team.settings.basic.zone') }}<span v-if="!canSettings" class="lc-tag accent">{{ t('team.settings.ownerOnly') }}</span></span>
          <small>{{ t(canSettings ? 'team.settings.basic.zoneHelp' : 'team.settings.basic.zoneReadOnly') }}</small>
        </div>
        <div class="st-v">
          <div v-if="canSettings" class="st-zone">
            <LcSelect :model-value="team.timezone || 'UTC'" :options="zoneOptions" searchable :search-placeholder="t('team.settings.basic.zoneSearch')" data-testid="team-zone" :disabled="saving.zone" aria-labelledby="st-zone-l" @change="setZone" />
          </div>
          <span v-else class="st-ro lc-mono">{{ zoneLabel(team.timezone || 'UTC') }}</span>
        </div>
      </div>
    </section>

    <!-- 默认权限：团长改；管理员只读 -->
    <section class="lc-card st-card" data-card="defaults">
      <header class="st-head">
        <h2>{{ t('team.settings.defaults.title') }}<span v-if="!canSettings" class="lc-tag accent">{{ t('team.settings.ownerOnly') }}</span></h2>
        <p v-if="!canSettings">{{ t('team.settings.defaults.readOnly') }}</p>
      </header>
      <div class="st-row">
        <div class="st-k">
          <span id="st-vis-l">{{ t('team.settings.defaults.visibility') }}</span>
          <small>{{ t('team.settings.defaults.visibilityHelp') }}</small>
        </div>
        <div class="st-v">
          <div class="lc-seg" role="group" aria-labelledby="st-vis-l">
            <button
              v-for="v in VISIBILITIES" :key="v" type="button" :class="{ on: view.defaultVisibility === v }" :aria-pressed="view.defaultVisibility === v"
              :disabled="!canSettings" :data-vis="v" @click="setSetting('defaultVisibility', v)"
            >{{ t('spaces.visibility.' + v + '.label') }}</button>
          </div>
        </div>
      </div>
      <!-- 「谁能创建公开分享链接」：集成方关了分享（features.share）就没有这一项 -->
      <div v-if="$feat.share" class="st-row">
        <div class="st-k">
          <span id="st-share-l">{{ t('team.settings.defaults.share') }}</span>
          <small>{{ t('team.settings.defaults.shareHelp') }}</small>
        </div>
        <div class="st-v">
          <div class="lc-seg" role="group" aria-labelledby="st-share-l">
            <button
              v-for="v in SHARERS" :key="v" type="button" :class="{ on: view.publicShare === v }" :aria-pressed="view.publicShare === v"
              :disabled="!canSettings" :data-share="v" @click="setSetting('publicShare', v)"
            >{{ t('team.settings.defaults.sharers.' + v) }}</button>
          </div>
        </div>
      </div>
      <div class="st-row sw">
        <div class="st-k">
          <span id="st-seeall-l">{{ t('team.settings.defaults.adminsSeeAll') }}</span>
          <small>{{ t('team.settings.defaults.adminsSeeAllHelp') }}</small>
        </div>
        <div class="st-v">
          <button
            type="button" class="lc-switch" :class="{ on: view.adminsSeeAll }" role="switch" :aria-checked="view.adminsSeeAll" aria-labelledby="st-seeall-l"
            :disabled="!canSettings" data-switch="adminsSeeAll" @click="setSetting('adminsSeeAll', !view.adminsSeeAll)"
          />
        </div>
      </div>
      <div class="st-row sw">
        <div class="st-k">
          <!-- 集成方关了素材库（features.assetLibrary）：能复制的只有画布，这句话不提资产 -->
          <span id="st-copy-l">{{ t($feat.assetLibrary ? 'team.settings.defaults.copyToPersonal' : 'team.settings.defaults.copyToPersonalNoAssets') }}</span>
          <small>{{ t('team.settings.defaults.copyToPersonalHelp') }}</small>
        </div>
        <div class="st-v">
          <button
            type="button" class="lc-switch" :class="{ on: view.copyToPersonal }" role="switch" :aria-checked="view.copyToPersonal" aria-labelledby="st-copy-l"
            :disabled="!canSettings" data-switch="copyToPersonal" @click="setSetting('copyToPersonal', !view.copyToPersonal)"
          />
        </div>
      </div>
    </section>

    <!-- 额度：只有团长 -->
    <section v-if="canLimits" class="lc-card st-card" data-card="limits">
      <header class="st-head">
        <h2>{{ t('team.settings.limits.title') }}<span class="lc-tag accent">{{ t('team.settings.ownerOnly') }}</span></h2>
      </header>
      <div v-if="!limits && !limitsError" class="st-sk" aria-busy="true"><i /><i /><i /></div>
      <div v-else-if="!limits" class="st-state">
        <p class="lc-error-text" role="alert">{{ limitsError }}</p>
        <button class="lc-btn sm" type="button" @click="loadLimits">{{ t('common.retry') }}</button>
      </div>
      <form v-else novalidate @submit.prevent="saveLimits">
        <div class="st-row">
          <div class="st-k">
            <span>{{ t('team.settings.limits.team') }}</span>
            <small>{{ t($feat.cost ? 'team.settings.limits.teamHelp' : 'team.settings.limits.teamHelpRuns') }}</small>
            <small v-if="limits.team" class="st-used" data-testid="limits-used">{{ usedNote }}</small>
          </div>
          <div class="st-v">
            <LimitInput v-model="form.teamRuns" kind="runs" :label="t('team.settings.limits.teamRuns')" :invalid="bad === 'teamRuns'" :disabled="saving.limits" />
            <!-- 金额上限、币种、「没填价格的模型不让跑」：集成方关了成本显示（features.cost）就不出。存的时候金额上限照原样带着（表单里的值没动），不会被清掉 -->
            <LimitInput v-if="$feat.cost" v-model="form.teamAmount" kind="amount" :currency="form.currency" :label="t('team.settings.limits.teamAmount')" :invalid="bad === 'teamAmount'" :disabled="saving.limits" />
          </div>
        </div>
        <div class="st-row">
          <div class="st-k">
            <span>{{ t('team.settings.limits.memberDefault') }}</span>
            <small>{{ t('team.settings.limits.memberDefaultHelp') }}</small>
          </div>
          <div class="st-v">
            <LimitInput v-model="form.defRuns" kind="runs" :label="t('team.settings.limits.defRuns')" :invalid="bad === 'defRuns'" :disabled="saving.limits" />
            <LimitInput v-if="$feat.cost" v-model="form.defAmount" kind="amount" :currency="form.currency" :label="t('team.settings.limits.defAmount')" :invalid="bad === 'defAmount'" :disabled="saving.limits" />
          </div>
        </div>
        <div v-if="$feat.cost" class="st-row">
          <div class="st-k">
            <span id="st-cur-l">{{ t('team.settings.limits.currency') }}</span>
            <small>{{ t('team.settings.limits.currencyHelp') }}</small>
          </div>
          <div class="st-v">
            <div class="st-cur"><LcSelect v-model="form.currency" :options="currencyOptions" :disabled="saving.limits" aria-labelledby="st-cur-l" /></div>
          </div>
        </div>
        <div v-if="limitsDirty || limitsFormError" class="st-save" data-testid="limits-savebar">
          <p v-if="limitsFormError" class="lc-error-text" role="alert">{{ limitsFormError }}</p>
          <p v-else class="st-unsaved"><i aria-hidden="true" />{{ t('settings.unsaved') }}</p>
          <button class="lc-btn ghost" type="button" :disabled="saving.limits" @click="resetLimitsForm">{{ t('settings.discard') }}</button>
          <button class="lc-btn primary quiet" type="submit" :disabled="saving.limits || !limitsDirty" data-act="save-limits">{{ saving.limits ? t('common.saving') : t('common.save') }}</button>
        </div>
        <div v-if="$feat.cost" class="st-row sw">
          <div class="st-k">
            <span id="st-block-l">{{ t('team.settings.limits.blockUnpriced') }}</span>
            <small>{{ t(amountLimited ? 'team.settings.limits.blockUnpricedHelp' : 'team.settings.limits.blockUnpricedIdle') }}</small>
          </div>
          <div class="st-v">
            <button
              type="button" class="lc-switch" :class="{ on: blockView }" role="switch" :aria-checked="blockView" aria-labelledby="st-block-l"
              :disabled="saving.block" data-switch="blockUnpriced" @click="setBlock(!blockView)"
            />
          </div>
        </div>
        <!-- 后果是服务端给的（unpriced.effect / blocked），这里不从上限和开关再推一遍 -->
        <div v-if="$feat.cost && limits.uncountable?.length && unpricedEffect !== 'none'" class="st-warn">
          <div class="lc-alert warn" data-testid="uncountable" :data-effect="unpricedEffect">
            <LcIcon name="warn" />
            <span>
              {{ t(unpricedEffect === 'refused' ? (limits.unpriced?.blocked === 'some' ? 'team.settings.limits.uncountableBlockedSome' : 'team.settings.limits.uncountableBlocked') : 'team.settings.limits.uncountableOpen', { n: limits.uncountable.length, models: uncountableNames, currency: limits.currency }) }}
              <router-link :to="{ name: 'models' }">{{ t('team.goPrices') }}</router-link>
            </span>
          </div>
        </div>
      </form>
    </section>

    <!-- 危险操作：只有团长 -->
    <section v-if="space.isTeamOwner" class="lc-card st-card danger" data-card="danger">
      <header class="st-head">
        <h2>{{ t('team.settings.danger.title') }}<span class="lc-tag accent">{{ t('team.settings.ownerOnly') }}</span></h2>
      </header>
      <div class="st-row">
        <div class="st-k">
          <span>{{ t('team.settings.danger.transfer') }}</span>
          <small>{{ t('team.settings.danger.transferHelp') }}</small>
        </div>
        <div class="st-v"><button class="lc-btn" type="button" data-act="transfer" @click="openTransfer">{{ t('team.settings.danger.transferBtn') }}</button></div>
      </div>
      <div class="st-row">
        <div class="st-k">
          <span>{{ t('team.settings.danger.dissolve') }}</span>
          <small>{{ t('team.settings.danger.dissolveHelp') }}</small>
        </div>
        <div class="st-v"><button class="lc-btn danger" type="button" data-act="dissolve" @click="openDissolve">{{ t('team.settings.danger.dissolveBtn') }}</button></div>
      </div>
    </section>

    <!-- 管理员：退出团队 -->
    <section v-else-if="space.can('team:leave')" class="lc-card st-card" data-card="leave">
      <header class="st-head"><h2>{{ t('team.settings.leave.title') }}</h2></header>
      <div class="st-row">
        <div class="st-k">
          <span>{{ t('team.settings.leave.label', { name: team.name }) }}</span>
          <small>{{ t('team.settings.leave.help') }}</small>
        </div>
        <div class="st-v"><button class="lc-btn danger" type="button" data-act="leave" @click="dialog = 'leave'">{{ t('team.settings.leave.btn') }}</button></div>
      </div>
    </section>

    <ConfirmNameDialog
      v-if="dialog === 'transfer'"
      :title="t('team.settings.danger.transfer')"
      :name="team.name"
      :ok-text="t('team.transfer.confirm')"
      :busy-text="t('team.transfer.busy')"
      :busy="busy"
      :disabled="!heir"
      :error="dialogError"
      @close="closeDialog"
      @confirm="transfer"
    >
      <p class="st-dp">{{ t('team.transfer.body') }}</p>
      <div class="lc-field st-heir">
        <label id="st-heir-l">{{ t('team.transfer.pick') }}</label>
        <p v-if="candidates === null" class="lc-help">{{ t('common.loading') }}</p>
        <p v-else-if="!candidates.length" class="lc-help err">{{ t('team.transfer.nobody') }}</p>
        <LcSelect v-else v-model="heir" :options="heirOptions" :searchable="heirOptions.length > 8" :placeholder="t('team.transfer.placeholder')" aria-labelledby="st-heir-l" />
      </div>
    </ConfirmNameDialog>

    <ConfirmNameDialog
      v-if="dialog === 'dissolve'"
      :title="t('team.dissolve.title', { name: team.name })"
      :name="team.name"
      :ok-text="t('team.dissolve.confirm')"
      :busy-text="t('team.dissolve.busy')"
      :busy="busy"
      :error="dialogError"
      @close="closeDialog"
      @confirm="dissolve"
    >
      <p class="st-dp">{{ t('team.dissolve.body') }}</p>
      <p class="st-dp">{{ t(dissolveGeneric ? 'team.dissolve.restoreGeneric' : 'team.dissolve.restore') }}</p>
    </ConfirmNameDialog>

    <LeaveDialog v-if="dialog === 'leave'" @close="dialog = ''" />
  </div>
</template>

<script setup lang="ts">
/**
 * 团队设置页签（团长和管理员）。管理员只能改名称和头像，其余只读；额度和危险操作只有团长看得到。
 * 开关、分段一拨就保存（和站点设置里的开关一样）；几个数字的额度改完点「保存」。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { teamApi, filesApi, unwrap, apiErrorCode } from '@/utils/api'
import { MessagePlugin } from '@/utils/feedback'
import { formatMoney } from '@/utils/cost'
import { useEmbed } from '@/embed/context'
import { useSpaceStore } from '@/stores/space'
import { formatInt } from '@/components/space/format'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import ConfirmNameDialog from '@/components/space/ConfirmNameDialog.vue'
import LimitInput from './LimitInput.vue'
import { countedText } from '@/utils/budget'
import LeaveDialog from './LeaveDialog.vue'
import { useTeamPage, parseLimitText, limitText, toPersonalSpace } from './context'
import type { CanvasVisibility, TeamLimits, TeamMember, TeamSettings } from '@/types'

const { t } = useI18n()
const embed = useEmbed()
const router = useRouter()
const space = useSpaceStore()
const page = useTeamPage()

const team = computed(() => page.detail.value)
const canSettings = computed(() => space.can('team:settings'))
const canLimits = computed(() => space.can('limits:manage'))
const saving = reactive({ name: false, avatar: false, zone: false, limits: false, block: false })

/** 改团队本身（名称、头像、时区、设置）。成功后外壳上的名字、头像、各处用到的团队设置都跟着变 */
async function patch(data: Parameters<typeof teamApi.update>[1]): Promise<boolean> {
  try {
    page.detail.value = unwrap(await teamApi.update(page.teamId, data))
    void space.refresh()
    return true
  } catch (err) {
    page.fail(err)
    return false
  }
}

// ---- 名称 ----
const nameText = ref(team.value?.name || '')
watch(() => team.value?.name, (v) => { nameText.value = v || '' })
const nameDirty = computed(() => nameText.value.trim() !== (team.value?.name || ''))
async function saveName() {
  const name = nameText.value.trim()
  if (!name || !nameDirty.value || saving.name) return
  saving.name = true
  if (await patch({ name })) MessagePlugin.success(t('common.saved'))
  saving.name = false
}

// ---- 头像：传到团队空间里（当前空间就是团队），再把地址记到团队上 ----
const fileEl = ref<HTMLInputElement | null>(null)
async function onAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return void MessagePlugin.error(t('team.settings.basic.avatarType'))
  saving.avatar = true
  try {
    const up = unwrap(await filesApi.upload(file))
    if (await patch({ avatar: up.url })) MessagePlugin.success(t('common.saved'))
  } catch (err) {
    page.fail(err, t('common.uploadFailed'))
  } finally {
    saving.avatar = false
  }
}
async function setAvatar(url: string) {
  saving.avatar = true
  if (await patch({ avatar: url })) MessagePlugin.success(t('common.saved'))
  saving.avatar = false
}

// ---- 时区 ----
const FALLBACK_ZONES = [
  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Asia/Bangkok', 'Asia/Kolkata', 'Asia/Dubai',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Johannesburg',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
  'Australia/Sydney', 'Pacific/Auckland',
]
function offsetOf(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')
    return (part?.value || 'GMT').replace('GMT', 'UTC')
  } catch {
    return ''
  }
}
const zoneLabel = (zone: string) => {
  const off = offsetOf(zone)
  return off && off !== zone ? `${zone} (${off === 'UTC' ? 'UTC+0' : off})` : zone
}
const zoneOptions = computed(() => {
  let list: string[] = []
  try { list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') || [] } catch { /* 老浏览器 */ }
  if (!list.length) list = FALLBACK_ZONES
  const all = new Set(['UTC', ...list])
  if (team.value?.timezone) all.add(team.value.timezone)
  return [...all].map((z) => ({ value: z, label: zoneLabel(z) }))
})
async function setZone(zone: string) {
  if (!zone || zone === team.value?.timezone) return
  saving.zone = true
  if (await patch({ timezone: zone })) {
    MessagePlugin.success(t('common.saved'))
    void loadLimits()
  }
  saving.zone = false
}

// ---- 默认权限：一拨就存，存不上就拨回去 ----
const VISIBILITIES: CanvasVisibility[] = ['private', 'team_view', 'team_edit']
const SHARERS: TeamSettings['publicShare'][] = ['editors', 'managers']
const pending = reactive<Partial<TeamSettings>>({})
const view = computed<TeamSettings>(() => ({ ...(team.value?.settings as TeamSettings), ...pending }))
async function setSetting<K extends keyof TeamSettings>(key: K, value: TeamSettings[K]) {
  if (!canSettings.value || key in pending || view.value[key] === value) return
  ;(pending as TeamSettings)[key] = value
  await patch({ settings: { [key]: value } })
  // 成功了详情里已经是新值；失败了这一删就是拨回去
  delete pending[key]
}

// ---- 额度 ----
const limits = ref<TeamLimits | null>(null)
const limitsError = ref('')
const form = reactive({ teamRuns: '', teamAmount: '', defRuns: '', defAmount: '', currency: 'CNY' })
type LimitField = 'teamRuns' | 'teamAmount' | 'defRuns' | 'defAmount'
const bad = ref<LimitField | ''>('')
const limitsFormError = ref('')

function savedForm(l: TeamLimits) {
  return {
    teamRuns: limitText(l.team?.runs.limit), teamAmount: limitText(l.team?.amount.limit),
    defRuns: limitText(l.memberDefault?.runs), defAmount: limitText(l.memberDefault?.amount),
    currency: l.currency || 'CNY',
  }
}
function resetLimitsForm() {
  if (limits.value) Object.assign(form, savedForm(limits.value))
  bad.value = ''
  limitsFormError.value = ''
}
const limitsDirty = computed(() => {
  if (!limits.value) return false
  const s = savedForm(limits.value)
  return (Object.keys(s) as (keyof typeof s)[]).some((k) => form[k].trim() !== s[k])
})
async function loadLimits() {
  if (!canLimits.value) return
  limitsError.value = ''
  try {
    limits.value = unwrap(await teamApi.limits(page.teamId))
    resetLimitsForm()
  } catch (err) {
    limitsError.value = page.explain(err, t('common.loadFailed'))
  }
}
onMounted(loadLimits)
watch(canLimits, (v) => { if (v && !limits.value) void loadLimits() })

const CURRENCIES = ['CNY', 'USD', 'EUR', 'HKD', 'JPY', 'GBP']
const currencyOptions = computed(() => [...new Set([...CURRENCIES, form.currency, limits.value?.currency || 'CNY'])].map((c) => ({ value: c, label: c })))

const usedNote = computed(() => {
  const l = limits.value
  if (!l?.team) return ''
  // 和团队首页、用量页同一句话：已用 = 已成功 + 进行中。集成方关了成本显示（features.cost）时只说次数
  if (!embed.features.cost) return t('team.settings.limits.usedRuns', { counted: countedText(l.team.breakdown) })
  const base = t('team.settings.limits.used', { counted: countedText(l.team.breakdown), amount: t('cost.approx', { amount: formatMoney(l.team.amount.used, l.currency) }) })
  return l.team.uncounted ? base + t('team.settings.limits.usedUncounted', { n: l.team.uncounted }) : base
})
/** 有没有人受金额上限约束、没价格的模型现在意味着什么：都是服务端给的 */
const amountLimited = computed(() => (limits.value?.unpriced?.moneyLimited || 'none') !== 'none')
const unpricedEffect = computed(() => limits.value?.unpriced?.effect || 'none')
const uncountableNames = computed(() => (limits.value?.uncountable || []).map((m) => m.label || m.id).join(t('team.listSep')))

async function saveLimits() {
  if (saving.limits || !limits.value) return
  bad.value = ''
  limitsFormError.value = ''
  const read = (k: LimitField, integer: boolean) => {
    const v = parseLimitText(form[k], integer)
    if (v === undefined && !bad.value) {
      bad.value = k
      limitsFormError.value = t('team.limitInput.bad.' + (integer ? 'runs' : 'amount'))
    }
    return v ?? null
  }
  const body = {
    team: { runs: read('teamRuns', true), amount: read('teamAmount', false) },
    memberDefault: { runs: read('defRuns', true), amount: read('defAmount', false) },
    currency: form.currency,
  }
  if (bad.value) return
  saving.limits = true
  try {
    limits.value = unwrap(await teamApi.updateLimits(page.teamId, body))
    resetLimitsForm()
    MessagePlugin.success(t('common.saved'))
    void page.reload()
  } catch (err) {
    limitsFormError.value = page.explain(err)
  } finally {
    saving.limits = false
  }
}

const blockPending = ref<boolean | null>(null)
const blockView = computed(() => blockPending.value ?? !!limits.value?.blockUnpriced)
async function setBlock(v: boolean) {
  if (saving.block) return
  saving.block = true
  blockPending.value = v
  try {
    const next = unwrap(await teamApi.updateLimits(page.teamId, { blockUnpriced: v }))
    // 只换这一项和算不进去的模型清单，别把没保存的数字冲掉
    if (limits.value) limits.value = { ...limits.value, blockUnpriced: next.blockUnpriced, uncountable: next.uncountable, unpriced: next.unpriced }
    void page.reload()
    void space.refresh()
  } catch (err) {
    page.fail(err)
  } finally {
    blockPending.value = null
    saving.block = false
  }
}

// ---- 转让、解散、退出 ----
const dialog = ref<'' | 'transfer' | 'dissolve' | 'leave'>('')
const busy = ref(false)
const dialogError = ref('')
const candidates = ref<TeamMember[] | null>(null)
const heir = ref('')
const heirOptions = computed(() => (candidates.value || []).map((m) => ({
  value: m.id, label: `${m.name} · @${m.username}`, desc: t('spaces.role.' + m.role),
})))

function closeDialog() {
  if (!busy.value) dialog.value = ''
}
async function loadCandidates() {
  candidates.value = null
  try {
    const me = team.value?.me.id
    // 账号停用的人接不了团长
    candidates.value = unwrap(await teamApi.members(page.teamId)).members.filter((m) => m.id !== me && !m.disabled)
    if (!candidates.value.some((m) => m.id === heir.value)) heir.value = ''
  } catch (err) {
    candidates.value = []
    dialogError.value = page.explain(err, t('common.loadFailed'))
  }
}
function openTransfer() {
  heir.value = ''
  dialogError.value = ''
  dialog.value = 'transfer'
  void loadCandidates()
}
function openDissolve() {
  dialogError.value = ''
  dialog.value = 'dissolve'
}

async function transfer(typed: string) {
  if (!heir.value || busy.value) return
  const to = candidates.value?.find((m) => m.id === heir.value)
  busy.value = true
  dialogError.value = ''
  try {
    await teamApi.transfer(page.teamId, heir.value, typed)
    // 自己现在是管理员了：重取权限，这一页跟着变成管理员看到的样子
    await space.refresh()
    await page.reload()
    dialog.value = ''
    MessagePlugin.success(t('team.transfer.done', { name: to?.name || '' }))
  } catch (err) {
    dialogError.value = page.explain(err)
    // 对方刚被移出、或账号刚被停用：候选名单过时了
    if (['team.member_not_found', 'team.new_owner_unusable'].includes(apiErrorCode(err))) void loadCandidates()
  } finally {
    busy.value = false
  }
}

/**
 * 解散确认里那句「去哪恢复、过期删什么」：素材库、模型管理（Key）、空间切换器里有一项被集成方关了，
 * 就换成不点名的那一句——不提这次挂载里没有的东西。
 */
const dissolveGeneric = computed(() => !embed.features.assetLibrary || !embed.features.modelManagement || !space.canSwitch)

async function dissolve(typed: string) {
  if (busy.value) return
  const name = team.value?.name || ''
  busy.value = true
  dialogError.value = ''
  try {
    await teamApi.dissolve(page.teamId, typed)
  } catch (err) {
    dialogError.value = page.explain(err)
    busy.value = false
    return
  }
  MessagePlugin.success(t(space.canSwitch ? 'team.dissolve.done' : 'team.dissolve.doneGeneric', { name }))
  await toPersonalSpace(router, space)
}
</script>

<style scoped>
.st { display: grid; gap: 20px; max-width: 920px; min-width: 0; }
.st-card { min-width: 0; overflow: hidden; }
.st-card.danger { border-color: rgb(var(--c-err) / .4); }
.st-head { padding: 16px 20px; border-bottom: 1px solid var(--line); }
.st-head h2 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font: 600 15px/1.5 var(--f-disp); color: var(--text); }
.st-head p { margin-top: 4px; color: var(--text-3); font-size: 13px; line-height: 1.6; }
.st-row {
  display: flex; align-items: center; gap: 12px 24px; padding: 16px 20px; border-top: 1px solid var(--line); min-width: 0;
}
.st-head + .st-row, form > .st-row:first-child { border-top: 0; }
.st-k { flex: 1 1 240px; min-width: 0; display: grid; gap: 2px; }
.st-k > span, .st-k > label { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; font-weight: 500; color: var(--text); cursor: default; }
.st-k > small { color: var(--text-3); font-size: 13px; line-height: 1.6; }
.st-k > small.st-used { color: var(--text-2); }
.st-v { flex: 0 1 auto; display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; min-width: 0; max-width: 100%; }
.st-name { width: 320px; max-width: 100%; }
.st-zone { width: 300px; max-width: 100%; }
.st-cur { width: 132px; }
.st-ro { color: var(--text-2); font-size: 13px; }
.st-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.lc-seg > button:disabled { cursor: not-allowed; opacity: .55; }
.lc-seg > button.on:disabled { opacity: 1; }
.st-save {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 20px; border-top: 1px solid var(--line);
  background: rgb(var(--c-warn) / .06);
}
.st-save > p { flex: 1 1 200px; min-width: 0; margin: 0; }
.st-unsaved { display: flex; align-items: center; gap: 8px; color: var(--warn); font-size: 13px; }
.st-unsaved i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.st-warn { padding: 0 20px 20px; }
.st-state { padding: 20px; }
.st-state .lc-btn { margin-top: 10px; }
.st-sk { display: grid; gap: 14px; padding: 20px; }
.st-sk i { display: block; height: 14px; border-radius: 6px; background: rgb(var(--c-film) / .1); animation: lc-pulse 1.6s ease-in-out infinite; }
.st-sk i:nth-child(1) { width: 46%; } .st-sk i:nth-child(2) { width: 72%; } .st-sk i:nth-child(3) { width: 58%; }
.st-dp { color: var(--text-2); line-height: 1.7; }
.st-dp + .st-dp { margin-top: 10px; }
.st-heir { margin: 16px 0 0; }

@media (max-width: 720px) {
  .st-row { flex-wrap: wrap; padding: 14px 16px; }
  .st-k { flex-basis: 100%; }
  .st-v { justify-content: flex-start; flex: 1 1 100%; }
  .st-head, .st-save { padding-left: 16px; padding-right: 16px; }
  .st-warn { padding: 0 16px 16px; }
  .st-name, .st-zone { width: 100%; }
  .st-v:has(.st-name) { flex-wrap: nowrap; }
  .st-row.sw { flex-wrap: nowrap; align-items: flex-start; }
  .st-row.sw .st-k { flex: 1 1 auto; }
  .st-row.sw .st-v { flex: none; padding-top: 2px; }
}
</style>
