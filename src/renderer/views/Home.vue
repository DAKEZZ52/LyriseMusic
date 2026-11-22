<script setup lang="ts">
defineOptions({ name: 'home' });
import { computed, onMounted, onUnmounted, ref } from 'vue';
// 问候语停用后不再使用（保留导入，需要时和模板一起取消注释）
// import SleepPig from '@/components/SleepPig.vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { useSettingStore } from '@/stores/setting';
import { getPlaylistByCategory, getTopIP, getRankTop, getRankSongs } from '@/api/playlist';
import { getEverydayStyleRecommend, getEverydayRecommend, getNewSongs } from '@/api/music';
import PlaylistCard from '@/components/music/PlaylistCard.vue';
import SongCard from '@/components/music/SongCard.vue';
import VirtualGrid from '@/components/ui/VirtualGrid.vue';
import { mapPlaylistMeta, mapRankMeta, mapTopSong } from '@/utils/mappers';
import { mapRankSong } from '@/utils/mappers/song';
import { extractList } from '@/utils/extractors';
import type { PlaylistMeta } from '@/models/playlist';
import type { RankMeta } from '@/models/rank';
import type { Song } from '@/models/song';
import {
  iconChevronLeft,
  iconChevronRight,
  iconMicrophone,
  iconMusic,
  iconPlay,
  iconScissors,
  iconSlidersHorizontal,
} from '@/icons';
import Button from '@/components/ui/Button.vue';
import UserAgreementDialog from '@/components/app/UserAgreementDialog.vue';
import PageScrollContainer from '@/components/ui/PageScrollContainer.vue';
import { usePlaylistStore, type SetPlaybackQueueOptions } from '@/stores/playlist';
import { usePlayerStore } from '@/stores/player';
import { playSongInContext, replaceQueueAndPlay } from '@/utils/playback';
import { isPlayableSong } from '@/utils/song';
import { useToastStore } from '@/stores/toast';
import { isRecord } from '../../shared/object';

interface RecommendSectionState {
  loading: boolean;
  error: string;
}

interface PlaylistCardProps {
  id: string | number;
  name: string;
  coverUrl: string;
  creator?: string;
  songCount?: number;
}

interface StyleRecommendTag {
  id: string;
  name: string;
  default?: boolean;
}

interface StyleRecommendGroup {
  name: string;
  child: StyleRecommendTag[];
}

const RECOMMEND_PLAYLIST_CATEGORIES = [
  { id: '0', label: '推荐' },
  { id: '11292', label: 'Hi-Res' },
  // 原本是独立的「编辑精选」区块，并进这里当一个分类，少一个重复网格
  { id: 'editor', label: '编辑精选' },
] as const;
const HOME_GRID_VIRTUAL_THRESHOLD = 12;
const HOME_GRID_OVERSCAN = 1;
const HOME_PLAYLIST_COVER_SIZE = 240;

const router = useRouter();

const userStore = useUserStore();
const settingStore = useSettingStore();
const playlistStore = usePlaylistStore();
const playerStore = usePlayerStore();
const toastStore = useToastStore();
const showUserAgreement = ref(false);

/* 问候语暂时停用（保留实现，需要时取消注释即可）
const greeting = computed(() => {
  const hour = new Date().getHours();
  const base =
    hour < 6
      ? '凌晨好'
      : hour < 9
        ? '早上好'
        : hour < 12
          ? '上午好'
          : hour < 14
            ? '中午好'
            : hour < 18
              ? '下午好'
              : '晚上好';
  const nickname = userStore.info?.nickname;
  return userStore.isLoggedIn && nickname ? `Hi, ${nickname} ${base}` : base;
});
*/

const recommendedPlaylists = ref<PlaylistMeta[]>([]);
const topIpPlaylists = ref<PlaylistMeta[]>([]);
const styleSongs = ref<Song[]>([]);
const styleGroups = ref<StyleRecommendGroup[]>([]);
const selectedStyleTagIds = ref<Set<string>>(new Set());
const activeStyleGroupName = ref('');
const activeRecommendCategoryId = ref<(typeof RECOMMEND_PLAYLIST_CATEGORIES)[number]['id']>('0');

const recommendState = ref<RecommendSectionState>({ loading: true, error: '' });
const topIpState = ref<RecommendSectionState>({ loading: true, error: '' });
const styleState = ref<RecommendSectionState>({ loading: true, error: '' });

const extractPlaylistList = (payload: unknown): unknown[] => extractList(payload);
const extractIpList = (payload: unknown): unknown[] => extractList(payload);

let recommendRequestId = 0;

const loadRecommendPlaylists = async () => {
  const requestId = ++recommendRequestId;
  const categoryId = activeRecommendCategoryId.value;
  recommendState.value = { loading: true, error: '' };
  try {
    const res = await getPlaylistByCategory(categoryId, 0, 1);
    if (requestId !== recommendRequestId) return;
    recommendedPlaylists.value = extractPlaylistList(res).map((item) => mapPlaylistMeta(item));
  } catch {
    if (requestId === recommendRequestId) {
      recommendState.value = { loading: false, error: '推荐歌单加载失败' };
    }
    return;
  }
  if (requestId === recommendRequestId) {
    recommendState.value = { loading: false, error: '' };
  }
};

