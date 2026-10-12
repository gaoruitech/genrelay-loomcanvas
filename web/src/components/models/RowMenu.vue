<template>
  <span ref="root" class="rm">
    <button
      ref="btn"
      type="button"
      class="lc-tb sm"
      :class="{ on: open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="label"
      :title="label"
      :disabled="disabled"
      data-act="row-menu"
      @click="toggle"
      @keydown.esc.stop="close"
    ><LcIcon name="more" size="s" /></button>
    <Teleport to="body">
      <div v-if="open" ref="menuEl" class="lc-menu rm-menu" role="menu" :aria-label="label" :style="menuStyle" @keydown.esc.stop="close">
        <button
          v-for="it in items"
          :key="it.key"
          type="button"
          class="lc-menu-item rm-item"
          :class="{ danger: it.danger }"
          role="menuitem"
          :data-act="it.key"
          @click="pick(it.key)"
        >
          <LcIcon :name="it.icon" size="s" />{{ it.label }}
        </button>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
/** 模型行最右边的「更多」小菜单。弹层逻辑与 LcSelect 共用 useFloatingMenu，外观是全局的 .lc-menu */
import { ref } from 'vue'
import { useFloatingMenu } from '@/composables/useFloatingMenu'
import LcIcon from '@/components/LcIcon.vue'

export interface RowMenuItem { key: string; label: string; icon: string; danger?: boolean }

defineProps<{ items: RowMenuItem[]; label: string; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'pick', key: string): void }>()

const root = ref<HTMLElement | null>(null)
const btn = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLDivElement | null>(null)
const { open, menuStyle, close, toggle } = useFloatingMenu({ trigger: btn, menu: menuEl, root, gap: 4, closeOnScroll: true })

function pick(key: string) {
  close()
  emit('pick', key)
}
</script>

<style scoped>
.rm { display: inline-flex; }
.rm-menu { min-width: 168px; max-width: calc(100vw - 16px); }
.rm-item {
  width: 100%; gap: 8px; border: 0; background: none; font: inherit; font-size: 13px; text-align: left; white-space: nowrap;
}
.rm-item:focus-visible { outline: none; background: rgb(var(--c-film) / .12); color: var(--text); }
.rm-item.danger { color: var(--err-soft); }
.rm-item.danger:hover, .rm-item.danger:focus-visible { background: rgb(var(--c-err) / .12); color: var(--err-soft); }
</style>
