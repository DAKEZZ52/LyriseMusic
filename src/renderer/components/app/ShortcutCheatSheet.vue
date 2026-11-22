<script setup lang="ts">
/**
 * 快捷键速查面板：按 `?` 弹出，列出所有可用快捷键。
 *
 * 数据复用设置页的 shortcutItems 与 useSettingsShortcuts，
 * 所以用户改过的键位会实时反映在这里，不会出现"设置改了但速查表还是默认值"。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Dialog from '@/components/ui/Dialog.vue';
import { useSettingStore } from '@/stores/setting';
import { shortcutItems } from '@/views/settings/constants';
import { useSettingsShortcuts } from '@/views/settings/composables/useSettingsShortcuts';

const settingStore = useSettingStore();
const { getShortcutValue } = useSettingsShortcuts();

const open = ref(false);

/** 全局快捷键没开启时那一列留空，避免让人以为可用。 */
const globalEnabled = computed(() => Boolean(settingStore.globalShortcutsEnabled));

const rows = computed(() =>
  shortcutItems.map((item) => ({
    command: item.command,
    title: item.title,
    desc: item.desc,
    local: getShortcutValue(item.command, 'local'),
    global: globalEnabled.value ? getShortcutValue(item.command, 'global') : '',
  })),
);

function onKeydown(event: KeyboardEvent) {
  // `?` 就是 Shift + /，浏览器给的 key 已经是 '?'
  if (event.key !== '?') return;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  open.value = !open.value;
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Dialog
    v-model:open="open"
    title="快捷键速查"
    description="按 ? 打开或关闭；键位可以在「设置 → 快捷键」里改"
    content-class="cheatsheet-dialog"
  >
    <div class="cheat">
      <div class="cheat-head">
        <span>功能</span>
        <span class="cheat-col">快捷键</span>
        <span v-if="globalEnabled" class="cheat-col">全局</span>
      </div>
      <div class="cheat-list">
        <div v-for="row in rows" :key="row.command" class="cheat-row">
          <div class="cheat-name">
            <div class="cheat-title">{{ row.title }}</div>
            <div class="cheat-desc">{{ row.desc }}</div>
          </div>
          <span class="cheat-key">{{ row.local || '未设置' }}</span>
          <span v-if="globalEnabled" class="cheat-key cheat-key-global">
            {{ row.global || '未设置' }}
          </span>
        </div>
      </div>
      <p class="cheat-tip">另外：输入 <b>?</b> 打开这张表，<b>Esc</b> 关闭任何弹窗。</p>
    </div>
  </Dialog>
</template>

<style scoped>
@reference "@/style.css";

.cheat {
  width: 100%;
  color: var(--text-main);
}
.cheat-head {
  display: grid;
  grid-template-columns: 1fr 96px 96px;
  gap: 8px;
  padding: 0 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--content-panel-border);
}
.cheat-col {
  text-align: center;
}
.cheat-list {
  max-height: 56vh;
  overflow-y: auto;
}
.cheat-row {
  display: grid;
  grid-template-columns: 1fr 96px 96px;
  gap: 8px;
  align-items: center;
  padding: 7px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--content-panel-border) 60%, transparent);
}
.cheat-row:last-child {
  border-bottom: 0;
}
.cheat-name {
  min-width: 0;
}
.cheat-title {
  font-size: 13px;
  font-weight: 600;
}
.cheat-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.cheat-key {
  justify-self: center;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text-main);
  background: var(--content-panel-bg);
  border: 1px solid var(--content-panel-border);
  white-space: nowrap;
}
.cheat-key-global {
  opacity: 0.85;
}
.cheat-tip {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}
.cheat-tip b {
  color: var(--text-main);
}
</style>