const loadTopIp = async () => {
  topIpState.value = { loading: true, error: '' };
  try {
    const res = await getTopIP();
    topIpPlaylists.value = extractIpList(res)
      .filter((item) => typeof item === 'object' && item !== null)
      .filter((item) => {
        const record = item as Record<string, unknown>;
        const extra = record.extra as Record<string, unknown> | undefined;
        const globalId = extra?.global_collection_id ?? extra?.global_special_id;
        return record.type === 1 && Boolean(globalId);
      })
      .map((item) => mapPlaylistMeta(item));
  } catch {
    topIpState.value = { loading: false, error: '编辑精选加载失败' };
    return;
  }
  topIpState.value = { loading: false, error: '' };
};

const readStyleRecommendData = (payload: unknown) => {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.data)) return payload.data;
  return payload;
};

const extractStyleGroups = (payload: unknown): StyleRecommendGroup[] => {
  const data = readStyleRecommendData(payload);
  const rawGroups = Array.isArray(data?.tag_info) ? data.tag_info : [];
  return rawGroups
    .filter((group): group is Record<string, unknown> => isRecord(group))
    .map((group) => {
      const children = Array.isArray(group.child) ? group.child : [];
      return {
        name: typeof group.name === 'string' ? group.name : '',
        child: children
          .filter((tag): tag is Record<string, unknown> => isRecord(tag))
          .map((tag) => ({
            id: typeof tag.id === 'string' ? tag.id : String(tag.id ?? ''),
            name: typeof tag.name === 'string' ? tag.name : '',
            default: Number(tag.default ?? 0) === 1,
          }))
          .filter((tag) => tag.id && tag.name),
      };
    })
    .filter((group) => group.name && group.child.length > 0);
};

let styleRequestId = 0;

const getDefaultStyleTagIds = (groups: StyleRecommendGroup[]) =>
  groups.flatMap((group) => group.child.filter((tag) => tag.default).map((tag) => tag.id));

const syncStyleGroupsFromResponse = (payload: unknown) => {
  const nextGroups = extractStyleGroups(payload);
  if (nextGroups.length === 0) return;

  const hadGroups = styleGroups.value.length > 0;
  styleGroups.value = nextGroups;

  if (!styleGroups.value.some((group) => group.name === activeStyleGroupName.value)) {
    activeStyleGroupName.value = styleGroups.value[0]?.name ?? '';
  }

  if (!hadGroups && selectedStyleTagIds.value.size === 0) {
    const defaultIds = getDefaultStyleTagIds(nextGroups);
    selectedStyleTagIds.value = new Set(defaultIds);
  }
};

const loadStyleRecommend = async (options: { useSelectedTags?: boolean } = {}) => {
  const requestId = ++styleRequestId;
  const tagids = options.useSelectedTags ? Array.from(selectedStyleTagIds.value).join(',') : '';
  styleState.value = { loading: true, error: '' };
  try {
    const res = await getEverydayStyleRecommend({ tagids });
    if (requestId !== styleRequestId) return;
    syncStyleGroupsFromResponse(res);
    styleSongs.value = extractList(res).map((item) => mapTopSong(item));
  } catch {
    if (requestId === styleRequestId) {
      styleSongs.value = [];
      styleState.value = { loading: false, error: '风格推荐加载失败' };
    }
    return;
  }
  if (requestId === styleRequestId) {
    styleState.value = { loading: false, error: '' };
  }
};

const openRankingPage = () => {
  router.push({ name: 'ranking' });
};

/** 每日推荐歌曲：首页几处都要用，单独存一份。 */
const dailySongs = ref<Song[]>([]);

const fetchDailySongs = async () => {
  try {
    const res = await getEverydayRecommend();
    dailySongs.value = extractList(res).map((item) => mapTopSong(item));
  } catch {
    dailySongs.value = [];
  }
};

/** 榜单列表：首页卡片里只列前几个名字，点进去看完整榜。 */
const ranks = ref<RankMeta[]>([]);

/** 排行榜预览：每个榜带前三首，首页直接能看到榜单内容。 */
interface RankPreview {
  rank: RankMeta;
  songs: Song[];
}
const rankPreviews = ref<RankPreview[]>([]);

const fetchRanks = async () => {
  try {
    const res = await getRankTop();
    const list = extractList(res)
      .map((item) => mapRankMeta(item))
      .filter((item) => item.id !== 0)
      .slice(0, 3);
    ranks.value = list;

    // 三个榜并发拉前三首，任何一个失败都只影响自己那一列
    rankPreviews.value = await Promise.all(
      list.map(async (rank) => {
        try {
          const payload = await getRankSongs(rank.id, 1, 3);
          return {
            rank,
            songs: extractList(payload)
              .map((item) => mapRankSong(item))
              .slice(0, 3),
          };
        } catch {
          return { rank, songs: [] };
        }
      }),
    );
  } catch {
    ranks.value = [];
    rankPreviews.value = [];
  }
};

