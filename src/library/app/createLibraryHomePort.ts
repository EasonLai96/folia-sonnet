import i18n from '../../i18n/config';
import type { LibraryHomePort, LibraryHomeScanProgress } from '../core/home/homeModel.contract';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { translateHomeMessage } from '../core/home/homeSources';
import {
    deleteSongsByIds,
    importFolder,
    renameLocalSong as renameLocalSongService,
    resyncAllFolders,
    LOCAL_MUSIC_SCAN_PROGRESS_EVENT,
} from '../../services/localMusicService';
import { scanAndroidDeviceMusic } from '../../services/nativeLocalMusic';
import { getLocalLibraryAvailability } from '../../services/localLibraryAvailability';
import { importLocalPlaylistFile } from '../../services/localPlaylistFileService';
import { omni } from '../../services/onlineMusic/omni';
import {
    createLocalGridViewCollection,
    createNavidromeGridViewCollection,
    createOnlineGridViewCollection,
} from '../../components/app/home/gridViewCollectionAdapters';

// src/library/app/createLibraryHomePort.ts
// 把首页 surface 的回调与本地曲库服务、omni、集合描述工厂装配成首页动作的端口（照 createLibraryDirectoryBatchPort
// 的做法）。core 的 libraryHomeActions 只说「导入文件夹、刷新曲库、播放私人 FM、打开这张卡」；调哪个服务、
// 提示怎么翻译与显示（alert 仍是 window.alert，状态消息走 onStatusMessage），都在这里。surface 按调用现读。

type HomePortSurface = Pick<HomeSurfaceProps, 'localSongs' | 'onRefreshLocalSongs' | 'onStatusMessage' | 'onPlaySong'>;

export const createLibraryHomePort = (getSurface: () => HomePortSurface): LibraryHomePort => ({
    localAvailability: () => getLocalLibraryAvailability(),
    importFolder: async () => (await importFolder()).length,
    /**
     * 扫描设备音乐库（安卓原生）。
     *
     * ⚠ 这一条以前根本没接：core 里 `typeof port.scanDeviceMusic !== 'function'`
     * 就直接返回 unsupported，而调用方拿到 unsupported **什么都不做** —— 于是按钮
     * 点了没反应，既不扫描、也不申请读音频的权限（权限是原生插件在 scanLocalAudio
     * 里自己申请的，压根没走到）。原生那套（MediaStore 扫描 + 权限申请 + 所有文件
     * 访问兜底）一直都在，缺的就是这一行。
     *
     * 与「刷新」的区别：刷新走 resyncAllFolders → scanAndroidDeviceMusic()，默认
     * **尊重**用户删掉的根目录（不然就是「删了、一刷新又回来了」）；而这一颗按钮是
     * 用户显式要扫，所以要 includeRemovedRoots —— 连删掉的也一起捞回来。
     */
    scanDeviceMusic: async () => (await scanAndroidDeviceMusic({ includeRemovedRoots: true })).length,
    resyncAllFolders: async () => (await resyncAllFolders())?.length ?? 0,
    importPlaylistFile: async (file) => {
        const result = await importLocalPlaylistFile(file, getSurface().localSongs);
        return {
            playlistName: result.playlist?.name ?? null,
            matchedCount: result.matchedSongIds.length,
            skippedCount: result.unmatchedPaths.length + result.ambiguousPaths.length,
        };
    },
    deleteLocalSongs: async (songIds) => {
        // 服务自己会通知曲库更新；这里再刷一次宿主的状态（首页的分组与目录树要重算）。
        await deleteSongsByIds(songIds as string[]);
        await getSurface().onRefreshLocalSongs();
    },
    renameLocalSong: async (songId, name) => {
        // 服务自己会通知曲库更新；这里再刷一次宿主的状态（首页的分组与目录树要重算）。
        const result = await renameLocalSongService(songId, name);
        await getSurface().onRefreshLocalSongs();
        return result;
    },
    refreshLocalSongs: () => getSurface().onRefreshLocalSongs(),
    subscribeScanProgress: (listener) => {
        const handleScanProgress = (event: Event) => {
            listener((event as CustomEvent<LibraryHomeScanProgress>).detail ?? null);
        };
        window.addEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress);
        return () => window.removeEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress);
    },
    getPersonalFm: () => omni.getPersonalFm(),
    playPersonalFm: (song, queue) => getSurface().onPlaySong(song, queue, true),
    describeOnlineCollection: (collection, providerId) => createOnlineGridViewCollection(collection, providerId),
    describeLocalGroup: group => createLocalGridViewCollection(group),
    describeNavidromeCard: (card, type) => createNavidromeGridViewCollection(card, type),
    notify: (notice) => {
        const text = translateHomeMessage(i18n.t, notice.message);
        if (notice.kind === 'alert') {
            alert(text);
            return;
        }
        getSurface().onStatusMessage?.({ type: notice.type, text });
    },
});
