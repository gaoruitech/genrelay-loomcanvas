import { computed, ref, type Ref } from 'vue'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { t } from '@/locales'
import type { AdminSettings } from '@/types'

/**
 * 设置页「运行限制」「外观」两个分区共用的读写逻辑：
 * 读取 /api/admin/settings，编辑本地副本，只把本分区关心的字段提交回去。
 * dirty：本地副本和上次读到 / 存下的不一样；reset：把没保存的修改丢掉。
 */
export function useAdminSettings<K extends keyof AdminSettings>(keys: readonly K[], defaults: Pick<AdminSettings, K>) {
  const form = ref({ ...defaults }) as Ref<Pick<AdminSettings, K>>
  const loading = ref(true)
  const loadError = ref('')
  const saving = ref(false)
  const stored = ref(JSON.stringify(defaults))
  const dirty = computed(() => !loading.value && !loadError.value && JSON.stringify(form.value) !== stored.value)

  async function load() {
    loading.value = true
    loadError.value = ''
    try {
      const data = unwrap(await adminApi.settings()) || ({} as Partial<AdminSettings>)
      const next = { ...defaults }
      for (const k of keys) {
        const v = (data as Partial<AdminSettings>)[k]
        if (v !== undefined && v !== null) next[k] = v as AdminSettings[K]
      }
      form.value = next
      stored.value = JSON.stringify(next)
    } catch (err) {
      loadError.value = apiErrorMessage(err, t('common.loadFailed'))
    } finally {
      loading.value = false
    }
  }

  /** 失败时抛出，由调用方提示 */
  async function save(): Promise<void> {
    saving.value = true
    try {
      const body: Partial<AdminSettings> = {}
      for (const k of keys) body[k] = form.value[k]
      unwrap(await adminApi.updateSettings(body))
      stored.value = JSON.stringify(form.value)
    } finally {
      saving.value = false
    }
  }

  function reset() {
    form.value = JSON.parse(stored.value)
  }

  return { form, loading, loadError, saving, dirty, load, save, reset }
}
