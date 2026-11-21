<script setup lang="ts">
/**
 * 本地音乐标签编辑弹窗。
 *
 * 单首：完整编辑歌名/歌手/专辑/年份/曲目/风格，可换封面。
 * 多首：只显示歌手、专辑、年份三项——填了才改，留空表示保持各自原值。
 *
 * 「从文件名推断」按常见命名习惯解析，只回填到输入框，用户确认后才会写盘。
 */
import { computed, ref, watch } from 'vue';
import Dialog from '@/components/ui/Dialog.vue';
import Button from '@/components/ui/Button.vue';
import { useToastStore } from '@/stores/toast';
import type { LocalTagSnapshot, LocalTagUpdate } from '../../../shared/localMusic';

const props = defineProps<{
  open: boolean;
  filePaths: string[];
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'saved'): void;
}>();

const toast = useToastStore();

const loading = ref(false);
const saving = ref(false);
const errorMsg = ref('');
const snapshots = ref<LocalTagSnapshot[]>([]);

/** 表单值。批量模式下只有 artist / album / year 有意义。 */
const form = ref({ title: '', artist: '', album: '', year: '', track: '', genre: '' });
const coverPath = ref<string | null>(null);
const clearCover = ref(false);

const isBatch = computed(() => props.filePaths.length > 1);
const total = computed(() => props.filePaths.length);
const firstSnapshot = computed(() => snapshots.value[0] ?? null);

/** 当前预览的封面：优先新选的本地图，其次原内嵌封面。 */
const coverPreview = computed(() => {
  if (clearCover.value) return '';
  if (coverPath.value) return `file://${coverPath.value.replace(/\\/g, '/')}`;
  return firstSnapshot.value?.coverDataUrl ?? '';
});

/** 文件名去掉目录与扩展名。 */
function baseNameOf(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  return name.replace(/\.[^.]+$/, '').trim();
}

/**
 * 从文件名推断标签，规则按常见命名习惯：
 *   `01 - 歌名 - 歌手`  → track / title / artist
 *   `01 - 歌手 - 歌名` 与 `歌手 - 歌名` 都按「首段歌手、次段歌名」处理
 *   `01 歌名`           → 去掉序号后整段作为歌名
 */
function inferFromFileName() {
  if (isBatch.value || props.filePaths.length === 0) return;
  let text = baseNameOf(props.filePaths[0]);
  let track = '';

  // 开头的音轨号：01 / 1. / 01_
  const trackMatch = /^(\d{1,3})[\s._-]+/.exec(text);
  if (trackMatch) {
    track = String(Number(trackMatch[1]));
    text = text.slice(trackMatch[0].length).trim();
  }

  const parts = text
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    form.value.title = parts[1];
    form.value.artist = parts[2];
    if (!form.value.album) form.value.album = '';
  } else if (parts.length === 2) {
    form.value.artist = parts[0];
    form.value.title = parts[1];
  } else if (parts.length === 1) {
    form.value.title = parts[0];
  }
  if (track) form.value.track = track;
  toast.success('已按文件名填入，确认后再保存');
}