const openRank = (rank: RankMeta) => {
  router.push({ name: 'ranking', query: { rank: String(rank.id) } });
};

/** 最新音乐：新歌列表 + 新碟，媒体库缺少「新」这个维度。 */
const newSongs = ref<Song[]>([]);

const fetchNewSongs = async () => {
  try {
    const res = await getNewSongs();
    newSongs.value = extractList(res)
      .map((item) => mapTopSong(item))
      .slice(0, 30);
  } catch {
    newSongs.value = [];
  }
};

/** 最新音乐横滑：左右按钮按容器宽度翻页。 */
const newListRef = ref<HTMLElement | null>(null);
const scrollNew = (direction: number) => {
  const el = newListRef.value;
  if (!el) return;
  el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
};

/** 面板底部三个功能入口。 */
const openFeature = (name: 'score' | 'chatroom-list' | 'separator') => {
  router.push({ name });
};

const playNewSong = (song: Song) => {
  const index = Math.max(
    0,
    newSongs.value.findIndex((item) => String(item.id) === String(song.id)),
  );
  void replaceQueueAndPlay(playlistStore, playerStore, newSongs.value, index, song, {
    type: 'search',
  });
};

/** 每日推荐大卡上的「播放全部」。 */
const todayLabel = new Date().getDate().toString();
const playAllDaily = () => {
  const first = dailySongs.value[0];
  if (!first) return;
  void replaceQueueAndPlay(playlistStore, playerStore, dailySongs.value, 0, first, {
    type: 'daily-recommend',
  });
};

/** 点榜单里的一首歌：以该榜前三首为队列播放。 */
const playRankSong = (song: Song, list: Song[]) => {
  if (!list.length) return;
  const index = Math.max(
    0,
    list.findIndex((item) => String(item.id) === String(song.id)),
  );
  void replaceQueueAndPlay(playlistStore, playerStore, list, index, song, { type: 'ranking' });
};

/**
 * 顶部轮播：拿推荐歌单的前几个当大图，和 QQ音乐/网易云的首页 banner 一致。
 * 5 秒自动切换，鼠标移上去暂停，点圆点可手动跳。
 */
const bannerIndex = ref(0);
const bannerPaused = ref(false);
const bannerItems = computed(() => recommendedPlaylists.value.slice(0, 5));

const setBanner = (index: number) => {
  if (bannerItems.value.length === 0) return;
  bannerIndex.value = index % bannerItems.value.length;
};

const openBannerPlaylist = (entry: PlaylistMeta) => {
  const id = resolvePlaylistRouteId(entry);
  if (id !== undefined && id !== null && id !== '') {
    router.push({ name: 'playlist-detail', params: { id: String(id) } });
  }
};

let bannerTimer: ReturnType<typeof setInterval> | null = null;
const startBannerTimer = () => {
  if (bannerTimer) clearInterval(bannerTimer);
  bannerTimer = setInterval(() => {
    if (bannerPaused.value || bannerItems.value.length < 2) return;
    bannerIndex.value = (bannerIndex.value + 1) % bannerItems.value.length;
  }, 5000);
};

onMounted(() => {
  void fetchDailySongs();
  void fetchRanks();
  void fetchNewSongs();
  startBannerTimer();
});
onUnmounted(() => {
  if (bannerTimer) clearInterval(bannerTimer);
});

const resolvePlaylistRouteId = (entry: PlaylistMeta) =>
  entry.listCreateGid || entry.globalCollectionId || entry.listCreateListid || entry.id;

const getPlaylistCardProps = (entry: PlaylistMeta): PlaylistCardProps => {
  return {
    id: resolvePlaylistRouteId(entry),
    name: entry.name,
    coverUrl: entry.pic,
    creator: entry.nickname,
    songCount: entry.count,
  };
};

const recommendedPlaylistCards = computed(() =>
  recommendedPlaylists.value.map((entry) => getPlaylistCardProps(entry)),
);

const topIpPlaylistCards = computed(() =>
  topIpPlaylists.value.map((entry) => getPlaylistCardProps(entry)),
);

/** 当前分类下要显示的歌单卡；「编辑精选」用的是另一批数据。 */
const visiblePlaylistCards = computed(() =>
  activeRecommendCategoryId.value === 'editor'
    ? topIpPlaylistCards.value
    : recommendedPlaylistCards.value,
);

const switchRecommendCategory = (
  categoryId: (typeof RECOMMEND_PLAYLIST_CATEGORIES)[number]['id'],
) => {
  if (activeRecommendCategoryId.value === categoryId) return;
  activeRecommendCategoryId.value = categoryId;
  // 编辑精选的数据单独加载过，不需要再请求推荐歌单
  if (categoryId !== 'editor') void loadRecommendPlaylists();
};

const activeStyleGroup = computed(
  () =>
    styleGroups.value.find((group) => group.name === activeStyleGroupName.value) ??
    styleGroups.value[0],
);

const selectedStyleLabels = computed(() => {
  const selected = selectedStyleTagIds.value;
  return styleGroups.value
    .flatMap((group) => group.child)
    .filter((tag) => selected.has(tag.id))
    .map((tag) => tag.name);
});

