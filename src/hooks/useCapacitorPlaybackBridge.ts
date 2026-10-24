import React from 'react';
import { registerPlugin } from '@capacitor/core';
import { isCapacitorAndroid } from '../platform/runtime';
import type { SongResult } from '../types';
import { getSongAlbumLabel, getSongArtistLabel, getSongCoverUrl } from '../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { fetchCoverBytes } from '../services/coverBytes';
import { nativePlaybackEngine } from '../services/playbackEngine/nativePlaybackEngine';
import { applyNativeLikeOverrides, type NativeLikeOverrideInput } from '../services/onlineMusic/omni';

// 当前文件：把播放状态与元数据送到原生前台服务，换取通知栏媒体控制与后台网络保活。

/**
 * 与 FoliaPlaybackService / MainActivity 里的常量一一对应，改一处必须两处都改。
 */
const ACTION_UPDATE_METADATA = 'top.izuna.foliamajor.action.UPDATE_METADATA';
const ACTION_UPDATE_STATE = 'top.izuna.foliamajor.action.UPDATE_STATE';
const ACTION_STOP_FOREGROUND = 'top.izuna.foliamajor.action.STOP_FOREGROUND';
const ACTION_WEB_COMMAND = 'top.izuna.foliamajor.action.WEB_COMMAND';
const EXTRA_COMMAND = 'command';

type PlaybackSnapshot = 'playing' | 'paused' | 'stopped';

interface FoliaPlaybackPlugin {
  /** 启动前台服务并更新媒体元数据。artworkBase64 传 null 表示这次没有新封面。 */
  update(options: {
    title?: string;
    artist?: string;
    album?: string;
    artworkBase64?: string | null;
    /** 封面地址。原生会自己下载，用来绕开 WebView 的 CORS 限制。 */
    artworkUrl?: string | null;
    durationMs?: number;
    /** 通知栏封面角标用哪颗图标（当前播放来源的平台，本地等自家人传 'folia'）。 */
    providerBadge?: string | null;
    /**
     * 当前这首歌的身份。
     *
     * 原生拿它跟上一首比：不一样就是换歌了，先把上一首的封面丢掉。没有它就分不清
     * 「这首歌没有封面」和「还没拿到封面」——后一种情况下旧封面会被一直挂着，
     * 通知栏于是先画出上一首的图，等原生按 URL 下载完才换成当前的。
     */
    songKey?: string | null;
    /**
     * 这首歌是不是「已喜欢」：通知栏那颗心画实心还是空心就看它。
     * 不传 = 这次不改（原生保留上一个值）。
     */
    liked?: boolean | null;
    /**
     * 「喜欢」这个动作现在能不能用。false 时通知栏干脆不画那颗心 —— 通知按钮没有置灰，
     * 画出来点了没反应比不画更让人困惑。不传 = 这次不改。
     */
    canLike?: boolean | null;
    /**
     * 红心的原生兜底：当前歌来自哪个平台、平台侧的歌曲 id。
     * WebView 冻结时通知栏那颗心按它直接对各平台补写收藏（kugou 等没有原生通道会跳过）。
     */
    providerId?: string | null;
    serverSongId?: string | null;
  }): Promise<void>;
  /** 更新播放状态。playing=true 时服务会真正进入前台。 */
  setState(options: {
    state: PlaybackSnapshot;
    positionMs?: number;
    speed?: number;
  }): Promise<void>;
  /** 停止播放时收掉前台服务与通知。 */
  stop(): Promise<void>;
  /**
   * 队列镜像快照：WebView 冻结后通知栏切歌的原生兜底数据源。
   * JS 活着时每次队列/当前歌变化都推一份（当前 ±10 首、带已解析地址的窗口），
   * index 是当前歌在窗口里的下标。原生只转存，冻结时才用它。
   */
  setQueueMirror(options: { queueJson: string; index: number }): Promise<void>;
  /**
   * 原生补写过的红心（WebView 冻结期间通知栏那颗心在服务器上写成功的）。
   * App 启动时取走一次，对齐进账号缓存，App 里的心才不会与通知栏打架。
   */
  consumeLikeOverrides(): Promise<{ overrides: NativeLikeOverrideInput[] }>;
  /** 原生在用户点击通知栏/锁屏/耳机按键时派发的事件。 */
  addListener(
    eventName: 'foliaPlaybackCommand',
    listener: (payload: { command: string; positionMs?: number; songKey?: string }) => void,
  ): Promise<() => void>;
}