/** 打开或切换目标时重新读快照。 */
watch(
  () => [props.open, props.filePaths] as const,
  async ([open, paths]) => {
    if (!open || !paths.length) return;
    loading.value = true;
    errorMsg.value = '';
    coverPath.value = null;
    clearCover.value = false;
    try {
      const result = await window.electron.localMusic.readTags([...paths]);
      snapshots.value = result.snapshots;
      if (result.errors.length) {
        errorMsg.value = `${result.errors.length} 个文件读取失败：${result.errors[0].error ?? ''}`;
      }
      const first = result.snapshots[0];
      form.value = isBatch.value
        ? { title: '', artist: '', album: '', year: '', track: '', genre: '' }
        : {
            title: first?.title ?? '',
            artist: first?.artist ?? '',
            album: first?.album ?? '',
            year: first?.year ? String(first.year) : '',
            track: first?.track ? String(first.track) : '',
            genre: first?.genre ?? '',
          };
    } catch (error) {
      errorMsg.value = (error as Error).message || '读取标签失败';
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

async function pickCover() {
  try {
    const picked = await window.electron.localMusic.pickCover();
    if (picked) {
      coverPath.value = picked;
      clearCover.value = false;
    }
  } catch (error) {
    toast.danger((error as Error).message || '选择封面失败');
  }
}

function resetCover() {
  coverPath.value = null;
  clearCover.value = true;
}

/** 构造单个文件的更新对象：批量模式下只带用户填了的字段。 */
function buildUpdate(filePath: string): LocalTagUpdate {
  const update: LocalTagUpdate = { filePath };
  const value = form.value;

  if (isBatch.value) {
    if (value.artist.trim()) update.artist = value.artist.trim();
    if (value.album.trim()) update.album = value.album.trim();
    const year = Number(value.year);
    if (value.year.trim() && Number.isFinite(year)) update.year = year;
  } else {
    update.title = value.title.trim();
    update.artist = value.artist.trim();
    update.album = value.album.trim();
    const year = Number(value.year);
    if (value.year.trim() && Number.isFinite(year)) update.year = year;
    const track = Number(value.track);
    if (value.track.trim() && Number.isFinite(track)) update.track = track;
    update.genre = value.genre.trim();
  }

  if (coverPath.value) update.coverPath = coverPath.value;
  if (clearCover.value) update.clearCover = true;
  return update;
}

async function save() {
  if (saving.value) return;
  if (
    isBatch.value &&
    !form.value.artist.trim() &&
    !form.value.album.trim() &&
    !form.value.year.trim() &&
    !coverPath.value &&
    !clearCover.value
  ) {
    toast.warning('批量编辑至少要填写一项，否则不会改动任何内容');
    return;
  }

  saving.value = true;
  try {
    const results = await window.electron.localMusic.writeTags(props.filePaths.map(buildUpdate));
    const ok = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);

    if (ok > 0) {
      toast.success(isBatch.value ? `已写入 ${ok} 个文件` : '标签已保存');
      emit('saved');
      emit('update:open', false);
    }
    if (failed.length) {
      errorMsg.value = `${failed.length} 个文件写入失败：${failed[0].error ?? ''}`;
      toast.danger(`有 ${failed.length} 个文件没能写入`);
    }
  } catch (error) {
    errorMsg.value = (error as Error).message || '保存失败';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    :open="open"
    :title="isBatch ? `批量编辑标签（${total} 首）` : '编辑标签'"
    :description="isBatch ? '只修改你填写的项，留空的保持各自原值' : '改完点保存才会写入文件'"
    content-class="tag-editor-dialog"
    @update:open="emit('update:open', $event)"
  >
    <div class="tag-editor">
      <div v-if="loading" class="tag-editor-loading">正在读取标签…</div>

      <template v-else>
        <div v-if="errorMsg" class="tag-editor-error">{{ errorMsg }}</div>

        <div class="tag-editor-body">
          <!-- 封面 -->
          <div class="tag-cover">
            <div class="tag-cover-frame">
              <img v-if="coverPreview" :src="coverPreview" alt="" />
              <div v-else class="tag-cover-empty">无封面</div>
            </div>
            <div class="tag-cover-actions">
              <Button variant="unstyled" size="none" class="tag-btn" @click="pickCover">
                {{ coverPath ? '重新选择' : '选择图片' }}
              </Button>
              <Button
                v-if="coverPreview"
                variant="unstyled"
                size="none"
                class="tag-btn"
                @click="resetCover"
              >
                移除封面
              </Button>
            </div>
            <p v-if="isBatch" class="tag-cover-hint">选中的封面会应用到全部 {{ total }} 个文件</p>
          </div>

          <!-- 字段 -->
          <div class="tag-fields">
            <label v-if="!isBatch" class="tag-field">
              <span class="tag-label">歌名</span>
              <input v-model="form.title" class="tag-input" type="text" />
            </label>
            <label class="tag-field">
              <span class="tag-label">歌手{{ isBatch ? '（留空不改）' : '' }}</span>
              <input v-model="form.artist" class="tag-input" type="text" />
            </label>
            <label class="tag-field">
              <span class="tag-label">专辑{{ isBatch ? '（留空不改）' : '' }}</span>
              <input v-model="form.album" class="tag-input" type="text" />
            </label>
            <div class="tag-row">
              <label class="tag-field tag-field-sm">
                <span class="tag-label">年份</span>
                <input v-model="form.year" class="tag-input" type="number" min="1900" max="2100" />
              </label>
              <label v-if="!isBatch" class="tag-field tag-field-sm">
                <span class="tag-label">曲目号</span>
                <input v-model="form.track" class="tag-input" type="number" min="1" />
              </label>
            </div>
            <label v-if="!isBatch" class="tag-field">
              <span class="tag-label">风格</span>
              <input v-model="form.genre" class="tag-input" type="text" />
            </label>
            <Button
              v-if="!isBatch"
              variant="unstyled"
              size="none"
              class="tag-btn tag-infer"
              @click="inferFromFileName"
            >
              从文件名推断
            </Button>
          </div>
        </div>

        <div class="tag-editor-footer">
          <Button
            variant="unstyled"
            size="none"
            class="tag-btn"
            @click="emit('update:open', false)"
          >
            取消
          </Button>
          <Button
            variant="unstyled"
            size="none"
            class="tag-btn tag-btn-primary"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? '保存中…' : '保存' }}
          </Button>
        </div>
      </template>
    </div>
  </Dialog>
</template>

<style scoped>
@reference "@/style.css";

.tag-editor {
  /* 外层 dialog-content 已经是 min(560px, 92vw)，这里撑满即可，别再写死宽度 */
  width: 100%;
  color: var(--text-main);
}
.tag-editor-loading {
  padding: 28px 8px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}
.tag-editor-error {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--state-danger, #c2410c);
  background: color-mix(in srgb, var(--state-danger, #c2410c) 12%, transparent);
}
.tag-editor-body {
  display: flex;
  gap: 18px;
}
.tag-cover {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.tag-cover-frame {
  width: 108px;
  height: 108px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--content-panel-bg);
  border: 1px solid var(--content-panel-border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tag-cover-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tag-cover-empty {
  font-size: 11px;
  color: var(--text-secondary);
}
.tag-cover-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tag-cover-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.tag-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tag-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tag-field-sm {
  flex: 1;
  min-width: 0;
}
.tag-row {
  display: flex;
  gap: 10px;
}
.tag-label {
  font-size: 11px;
  color: var(--text-secondary);
}
.tag-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-main);
  background: color-mix(in srgb, var(--surface-card-base) 60%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-main) 12%, transparent);
  border-radius: 8px;
  outline: none;
}
.tag-input:focus {
  border-color: var(--color-primary);
}
.tag-btn {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--surface-card-base) 60%, transparent);
  border: 1px solid var(--content-panel-border);
  border-radius: 8px;
  cursor: pointer;
}
.tag-btn:hover {
  color: var(--text-main);
}
.tag-infer {
  align-self: flex-start;
}
.tag-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.tag-btn-primary {
  color: var(--color-on-primary, #fff);
  background: var(--color-primary);
  border-color: transparent;
}
.tag-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