const styleSummary = computed(() =>
  selectedStyleLabels.value.length > 0 ? selectedStyleLabels.value.join(' / ') : '默认推荐',
);

const styleQueueOptions = computed<SetPlaybackQueueOptions>(() => {
  const tagKey = Array.from(selectedStyleTagIds.value).join('-') || 'default';
  return {
    queueId: `queue:home:style-recommend:${tagKey}`,
    title: '风格推荐',
    subtitle: styleSummary.value,
    coverUrl: styleSongs.value[0]?.coverUrl,
    type: 'style-recommend',
    dynamic: false,
    meta: {
      tagids: Array.from(selectedStyleTagIds.value).join(','),
    },
  };
});

const activeSongId = computed(() => playerStore.currentTrackId ?? undefined);

const toggleStyleTag = (tag: StyleRecommendTag) => {
  const next = new Set(selectedStyleTagIds.value);
  if (next.has(tag.id)) {
    next.delete(tag.id);
  } else {
    next.add(tag.id);
  }
  selectedStyleTagIds.value = next;
  void loadStyleRecommend({ useSelectedTags: true });
};

const playStyleSongs = async (targetSong?: Song) => {
  const queueSongs = styleSongs.value.slice();
  if (queueSongs.length === 0) return false;
  return replaceQueueAndPlay(
    playlistStore,
    playerStore,
    queueSongs,
    0,
    targetSong,
    styleQueueOptions.value,
  );
};

const handleStyleSongCoverPlay = async (song: Song) => {
  if (!song || !isPlayableSong(song)) {
    toastStore.unavailable('当前歌曲');
    return;
  }

  try {
    const played =
      settingStore.playbackQueueMode === 'context'
        ? await replaceQueueAndPlay(
            playlistStore,
            playerStore,
            styleSongs.value,
            0,
            song,
            styleQueueOptions.value,
          )
        : await playSongInContext(
            playlistStore,
            playerStore,
            song,
            styleSongs.value,
            0,
            styleQueueOptions.value,
          );
    if (!played) toastStore.unavailable('当前歌曲');
  } catch {
    toastStore.actionFailed('播放');
  }
};

const handleStyleSongDoubleTapPlay = async (song: Song) => {
  await playStyleSongs(song);
};

onMounted(() => {
  showUserAgreement.value = !settingStore.userAgreementAccepted;
  if (userStore.isLoggedIn) {
    void userStore.fetchUserInfoOnce();
  }
  void loadStyleRecommend();
  void loadRecommendPlaylists();
  void loadTopIp();
});

const handleAcceptAgreement = () => {
  settingStore.acceptUserAgreement();
};

const handleRejectAgreement = () => {
  window.electron.ipcRenderer.send('quit-app', null);
};
</script>