const FoliaPlayback = registerPlugin<FoliaPlaybackPlugin>('FoliaPlayback');

// 通知栏封面：Base64 体积大，同一首歌只取一次。
const artworkCache = new Map<string, string>();
const ARTWORK_MAX_EDGE = 512;

/**
 * 把封面图片抓成 base64。
 *
 * 通知栏需要 Bitmap 而非 URL：通知由系统进程渲染，它无法访问 WebView 的
 * 缓存文件或带鉴权的资源。用 canvas 缩到 512px 再编码，避免大图撑爆 Binder 事务
 * （跨进程传输有 1MB 上限，传原始大图会 TransactionTooLargeException）。
 */
const loadArtworkAsBase64 = async (url: string): Promise<string | null> => {
  const cached = artworkCache.get(url);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  try {
    // 取字节这件事只有 services/coverBytes 那一处知道该怎么取：
    // 带凭据的那一跳会让「回通配符」的图床直接被浏览器判死，通知栏于是常年没有封面。
    const blob = await fetchCoverBytes(url);
    if (!blob) return null;
    if (typeof createImageBitmap !== 'function') return null;

    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, ARTWORK_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    // data URL 本身带前缀，原生侧会剥掉，这里原样传。
    artworkCache.set(url, dataUrl);
    // 只缓存最近的几张，避免长时间播放把内存吃满。
    if (artworkCache.size > 8) {
      const oldest = artworkCache.keys().next().value;
      if (oldest !== undefined) artworkCache.delete(oldest);
    }
    return dataUrl;
  } catch {
    // 封面拿不到不影响播放与通知，原生侧会退回默认图标。
    return null;
  }
};

/**
 * 通知栏进度条的位置刷新间隔。
 *
 * 系统按 PlaybackState 里的 position 自己往前推，但那只在速度恒定时准；
 * 缓冲、跳转、换源之后它会停在错的地方，所以这里定期校准一次。
 */
const POSITION_TICK_MS = 1000;

type UseCapacitorPlaybackBridgeOptions = {
  currentSong: SongResult | null;
  cachedCoverUrl: string | null;
  playerState: string;
  mediaSessionPlayRef: React.RefObject<() => Promise<void>>;
  mediaSessionPauseRef: React.RefObject<() => void>;
  mediaSessionPrevRef: React.RefObject<() => void>;
  mediaSessionNextRef: React.RefObject<() => Promise<void> | void>;
  /** 读当前播放时间（秒），用来让通知栏那条进度条真的往前走。 */
  getCurrentTime?: () => number;
  /** 用户拖动通知栏进度条后回传的目标位置（秒）。 */
  onSeek?: (seconds: number) => void;
  /** 当前这首歌是不是「已喜欢」：通知栏那颗心的形状跟它走。 */
  isLiked?: boolean;
  /** 「喜欢」现在能不能用；false 时通知栏不画那颗心。 */
  canLike?: boolean;
  /** 通知栏 / 锁屏 / 耳机那颗心被按下。与面板里的喜爱按钮同一个动作。 */
  onToggleLike?: () => void;
  /**
   * 原生兜底切歌后 JS 醒来的认领：把队列跳到原生正在放的那首（按 songKey 找）。
   * 不认领的话，App 打开时队列还停在旧歌上，与通知栏各说各话。
   */
  onSyncToSong?: (songKey: string) => void;
  /** 队列快照：镜像兜底的数据源。缺省时不推镜像。 */
  queue?: SongResult[];
  /** 当前这首歌已解析的播放地址（audioSrc）：镜像里当前条目就用它。 */
  currentAudioUrl?: string | null;
  /** 队列里其它条目的已解析地址（预取命中的才有）：没有的条目带空 url，原生会跳过。 */
  resolvedUrlOf?: (song: SongResult) => string | null;
};

