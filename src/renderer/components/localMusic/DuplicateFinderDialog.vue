<script setup lang="ts">
/**
 * 本地音乐重复文件清理。
 *
 * 扫描只读，不会动文件；点「移到回收站」才真正删除，且走系统回收站，
 * 用户后悔还能捞回来。
 *
 * 默认勾选每组里「建议保留」之外的所有副本——建议保留的规则是
 * 无损格式优先、其次体积大的那个。
 */
import { computed, ref, watch } from 'vue';
import Dialog from '@/components/ui/Dialog.vue';
import Button from '@/components/ui/Button.vue';
import { useToastStore } from '@/stores/toast';
import type { DuplicateGroup } from '../../../shared/localMusic';

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'removed'): void;
}>();

const toast = useToastStore();

const scanning = ref(false);
const removing = ref(false);
const groups = ref<DuplicateGroup[]>([]);
/** 被勾选要删除的路径。 */
const selected = ref<Set<string>>(new Set());
const scanned = ref(false);

const formatSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

/** 选中项合计可释放的空间。 */
const reclaimBytes = computed(() => {
  let total = 0;
  for (const group of groups.value) {
    for (const file of group.files) {
      if (selected.value.has(file.path)) total += file.size;
    }
  }
  return total;
});

const selectedCount = computed(() => selected.value.size);

/** 默认勾选：每组里保留 keepPath，其余勾上。 */
function resetSelection() {
  const next = new Set<string>();
  for (const group of groups.value) {
    for (const file of group.files) {
      if (file.path !== group.keepPath) next.add(file.path);
    }
  }
  selected.value = next;
}

function toggle(path: string) {
  const next = new Set(selected.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selected.value = next;
}

/** 打开时扫描一次；关掉再打开会重新扫。 */
watch(
  () => props.open,
  async (open) => {
    if (!open || scanning.value) return;
    scanning.value = true;
    scanned.value = false;
    groups.value = [];
    selected.value = new Set();
    try {
      groups.value = await window.electron.localMusic.findDuplicates();
      resetSelection();
    } catch (error) {
      toast.danger((error as Error).message || '扫描失败');
    } finally {
      scanning.value = false;
      scanned.value = true;
    }
  },
);

async function removeSelected() {
  if (removing.value || selected.value.size === 0) return;
  removing.value = true;
  try {
    const result = await window.electron.localMusic.removeDuplicates([...selected.value]);
    if (result.removed > 0) {
      toast.success(
        `已移入回收站 ${result.removed} 个文件，释放 ${formatSize(reclaimBytes.value)}`,
      );
      emit('removed');
      emit('update:open', false);
    }
    if (result.failed > 0) {
      toast.danger(`有 ${result.failed} 个文件删除失败`);
    }
  } catch (error) {
    toast.danger((error as Error).message || '删除失败');
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <Dialog
    :open="open"
    title="清理重复歌曲"
    description="扫描只读，不会动你的文件；确认后移入系统回收站，可以再捞回来"
    content-class="duplicate-dialog"
    @update:open="emit('update:open', $event)"
  >
    <div class="dup-body">
      <div v-if="scanning" class="dup-state">正在扫描曲库…</div>

      <div v-else-if="scanned && groups.length === 0" class="dup-state">
        <div class="dup-state-title">没有发现重复歌曲</div>
        <div class="dup-state-hint">曲库很干净，不用清理</div>
      </div>

      <template v-else>
        <div class="dup-summary">
          发现 <b>{{ groups.length }}</b> 组重复，涉及
          <b>{{ groups.reduce((sum, group) => sum + group.files.length, 0) }}</b> 个文件
        </div>

        <div class="dup-list">
          <div v-for="group in groups" :key="group.files[0]?.path" class="dup-group">
            <div class="dup-group-head">
              <span class="dup-group-title">{{ group.label }}</span>
              <span class="dup-badge" :class="group.reason">
                {{ group.reason === 'identical' ? '完全相同' : '同曲不同版本' }}
              </span>
            </div>
            <div
              v-for="file in group.files"
              :key="file.path"
              class="dup-file"
              :class="{ kept: file.path === group.keepPath }"
            >
              <input
                type="checkbox"
                :checked="selected.has(file.path)"
                @change="toggle(file.path)"
              />
              <div class="dup-file-main">
                <div class="dup-file-name">
                  {{ file.name }}
                  <span v-if="file.path === group.keepPath" class="dup-keep-tag">建议保留</span>
                </div>
                <div class="dup-file-path">{{ file.path }}</div>
              </div>
              <div class="dup-file-meta">
                <span class="dup-ext">{{ file.extension.toUpperCase() }}</span>
                <span>{{ formatSize(file.size) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="dup-footer">
          <div class="dup-stat">
            已选 {{ selectedCount }} 个 · 可释放 <b>{{ formatSize(reclaimBytes) }}</b>
          </div>
          <div class="dup-actions">
            <Button
              variant="unstyled"
              size="none"
              class="dup-btn"
              @click="emit('update:open', false)"
            >
              取消
            </Button>
            <Button
              variant="unstyled"
              size="none"
              class="dup-btn dup-btn-danger"
              :disabled="removing || selectedCount === 0"
              @click="removeSelected"
            >
              {{ removing ? '处理中…' : '移到回收站' }}
            </Button>
          </div>
        </div>
      </template>
    </div>
  </Dialog>
</template>

<style scoped>
@reference "@/style.css";

.dup-body {
  width: 100%;
  color: var(--text-main);
}
.dup-state {
  padding: 40px 8px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}
.dup-state-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
}
.dup-state-hint {
  margin-top: 6px;
  font-size: 12px;
}
.dup-summary {
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}
.dup-summary b {
  color: var(--text-main);
}
.dup-list {
  max-height: 52vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}
.dup-group {
  border: 1px solid var(--content-panel-border);
  border-radius: 10px;
  overflow: hidden;
}
.dup-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--content-panel-bg);
}
.dup-group-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dup-badge {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
}
.dup-badge.identical {
  color: var(--state-danger, #c2410c);
  background: color-mix(in srgb, var(--state-danger, #c2410c) 12%, transparent);
}
.dup-badge.same-track {
  color: var(--text-secondary);
  background: var(--content-panel-bg);
}
.dup-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-top: 1px solid var(--content-panel-border);
}
.dup-file.kept {
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
}
.dup-file input {
  flex-shrink: 0;
  accent-color: var(--color-primary);
}
.dup-file-main {
  flex: 1;
  min-width: 0;
}
.dup-file-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dup-keep-tag {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}
.dup-file-path {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.dup-file-meta {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}
.dup-ext {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--content-panel-bg);
  font-weight: 600;
}
.dup-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}
.dup-stat {
  font-size: 12px;
  color: var(--text-secondary);
}
.dup-stat b {
  color: var(--text-main);
}
.dup-actions {
  display: flex;
  gap: 8px;
}
.dup-btn {
  padding: 7px 16px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid var(--content-panel-border);
  background: color-mix(in srgb, var(--surface-card-base) 60%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
}
.dup-btn:hover {
  color: var(--text-main);
}
.dup-btn-danger {
  color: #fff;
  border-color: transparent;
  background: var(--state-danger, #c2410c);
}
.dup-btn-danger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