<template>
  <PageScrollContainer class="home-view-container">
    <div class="home-view px-10 pt-4 pb-10">
      <!-- 问候语暂时停用（保留结构，需要时取消注释即可）
      <div class="home-header">
        <div class="text-[22px] font-semibold tracking-tight text-text-main">{{ greeting }}</div>
        <div ref="greetingSubtitleRef" class="text-[12px] text-text-secondary/80 mt-1">
          由此开启好心情 ~
          <SleepPig />
        </div>
      </div>
      -->

      <!-- 顶部轮播 + 猜你喜欢：左右对半 -->
      <div class="hero-split">
        <div
          class="home-banner"
          @mouseenter="bannerPaused = true"
          @mouseleave="bannerPaused = false"
        >
          <div v-if="bannerItems.length === 0" class="banner-placeholder">
            <span>正在准备推荐…</span>
          </div>
          <template v-else>
            <button
              v-for="(item, index) in bannerItems"
              :key="item.id"
              type="button"
              class="banner-slide"
              :class="{ active: index === bannerIndex }"
              @click="openBannerPlaylist(item)"
            >
              <!-- 背景用同一张图放大模糊，前景放完整封面：封面是方的，硬裁成横幅会只剩一条脸 -->
              <div
                v-if="item.pic"
                class="banner-backdrop"
                :style="{ backgroundImage: `url(${item.pic})` }"
              />
              <!-- 封面必须放在 content 外面，否则 absolute 会相对底部通栏定位，只铺下半截 -->
              <img v-if="item.pic" :src="item.pic" class="banner-cover" alt="" />
              <div class="banner-content">
                <div class="banner-info">
                  <div class="banner-title">{{ item.name }}</div>
                  <div class="banner-sub">
                    <span v-if="item.nickname">{{ item.nickname }}</span>
                    <span v-if="item.count"> · {{ item.count }} 首</span>
                  </div>
                </div>
              </div>
            </button>
            <div class="banner-dots">
              <button
                v-for="(item, index) in bannerItems"
                :key="`dot-${item.id}`"
                type="button"
                class="banner-dot"
                :class="{ active: index === bannerIndex }"
                :aria-label="`第 ${index + 1} 张`"
                @click.stop="setBanner(index)"
              />
            </div>
          </template>
        </div>

        <!-- 右半边：每日推荐为主，最新音乐为辅 -->
        <section v-if="dailySongs.length > 0 || newSongs.length > 0" class="new-panel">
          <!-- 每日推荐放最上，做大 -->
          <div v-if="dailySongs.length > 0" class="daily-inline">
            <div class="daily-badge">
              <span class="daily-day">{{ todayLabel }}</span>
              <span class="daily-month">日</span>
            </div>
            <div class="daily-inline-main">
              <div class="daily-title">每日推荐</div>
              <div class="daily-sub">根据你的口味，今天为你准备了 {{ dailySongs.length }} 首</div>
            </div>
            <button type="button" class="daily-play" @click="playAllDaily">
              <Icon :icon="iconPlay" width="15" height="15" />
              <span>播放全部</span>
            </button>
          </div>

          <!-- 最新音乐缩成辅栏 -->
          <template v-if="newSongs.length > 0">
            <div class="section-header new-panel-head">
              <div class="section-title">最新音乐</div>
            </div>
            <div class="new-scroll">
              <ul ref="newListRef" class="new-list">
                <li v-for="song in newSongs" :key="song.id">
                  <button
                    type="button"
                    class="new-item"
                    :class="{ 'is-active': activeSongId === String(song.id) }"
                    @click="playNewSong(song)"
                  >
                    <img v-if="song.coverUrl" class="new-item-cover" :src="song.coverUrl" alt="" />
                    <span class="new-item-main">
                      <span class="new-item-name">{{ song.title }}</span>
                      <span class="new-item-artist">{{ song.artist || '未知歌手' }}</span>
                    </span>
                    <span v-if="activeSongId === String(song.id)" class="new-item-wave">
                      <i />
                      <i />
                      <i />
                    </span>
                  </button>
                </li>
              </ul>
              <button
                type="button"
                class="new-nav new-nav-prev"
                aria-label="往前翻"
                @click="scrollNew(-1)"
              >
                <Icon :icon="iconChevronLeft" width="16" height="16" />
              </button>
              <button
                type="button"
                class="new-nav new-nav-next"
                aria-label="往后翻"
                @click="scrollNew(1)"
              >
                <Icon :icon="iconChevronRight" width="16" height="16" />
              </button>
            </div>
          </template>

          <!-- 功能入口：简谱 / 语聊房 / 人声分离 -->
          <div class="feature-row">
            <button type="button" class="feature-item" @click="openFeature('score')">
              <Icon :icon="iconMusic" width="15" height="15" />
              <span>简谱</span>
            </button>
            <button type="button" class="feature-item" @click="openFeature('chatroom-list')">
              <Icon :icon="iconMicrophone" width="15" height="15" />
              <span>语聊房</span>
            </button>
            <button type="button" class="feature-item" @click="openFeature('separator')">
              <Icon :icon="iconScissors" width="15" height="15" />
              <span>人声分离</span>
            </button>
          </div>
        </section>
      </div>

      <!-- 每日推荐已经并进右侧「最新音乐」面板 -->

      <section class="home-section style-recommend-section">
        <div class="section-header">
          <div>
            <div class="section-title">风格推荐</div>
          </div>
        </div>

        <div class="style-recommend-panel">
          <div class="style-category-row">
            <div class="style-panel-label">
              <Icon :icon="iconSlidersHorizontal" width="14" height="14" />
              <span>{{ styleSummary }}</span>
            </div>
            <div class="style-category-tabs">
              <Button
                v-for="group in styleGroups"
                :key="group.name"
                variant="unstyled"
                size="none"
                class="style-category-btn"
                :class="{ active: activeStyleGroupName === group.name }"
                @click="activeStyleGroupName = group.name"
              >
                {{ group.name }}
              </Button>
            </div>
            <!-- 播放全部挪到这一行最右，和分类切换同排 -->
            <div class="style-section-actions">
              <Button
                variant="unstyled"
                size="none"
                class="style-play-btn"
                :disabled="styleSongs.length === 0"
                @click="playStyleSongs()"
              >
                <Icon :icon="iconPlay" width="14" height="14" />
                <span>播放全部</span>
              </Button>
            </div>
          </div>

          <div class="style-tag-row">
            <Button
              v-for="tag in activeStyleGroup?.child ?? []"
              :key="tag.id"
              variant="unstyled"
              size="none"
              class="style-tag-btn"
              :class="{ active: selectedStyleTagIds.has(tag.id) }"
              @click="toggleStyleTag(tag)"
            >
              {{ tag.name }}
            </Button>
          </div>

          <div v-if="!styleState.loading && styleState.error" class="style-song-placeholder">
            {{ styleState.error }}
          </div>
          <div
            v-else-if="!styleState.loading && styleSongs.length === 0"
            class="style-song-placeholder"
          >
            暂无风格推荐
          </div>
          <VirtualGrid
            v-else
            class="style-song-grid"
            :items="styleSongs"
            :loading="styleState.loading"
            :itemMinWidth="240"
            :itemHeight="62"
            :gap="10"
            :overscan="HOME_GRID_OVERSCAN"
            :virtualThreshold="18"
            loadingVariant="compact"
            keyField="id"
          >
            <template #default="{ item: song }">
              <SongCard
                :song="song"
                :active="activeSongId === String(song.id)"
                :queueContext="styleSongs"
                :queueOptions="styleQueueOptions"
                :showAlbum="false"
                :showDuration="false"
                :showMore="false"
                :showCoverPlayButton="true"
                :enableDefaultDoubleTapPlay="true"
                :onDoubleTapPlay="
                  settingStore.playbackQueueMode === 'context'
                    ? handleStyleSongDoubleTapPlay
                    : undefined
                "
                :onCoverPlay="handleStyleSongCoverPlay"
              />
            </template>
          </VirtualGrid>
        </div>
      </section>

      <section v-if="rankPreviews && rankPreviews.length > 0" class="home-section">
        <div class="section-header">
          <div class="section-title">排行榜</div>
          <button type="button" class="section-more" @click="openRankingPage">更多</button>
        </div>
        <div class="rank-grid">
          <div v-for="preview in rankPreviews" :key="preview.rank.id" class="rank-col">
            <button type="button" class="rank-head" @click="openRank(preview.rank)">
              <img v-if="preview.rank.pic" class="rank-pic" :src="preview.rank.pic" alt="" />
              <span class="rank-head-main">
                <span class="rank-name">{{ preview.rank.name }}</span>
                <span class="rank-update">
                  {{ preview.rank.updateFrequency || '实时更新' }}
                </span>
              </span>
              <span class="rank-arrow">›</span>
            </button>
            <ol class="rank-songs">
              <li v-for="(song, index) in preview.songs || []" :key="song.id">
                <button type="button" class="rank-song" @click="playRankSong(song, preview.songs)">
                  <span class="rank-index" :class="{ 'rank-index-top': index === 0 }">
                    {{ index + 1 }}
                  </span>
                  <img v-if="song.coverUrl" class="rank-song-cover" :src="song.coverUrl" alt="" />
                  <span class="rank-song-main">
                    <span class="rank-song-name">{{ song.title }}</span>
                    <span class="rank-song-artist">{{ song.artist || '未知歌手' }}</span>
                  </span>
                </button>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <section class="home-section">
        <div class="section-header">
          <div class="section-title">推荐歌单</div>
          <div class="playlist-source-tabs">
            <Button
              v-for="category in RECOMMEND_PLAYLIST_CATEGORIES"
              :key="category.id"
              variant="unstyled"
              size="none"
              class="playlist-source-btn"
              :class="{ active: activeRecommendCategoryId === category.id }"
              @click="switchRecommendCategory(category.id)"
            >
              {{ category.label }}
            </Button>
          </div>
        </div>
        <div v-if="!recommendState.loading && recommendState.error" class="section-placeholder">
          {{ recommendState.error }}
        </div>
        <VirtualGrid
          v-else
          class="playlist-grid"
          :items="visiblePlaylistCards"
          :loading="recommendState.loading"
          :itemMinWidth="180"
          :itemAspectRatio="1"
          :itemChromeHeight="66"
          :gap="20"
          :overscan="HOME_GRID_OVERSCAN"
          :virtualThreshold="HOME_GRID_VIRTUAL_THRESHOLD"
          keyField="id"
        >
          <template #default="{ item }">
            <PlaylistCard v-bind="item" :coverSize="HOME_PLAYLIST_COVER_SIZE" layout="grid" />
          </template>
        </VirtualGrid>
      </section>
    </div>

    <UserAgreementDialog
      v-model:open="showUserAgreement"
      @accept="handleAcceptAgreement"
      @reject="handleRejectAgreement"
    />
  </PageScrollContainer>