/**
 * 把播放状态接到原生前台服务。
 *
 * 只在 Capacitor Android 下生效；Web 端与 Electron 继续用已有的
 * navigator.mediaSession 路径（见 useMediaSessionBridge）。
 */
export const useCapacitorPlaybackBridge = ({
  currentSong,
  cachedCoverUrl,
  playerState,
  mediaSessionPlayRef,
  mediaSessionPauseRef,
  mediaSessionPrevRef,
  mediaSessionNextRef,
  getCurrentTime,
  onSeek,
  isLiked = false,
  canLike = false,
  onToggleLike,
  queue,
  currentAudioUrl,
  resolvedUrlOf,
  onSyncToSong,
}: UseCapacitorPlaybackBridgeOptions): void => {
  const enabled = isCapacitorAndroid();

  // 这三个回调是每次渲染都可能换身份的内联函数，进 effect 依赖会把订阅反复重建。
  const callbacksRef = React.useRef({ getCurrentTime, onSeek, onToggleLike, onSyncToSong });
  callbacksRef.current = { getCurrentTime, onSeek, onToggleLike, onSyncToSong };

  // 原生补写的红心，App 这边开机认领：把账号缓存（likedSongIds）对齐到原生写入的
  // 服务器真状态。不认领的话，打开 App 那一刻 JS 推的还是旧缓存，通知栏那颗心会被
  // 它翻回去（原生侧有真源守卫拦着通知栏，但 App 里的心也对不上）。
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void FoliaPlayback.consumeLikeOverrides()
      .then(({ overrides }) => {
        if (cancelled || !overrides || overrides.length === 0) return;
        applyNativeLikeOverrides(overrides);
      })
      .catch(() => {
        // 老版本原生没有这个方法：没有记录就没有可对齐的，静默跳过。
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // 通知栏/锁屏/耳机的控制键走这里回到 Web 层。
  React.useEffect(() => {
    if (!enabled) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void FoliaPlayback.addListener('foliaPlaybackCommand', ({ command, positionMs, songKey }) => {
      switch (command) {
        case 'play':
          void mediaSessionPlayRef.current?.();
          break;
        case 'pause':
          mediaSessionPauseRef.current?.();
          break;
        case 'next':
          void mediaSessionNextRef.current?.();
          break;
        case 'previous':
          mediaSessionPrevRef.current?.();
          break;
        case 'stop':
          mediaSessionPauseRef.current?.();
          break;
        case 'seek':
          // 拖动通知栏进度条。原生只在 actions 里带了 ACTION_SEEK_TO 时才派发这个。
          callbacksRef.current.onSeek?.(Math.max(0, (positionMs ?? 0) / 1000));
          break;
        case 'like':
          // 通知栏 / 锁屏 / 耳机那颗心。与面板里的喜爱按钮走同一个 handleLike：
          // 能不能用、成功与否、状态怎么存都归 Web 层那一份判断，原生不自己记账。
          // 状态变了会随下一次元数据推送回到通知栏，那颗心自己换形状。
          callbacksRef.current.onToggleLike?.();
          break;
        case 'syncTo':
          // 原生兜底切歌后的认领：把队列跳到原生正在放的那首（守卫期间旧歌的
          // metadata 会被原生拒收，见 FoliaPlaybackService.updateMetadata）。
          if (songKey) callbacksRef.current.onSyncToSong?.(songKey);
          break;
      }
    }).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [enabled, mediaSessionPlayRef, mediaSessionPauseRef, mediaSessionPrevRef, mediaSessionNextRef]);

  // 元数据：切歌时更新一次。
  React.useEffect(() => {
    if (!enabled) return;
    if (!currentSong) {
      void FoliaPlayback.stop();
      return;
    }
    const coverUrl = cachedCoverUrl || getSongCoverUrl(currentSong) || '';
    const songKey = getPlaybackSongKey(currentSong);
    const likeIdentity = resolveLikeIdentity(currentSong);
    const metadata = {
      title: currentSong.name || '',
      artist: getSongArtistLabel(currentSong) || '',
      album: getSongAlbumLabel(currentSong) || '',
      // 封面地址一并给过去：WebView 里 fetch 远端封面常被 CORS 挡掉，
      // 原生下载没有这个限制，通知栏因此总能拿到对应的封面。
      artworkUrl: coverUrl || null,
      durationMs: getDurationMs(currentSong),
      providerBadge: resolveProviderBadge(currentSong),
      songKey,
      liked: isLiked,
      canLike,
      providerId: likeIdentity.providerId || null,
      serverSongId: likeIdentity.serverSongId || null,
    };

    // 分两次发：先不带封面发一次，让原生立刻换标题并把上一首的封面丢掉，再等封面抓到补一次。
    //
    // 合成一次（等 base64 拿到再发）的话，封面抓取的这一段时间里原生手上的还是上一首的图，
    // 通知栏就先画出上一首的封面，等下载线程跑完才换成当前歌 —— 看着就是封面慢了一拍。
    let cancelled = false;
    void (async () => {
      await FoliaPlayback.update({ ...metadata, artworkBase64: null });
      if (!coverUrl) return;
      const artworkBase64 = await loadArtworkAsBase64(coverUrl);
      // 抓封面期间可能已经切歌了，晚到的这张不能贴到新歌上。
      if (cancelled || !artworkBase64) return;
      await FoliaPlayback.update({ ...metadata, artworkBase64 });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, currentSong, cachedCoverUrl, isLiked, canLike]);

  // 队列镜像：WebView 冻结后通知栏切歌的唯一依据。JS 活着时每次队列/当前歌变化
  // 都把「当前 ±10 首、带已解析地址」的窗口推给原生；冻结时 onSkipToNext/Previous
  // 的确认计时器发现 JS 没回话，就从这份镜像里取相邻一首直接交给原生播放器。
  // resolvedUrlOf 是内联函数（每次渲染换身份），走 ref 不进依赖。
  const mirrorSourceRef = React.useRef({ queue, currentAudioUrl, resolvedUrlOf });
  mirrorSourceRef.current = { queue, currentAudioUrl, resolvedUrlOf };
  React.useEffect(() => {
    if (!enabled || !currentSong) return;
    const { queue: list, currentAudioUrl: activeUrl, resolvedUrlOf: urlOf } = mirrorSourceRef.current;
    if (!list || list.length === 0) return;
    const activeKey = getPlaybackSongKey(currentSong);
    const index = list.findIndex((song) => getPlaybackSongKey(song) === activeKey);
    if (index < 0) return;
    const windowStart = Math.max(0, index - 10);
    const windowList = list.slice(windowStart, Math.min(list.length, index + 11));
    const entries = windowList.map((song) => {
      const isCurrent = getPlaybackSongKey(song) === activeKey;
      const identity = resolveLikeIdentity(song);
      return {
        songKey: getPlaybackSongKey(song),
        title: song.name || '',
        artist: getSongArtistLabel(song) || '',
        album: getSongAlbumLabel(song) || '',
        artworkUrl: getSongCoverUrl(song) || '',
        url: (isCurrent ? activeUrl : urlOf?.(song)) ?? '',
        // 原生兜底切歌后，服务用这两样维持红心兜底的能力（网易 / QQ 才有）。
        providerId: identity.providerId,
        serverSongId: identity.serverSongId,
        // 红心状态只有「推镜像时正播着的那首」是确定的：镜像推完用户可能切走，
        // 其它歌在「我喜欢」里的状态这里拿不到，就不带，原生按未知处理（心先藏起来）。
        ...(isCurrent ? { liked: isLiked, canLike } : {}),
      };
    });
    void FoliaPlayback.setQueueMirror({ queueJson: JSON.stringify(entries), index: index - windowStart });
    // isLiked/canLike 进依赖：当前条目带的红心状态要跟着收藏变化重推，否则原生兜底
    // 切歌后拿到的 liked 是推送那一刻的旧值。
  }, [enabled, currentSong, queue, currentAudioUrl, isLiked, canLike]);

  // 播放状态：playing 时服务进入前台，这是后台网络不被节流的关键。
  //
  // 位置必须真的传过去。原先这里写死 positionMs: 0，通知栏那条进度条于是永远停在
  // 开头 —— 看不出在播，更谈不上拖。播放中每秒校准一次：系统按 PlaybackState 自带
  // 的速度往前推，但缓冲、跳转、换源之后它会停在错的地方。
  React.useEffect(() => {
    if (!enabled) return;
    const state: PlaybackSnapshot = playerState === 'PLAYING'
      ? 'playing'
      : playerState === 'PAUSED'
        ? 'paused'
        : 'stopped';
    const push = () => {
      const seconds = callbacksRef.current.getCurrentTime?.() ?? 0;
      void FoliaPlayback.setState({
        state,
        positionMs: Math.max(0, Math.round(seconds * 1000)),
        speed: 1,
      });
    };
    /*
     * 只有**播放 / 暂停翻转**和挂载时推一次状态。位置那一拍下面单独判断。
     */
    push();
    if (state !== 'playing') return;
    /*
     * ⭐ 位置那一拍：**原生播放器接管的那一首一次都不推。**
     *
     * 掉帧打点量出来的是「每秒一次、每次 80~290ms」的主线程阻塞，而这里正好是
     * 每秒一次 —— 每一笔都是一次 `startService` 的 IPC，服务的 `onStartCommand`
     * **跑在 App 的主线程上**，里面还要 `mediaSession.setPlaybackState()`（同步
     * Binder 给 system_server 与所有 MediaController）。掉帧那一刻堆内存纹丝不动
     * （28MB 恒定），所以不是 GC，就是主线程在等这次跨进程调用。
     *
     * 而这一推在原生播放时**没有任何收益**：服务那边 `resolvePlaybackPositionMs()`
     * 在原生在播时直接问播放器，写进去的 `cachedPositionMs` 在那条分支上不参与
     * 计算（全服务只有一处读取，就是它的兜底分支）。后台节流那个顾虑同样不成立 ——
     * 它跑在原生侧，不吃 WebView 的定时器节流。
     *
     * ⚠️ 只挡**位置**：播放 / 暂停翻转靠上面那次 `push()`（effect 依赖 playerState），
     * 服务要认状态，那条不能省。
     */
    const timer = window.setInterval(() => {
      if (nativePlaybackEngine.ownsPlayback()) return;
      push();
    }, POSITION_TICK_MS);
    /*
     * 再补一条由播放器事件驱动的：**后台的定时器会被 Chromium 节流**（页面既不可见、
     * WebView 里又已经没有音频在响，会掉进「intensive throttling」，1 秒变 1 分钟）。
     * 靠上面那个 setInterval 推位置，通知栏在后台上就永远是同一个数字。
     * 原生播放器只在状态边界发事件（不再按 250ms 推位置），这里只把它当成
     * 「后台也能跑的一拍」；原生接管时下面会直接返回，服务自己问播放器。
     *
     * ⚠️ 但**只在网页播放（`<audio>`）时**才真的推 —— 原生接管的那一首服务自己会问
     * 播放器，这一推纯属浪费（见下面 `ownsPlayback()` 那一处的说明）。
     */
    let lastPushAt = 0;
    const stopFollowingEngine = nativePlaybackEngine.subscribe(() => {
        /*
         * ⭐ **原生播放器接管的那一首，这一路一次都不推。**
         *
         * 服务那边 `FoliaPlaybackService.resolvePlaybackPositionMs()` 在原生在播时
         * **直接问播放器**（`FoliaNativePlayerPlugin.currentPositionMs()`）：比这里
         * 插值出来的更准，而且它跑在原生侧，**根本不吃 WebView 的定时器节流** ——
         * 上面那条注释担心的「后台通知栏不动」，靠的就是它，不需要 Web 顶这一下。
         * 也就是说这一推对进度条没有任何贡献（写进去的 cachedPositionMs 在原生在播
         * 时压根不参与计算），只有代价：
         *   · 一次 `startService` 的 IPC，服务 `onStartCommand` 还要重建一次
         *     MediaSession 的 PlaybackState（跨进程广播给系统 UI / 蓝牙 / Auto）；
         *   · 而 **Capacitor 的桥只有一条** —— 500ms 一笔正好把界面定期顶一下，
         *     表现就是「App 里隔一会儿顿一下，像在等什么东西」。
         *
         * 网页播放（`<audio>`）时不走这里，那条路只有播放器自己知道位置，照旧推。
         *
         * ⚠️ 只挡**位置**这一路：播放 / 暂停翻转是上面那个 effect 推的（依赖
         * playerState），服务要靠它认状态，那条不能省。
         */
        if (nativePlaybackEngine.ownsPlayback()) return;
        const now = Date.now();
        if (now - lastPushAt < 500) return;
        lastPushAt = now;
        push();
    });
    return () => {
        window.clearInterval(timer);
        stopFollowingEngine();
    };
  }, [enabled, playerState, currentSong]);
};

const getDurationMs = (song: SongResult): number => {
  const candidate = (song as SongResult & { duration?: number; durationMs?: number });
  const ms = candidate.durationMs ?? candidate.duration;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0;
  // 有些音源给的是秒。
  return ms > 0 && ms < 1000 ? Math.round(ms * 1000) : Math.round(ms);
};

/**
 * 红心的原生兜底需要的歌曲身份：平台与平台侧歌曲 id。
 *
 * 网易的收藏写入只认数字曲库 id（mediaId 就是它）；QQ 的写入要数字 songId
 * （正规化时存在 providerData.songId，mediaId 多数时候是 songmid，不能拿去猜）。
 * 本地 / Navidrome / 舞台这些自家人没有平台身份，原生兜底对它们跳过。
 */
const resolveLikeIdentity = (song: SongResult | null | undefined): {
  providerId: string;
  serverSongId: string;
} => {
  const sourceRef = song?.sourceRef?.kind === 'online' ? song.sourceRef : undefined;
  if (!sourceRef) return { providerId: '', serverSongId: '' };
  if (sourceRef.providerId === 'netease') {
    return { providerId: 'netease', serverSongId: String(sourceRef.mediaId ?? '') };
  }
  if (sourceRef.providerId === 'qq') {
    const data = (sourceRef.providerData ?? {}) as Record<string, unknown>;
    const id = typeof data.songId === 'string' && /^\d{1,15}$/.test(data.songId.trim())
      ? data.songId.trim()
      : (typeof sourceRef.mediaId === 'string' && /^\d{1,15}$/.test(sourceRef.mediaId.trim())
        ? sourceRef.mediaId.trim()
        : '');
    return { providerId: 'qq', serverSongId: id };
  }
  return { providerId: String(sourceRef.providerId), serverSongId: '' };
};

/**
 * 通知栏封面角标用哪颗图标。
 *
 * 通知栏封面右下角原本画的是 `android.R.drawable.ic_media_play`（那个 ▶），
 * 现在换成「这首歌来自哪个平台」的应用图标。来源只在在线歌的 sourceRef 上有，
 * 本地 / Navidrome / 舞台这些自家人一律回落 'folia' —— 原生侧没登记的值也回落 Folia。
 */
export const resolveProviderBadge = (song: SongResult | null | undefined): string => {
  const sourceRef = song?.sourceRef;
  if (sourceRef?.kind === 'online' && sourceRef.providerId) return sourceRef.providerId;
  return 'folia';
};

export { ACTION_UPDATE_METADATA, ACTION_UPDATE_STATE, ACTION_STOP_FOREGROUND, ACTION_WEB_COMMAND, EXTRA_COMMAND };
