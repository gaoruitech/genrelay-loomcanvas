<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @click.self="emit('close')">
      <form v-dialog="() => emit('close')" class="lc-dialog jc" role="dialog" aria-modal="true" :aria-label="t('spaces.joinByCode.title')" @submit.prevent="go">
        <div class="lc-dialog-head">
          <span>{{ t('spaces.joinByCode.title') }}</span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </div>
        <div class="lc-dialog-body">
          <div class="lc-field jc-last">
            <label :for="uid">{{ t('spaces.joinByCode.label') }}</label>
            <input :id="uid" ref="inputEl" v-model="text" class="lc-input lc-mono" :class="{ 'is-err': !!error }" autocomplete="off" spellcheck="false" :placeholder="t('spaces.joinByCode.placeholder')" @input="error = ''" />
            <p v-if="error" class="lc-help err" role="alert">{{ error }}</p>
            <p v-else class="lc-help">{{ t('spaces.joinByCode.hint') }}</p>
          </div>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary" type="submit">{{ t('spaces.joinByCode.next') }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/** 「用邀请码加入」：粘贴整条邀请链接或最后那一段邀请码，带去加入页（在那儿才真正加入） */
import { vDialog } from '@/directives/dialog'
import { nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { inviteTokenOf } from './format'

const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()
const router = useRouter()
const uid = `jc-${Math.random().toString(36).slice(2, 8)}`
const text = ref('')
const error = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

onMounted(async () => { await nextTick(); inputEl.value?.focus() })

async function go() {
  const token = inviteTokenOf(text.value)
  if (!token) { error.value = t('spaces.joinByCode.invalid'); inputEl.value?.focus(); return }
  emit('close')
  await router.push({ name: 'join', params: { token } })
}
</script>

<style scoped>
.jc { width: 460px; }
.jc-last { margin-bottom: 0; }
</style>