</template>

<style scoped>
@reference "@/style.css";

.home-header {
  margin-bottom: 28px;
}

/* Hero Banner */
.hero-row {
  /* 轮播占主区，右侧 240px 放两个快捷卡片 */
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 16px;
  margin-bottom: 28px;
  align-items: stretch;
}
@media (max-width: 1100px) {
  .hero-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .hero-shortcuts {
    flex-direction: row;
  }
}

/* ── 顶部轮播 ── */
.home-banner {
  position: relative;
  width: 100%;
  /* 接近方形：封面按原比例铺满，不再被裁成扁长方形 */
  aspect-ratio: 1.15 / 1;
  border-radius: 20px;
  overflow: hidden;
  margin-bottom: 18px;
  background: var(--content-panel-bg);
  border: 1px solid var(--content-panel-border);
}
@media (max-width: 900px) {
  .home-banner {
    aspect-ratio: 1 / 1;
  }
}
.banner-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 13px;
  color: var(--text-secondary);
}
.banner-slide {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.6s ease,
    visibility 0.6s ease;
  cursor: pointer;
}
.banner-slide.active {
  opacity: 1;
  visibility: visible;
}
.banner-backdrop {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  /* 放大一点再模糊，避免边缘露出底色 */
  transform: scale(1.2);
  filter: blur(38px) saturate(1.4);
}
.banner-content {
  /* 底部通栏：横跨整个轮播宽度，压在渐变遮罩上 */
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 56px 24px 18px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.72) 0%,
    rgba(0, 0, 0, 0.3) 55%,
    transparent 100%
  );
}
.banner-cover {
  /* 封面铺满整个轮播；方形图会被裁掉左右，但画面是满的 */
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}
.banner-info {
  /* 右侧留出圆点指示器的位置，避免文字压到它 */
  padding-right: 96px;
  text-align: left;
}
.banner-title {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  color: #fff;
  /* 标题过长自动换行，不再被省略号截断 */
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.banner-sub {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.78);
  overflow-wrap: anywhere;
}

