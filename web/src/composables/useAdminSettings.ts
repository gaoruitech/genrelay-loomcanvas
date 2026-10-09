import { ref, type Ref } from 'vue'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { t } from '@/locales'
import type { AdminSettings } from '@/types'

/**
 * 设置页「限制」「外观」两个标签页共用的读写逻辑：
 * 读取 /api/admin/settings，编辑本地副本，只把本页关心的字段提交回去。
 */
export function useAdminSettings<K extends keyof AdminSettings>(keys: readonly K[], defaults: Pick<AdminSettings, K>) {
  const form = ref({ ...defaults }) as Ref<Pick<AdminSettings, K>>
  const loading = ref(true)
  const loadError = ref('')
  const saving = ref(false)

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
    } finally {
      saving.value = false
    }
  }

  return { form, loading, loadError, saving, load, save }
}