.banner-dots {
  position: absolute;
  right: 20px;
  bottom: 16px;
  display: flex;
  gap: 6px;
}
.banner-dot {
  width: 7px;
  height: 7px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition:
    width 0.2s ease,
    background-color 0.2s ease;
}
.banner-dot.active {
  width: 18px;
  border-radius: 4px;
  background: #fff;
}

/* ── 快捷入口四宫格 ── */
/* ── 每日推荐大卡 ── */
/* ── 每日推荐：面板主块 ── */
.daily-inline {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 16px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--content-panel-border);
}
.daily-badge {
  flex-shrink: 0;
  width: 56px;
  height: 60px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, #ff8a3d, #f4511e);
}
.daily-inline-main {
  flex: 1;
  min-width: 0;
}
.daily-day {
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
}
.daily-month {
  margin-top: 2px;
  font-size: 10px;
  opacity: 0.9;
}
.daily-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-main);
}
.daily-sub {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-secondary);
}
.daily-play {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 16px;
  border: 0;
  border-radius: 18px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-on-primary, #fff);
  background: var(--color-primary);
  cursor: pointer;
}
.daily-play:hover {
  opacity: 0.9;
}
/* ── 排行榜：三个榜各带前三首 ── */
.rank-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 1000px) {
  .rank-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.rank-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 14px 16px 10px;
  border-radius: 16px;
  border: 1px solid var(--content-panel-border);
  background: var(--content-panel-bg);
}
.rank-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0 0 10px;
  margin-bottom: 4px;
  border: 0;
  border-bottom: 1px solid var(--content-panel-border);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.rank-pic {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--content-selected-bg);
}
.rank-head-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.rank-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rank-head:hover .rank-name {
  color: var(--color-primary);
}
.rank-update {
  font-size: 10px;
  color: var(--text-secondary);
}
.rank-arrow {
  flex-shrink: 0;
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1;
}
.rank-songs {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rank-song {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.rank-index {
  width: 14px;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  text-align: center;
}
.rank-index-top {
  color: var(--color-primary);
}
.rank-song-cover {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--content-selected-bg);
}
.rank-song-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.rank-song-name {
  font-size: 12px;
  color: var(--text-main);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: color 0.15s ease;
}
.rank-song:hover .rank-song-name {
  color: var(--color-primary);
}
.rank-song-artist {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.section-more {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.section-more:hover {
  color: var(--color-primary);
}

/* 轮播右侧的快捷入口 */
.hero-shortcuts {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.hero-short-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-radius: 18px;
  background: var(--content-panel-bg);
  border: 1px solid var(--content-panel-border);
  cursor: pointer;
  transition: background-color 0.18s ease;
}
.hero-short-card:hover {
  background: var(--content-selected-bg);
}
.hero-short-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 16px;
  flex-shrink: 0;
}
.hero-short-primary {
  background: linear-gradient(135deg, #ff6b6b, #ee5a24);
}
.hero-short-secondary {
  background: linear-gradient(135deg, #4facfe, #0071e3);
}
.hero-short-meta {
  min-width: 0;
  text-align: left;
}
.hero-short-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
}
.hero-short-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.home-feature-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.home-feature-card {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 72px;
  padding: 0 18px;
  border-radius: 16px;
  background: var(--content-panel-bg);
  border: 1px solid var(--content-panel-border);
  transition: all 0.2s ease;
}

.home-feature-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-card);
}

.feature-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.12);
}

.gradient-primary {
  background: linear-gradient(
    135deg,
    var(--color-primary),
    color-mix(in srgb, var(--color-primary) 70%, transparent)
  );
}

.gradient-secondary {
  background: linear-gradient(135deg, var(--color-secondary), rgba(90, 200, 250, 0.7));
}

.feature-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.feature-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-main);
}

.feature-sub {
  font-size: 12px;
  font-weight: 500;
  color: color-mix(in srgb, var(--color-text-main) 60%, transparent);
}

.feature-action {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary-text);
}

.home-section {
  margin-top: 36px;
}

/* ── 轮播 + 猜你喜欢：左右对半 ── */
.hero-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  margin-bottom: 28px;
  align-items: stretch;
}
@media (max-width: 900px) {
  .hero-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.hero-split .home-banner {
  margin-bottom: 0;
  height: 100%;
}
.new-panel-head {
  margin-bottom: 10px;
}
.new-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px 18px 10px;
  border-radius: 18px;
  border: 1px solid var(--content-panel-border);
  background: var(--content-panel-bg);
}
.new-panel .section-title {
  font-size: 12px;
  color: var(--text-secondary);
}
/* 横滑容器：按钮浮在两侧，只有悬停时出现 */
.new-scroll {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}
.new-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--content-panel-border);
  border-radius: 50%;
  background: var(--content-panel-bg);
  color: var(--text-main);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s ease;
  z-index: 2;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.new-nav-prev {
  left: -6px;
}
.new-nav-next {
  right: -6px;
}
.new-scroll:hover .new-nav {
  opacity: 1;
}
.new-nav:hover {
  background: var(--content-selected-bg);
}

.new-list {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 0;
  padding: 2px 2px 8px;
  list-style: none;
  /* 横向滑动，纵向不滚 */
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
}
.new-list li {
  flex: 0 0 auto;
}
.new-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 110px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease;
}
.new-item:hover {
  transform: translateY(-2px);
}
.new-item.is-active .new-item-cover {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.new-item.is-active .new-item-name {
  color: var(--color-primary);
  font-weight: 600;
}

/* 选中时的三根跳动条 */
.new-item-wave {
  position: absolute;
  right: 7px;
  bottom: 7px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 13px;
  padding: 2px 4px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.new-item-wave i {
  width: 2.5px;
  border-radius: 2px;
  background: var(--color-primary);
  animation: new-wave 0.9s ease-in-out infinite;
}
.new-item-wave i:nth-child(1) {
  height: 60%;
  animation-delay: -0.2s;
}
.new-item-wave i:nth-child(2) {
  height: 100%;
  animation-delay: -0.5s;
}
.new-item-wave i:nth-child(3) {
  height: 45%;
}
@keyframes new-wave {
  0%,
  100% {
    transform: scaleY(0.45);
  }
  50% {
    transform: scaleY(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .new-item-wave i {
    animation: none;
    transform: scaleY(0.8);
  }
}
.new-item-cover {
  width: 110px;
  height: 110px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--content-selected-bg);
  transition: outline-color 0.18s ease;
}
.new-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  width: 100%;
}
.new-item-name {
  font-size: 12px;
  color: var(--text-main);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: color 0.15s ease;
}
.new-item:hover .new-item-name {
  color: var(--color-primary);
}
/* ── 面板底部功能入口 ── */
.feature-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--content-panel-border);
}
.feature-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 0;
  border: 1px solid var(--content-panel-border);
  border-radius: 10px;
  background: transparent;
  font-size: 12px;
  color: var(--text-main);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}
.feature-item:hover {
  background: var(--content-selected-bg);
  color: var(--color-primary);
}

.new-item-artist {
  font-size: 10px;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-main);
}

.playlist-source-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--control-muted-bg);
}

.playlist-source-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.playlist-source-btn:hover {
  color: var(--color-text-main);
  background: var(--control-hover-bg);
}

.playlist-source-btn.active {
  color: var(--color-text-main);
  background: var(--content-selected-bg);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

.section-placeholder {
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: color-mix(in srgb, var(--color-text-main) 60%, transparent);
}

.style-recommend-section {
  margin-top: 30px;
}

.style-section-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.style-play-btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary-text);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  font-size: 12px;
  font-weight: 700;
}

.style-play-btn:hover {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.style-recommend-panel {
  border: 1px solid var(--content-panel-border);
  border-radius: 14px;
  background: var(--content-panel-bg);
  padding: 14px;
}

.style-category-row {
  display: flex;
  align-items: center;
  /* 三块并排：标签 / 分类 / 播放全部，靠 margin-left:auto 把按钮顶到最右 */
  gap: 16px;
}
.style-section-actions {
  margin-left: auto;
  flex-shrink: 0;
}

.style-panel-label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.style-panel-label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.style-category-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--control-muted-bg);
}

.style-category-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.style-category-btn:hover {
  color: var(--color-text-main);
  background: var(--control-hover-bg);
}

.style-category-btn.active {
  color: var(--color-text-main);
  background: var(--content-selected-bg);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

.style-tag-row {
  margin-top: 12px;
  display: flex;
  /* 标签全部换行展示：原来横向滚动但隐藏了滚动条，末几个看着像被裁掉 */
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.style-tag-row::-webkit-scrollbar {
  display: none;
}

.style-tag-btn {
  height: 32px;
  flex-shrink: 0;
  border-radius: 10px;
  padding: 0 12px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-secondary);
  border-color: var(--content-panel-border);
  background: var(--control-muted-bg);
}

.style-tag-btn:hover {
  color: var(--color-text-main);
  border-color: var(--control-border-hover);
  background: var(--control-hover-bg);
}

.style-tag-btn.active {
  color: var(--color-primary-text);
  border-color: var(--color-primary);
  background: var(--control-active-bg);
}

.style-song-placeholder {
  height: 156px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 12px;
}

.style-song-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 8px 12px;
}

.style-song-grid :deep(.song-card) {
  min-width: 0;
  background: color-mix(in srgb, var(--color-text-main) 3%, transparent);
}

.style-song-grid :deep(.song-card:hover) {
  background: var(--row-hover-bg);
}

@media (max-width: 820px) {
  .style-category-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .style-category-tabs {
    width: 100%;
    overflow-x: auto;
  }
}
</style>
