// android/qishui-bridge/src/car/api.js
//
// 车机协议层的对外门面：把 client / auth / catalog / feed / library 组装起来，
// 并做掉「Folia 的 operation」与「车机端点」之间的那一层翻译（虚拟歌单 id 等）。
//
// 上层（entry.js）只认这一层的方法与 Folia 形状，不直接碰协议常量。

import { createClient, QishuiError } from './client.js';
import { createAuth, createSessions } from './auth.js';
import { createCatalog, likedPlaylist } from './catalog.js';
import { createFeed } from './feed.js';
import { createLibrary } from './library.js';
import { resolveAudio } from './playback.js';
import { createFetch } from './transport.js';
import { coverFromUrlInfo, lyricsFromTrack, toFoliaPlaylists, toFoliaSong, toFoliaSongs } from './shape.js';
import { QISHUI_QR_SCOPE } from './protocol.js';

// 渲染层用这两个虚拟 id 拉「我的喜欢」与推荐流（见 qishuiCatalog.ts）。
export const QISHUI_LIKED_ID = 'qishui-liked';
export const QISHUI_FEED_ID = 'qishui-feed';

const text = value => (value == null ? '' : String(value));

export function createQishuiCar(options = {}) {
    const fetcher = options.fetch || createFetch(options.transport);
    const sessions = options.sessions || createSessions();
    const client = createClient({ sessions, fetch: fetcher });
    const auth = createAuth(client, { log: options.log || (() => {}) });
    const catalog = createCatalog(client);
    const feed = createFeed(client);
    const library = createLibrary(client);
    const { platform } = client;

    // 我的喜欢的真实歌单 id：车机里它是 type 1 的普通歌单，id 每个账号不同，
    // 而渲染层只认 'qishui-liked' 这一个入口，所以这里缓存一次映射。
    let likedReal = null;

    async function resolveLiked() {
        if (likedReal) return likedReal;
        likedReal = await likedPlaylist(platform);
        return likedReal;
    }

    const userShape = user => (user ? {
        id: text(user.id),
        nickname: text(user.nickname),
        avatarUrl: coverFromUrlInfo(user.avatar) || (typeof user.avatar === 'string' ? user.avatar : ''),
        ...(typeof user.isVip === 'boolean' ? { vipType: user.isVip ? 1 : 0 } : {}),
    } : null);

    return {
        sessions,

        /**
         * 登录态。
         *
         * 判定只认手里有没有 ticket 凭据：车机协议没有 cookie 这一层，旧协议那套
         * 「cookie 里有 sid_tt 就算登录」的坑（sid_tt 登录前就有）在这里不存在。
         * 续期（renew）失败不推翻已登录结论 —— 凭据还没过期就继续用，错误只进诊断。
         */
        async status() {
            const credential = sessions.get();
            const base = {
                provider: 'qishui',
                configured: true,
                loggedIn: Boolean(credential?.ticket),
                webSession: Boolean(credential?.ticket),
                cookieReady: Boolean(credential?.ticket),
                protocol: 'luna-car',
                scope: QISHUI_QR_SCOPE,
                cookieKeys: '(car-protocol)',
                loginKeys: credential?.ticket ? 'ticket=y' : 'ticket=n',
                userId: text(credential?.userId),
                libraryReady: Boolean(credential?.ticket),
                libraryErrors: [],
            };
            if (!credential?.ticket) {
                return { ...base, profileReady: false, profile: null, message: '未登录：请用抖音/汽水 App 扫码授权' };
            }
            let user = credential.user || null;
            let profileError = '';
            try {
                const fresh = await auth.status();
                if (fresh) user = fresh;
            } catch (error) {
                // 凭据还没过期就保留登录态，只把原因写进诊断。
                profileError = error instanceof QishuiError
                    ? `${error.code}${error.stage ? '/' + error.stage : ''}: ${error.message}`
                    : String(error?.message || error);
                if (Number(credential.expiresAt) > 0 && Number(credential.expiresAt) <= Date.now()) {
                    return {
                        ...base,
                        loggedIn: false,
                        webSession: false,
                        cookieReady: false,
                        profileReady: false,
                        profile: null,
                        profileError,
                        message: 'Qishui session expired; scan the QR code again',
                    };
                }
            }
            return {
                ...base,
                profileReady: Boolean(user?.id),
                profile: userShape(user),
                ...(profileError ? { profileError } : {}),
                expiresAt: Number(credential.expiresAt) || 0,
            };
        },

        async startLogin() {
            const result = await auth.start();
            return { key: result.key, qrDataUrl: result.imageUrl };
        },

        qr: key => auth.qr(key).imageUrl,
        checkLogin: key => auth.check(key),
        cancelLogin: key => { auth.cancel(key); },

        logout() {
            auth.logout();
            feed.clear();
            likedReal = null;
            return { provider: 'qishui', loggedIn: false, webSession: false, cookieReady: false, configured: true };
        },

        async search(keywords, limit, offset) {
            const page = await catalog.searchSongs({ query: keywords, limit, offset });
            const songs = toFoliaSongs(page.items);
            return {
                provider: 'qishui',
                songs,
                rawCount: page.items.length,
                offset,
                limit,
                nextOffset: page.nextOffset,
                hasMore: page.hasMore,
            };
        },

        async searchPlaylists(keywords, limit, offset) {
            const page = await catalog.searchPlaylists({ query: keywords, limit, offset });
            return {
                provider: 'qishui',
                playlists: toFoliaPlaylists(page.items),
                nextOffset: page.nextOffset,
                hasMore: page.hasMore,
            };
        },

        async songDetail(id) {
            const track = await catalog.track(id);
            return { provider: 'qishui', song: toFoliaSong(track) };
        },

        async lyrics(id) {
            const track = await catalog.track(id);
            const lyrics = lyricsFromTrack(track);
            return {
                provider: 'qishui',
                lyric: lyrics.lyric,
                yrc: lyrics.yrc,
                tlyric: lyrics.tlyric,
                source: lyrics.lyric || lyrics.yrc ? 'luna-car' : 'none',
            };
        },

        async audio(id, quality) {
            const track = await catalog.track(id);
            const audio = await resolveAudio(client, track, quality);
            return { provider: 'qishui', ...audio };
        },

        /**
         * 我的歌单：真实列表 + 两个虚拟入口（我的喜欢 / 推荐流）。
         * 车机的「我的喜欢」本身就在真实列表里（type 1），这里把它换成统一入口，
         * 免得同一个歌单在界面上出现两次。
         */
        async userPlaylists(limit, offset) {
            const page = await catalog.userPlaylists({ limit: 10000, offset: 0 });
            const real = page.items.filter(item => Number(item?.base_info?.type) !== 1);
            const liked = await resolveLiked().catch(() => null);
            const virtual = [
                {
                    id: QISHUI_LIKED_ID,
                    name: '我的喜欢',
                    cover: '',
                    description: '',
                    trackCount: 0,
                    creator: undefined,
                    artists: [],
                    isOwned: true,
                    owned: true,
                    virtual: true,
                },
                {
                    id: QISHUI_FEED_ID,
                    name: '汽水推荐',
                    cover: '',
                    description: '',
                    trackCount: 0,
                    creator: undefined,
                    artists: [],
                    isOwned: true,
                    owned: true,
                    virtual: true,
                    playbackMode: 'recommend-match',
                },
            ];
            const items = [...virtual, ...toFoliaPlaylists(real)];
            return {
                provider: 'qishui',
                playlists: items.slice(offset, offset + limit),
                total: items.length,
                nextOffset: offset + Math.min(limit, Math.max(0, items.length - offset)),
                hasMore: offset + limit < items.length,
                libraryErrors: liked ? [] : ['liked-playlist: not found'],
            };
        },

        async playlistTracks(id, limit, offset, ownerId = '') {
            const key = text(id);
            if (key === QISHUI_FEED_ID || key === 'qishui-feed') {
                const page = await feed.songs({ count: Math.max(limit, 6) });
                const songs = toFoliaSongs(page.items);
                return {
                    provider: 'qishui',
                    tracks: songs,
                    songs,
                    total: songs.length,
                    offset,
                    nextOffset: offset + songs.length,
                    hasMore: Boolean(page.hasMore),
                };
            }
            if (key === QISHUI_LIKED_ID || key === 'qishui-liked') {
                const liked = await resolveLiked();
                if (!liked) {
                    return {
                        provider: 'qishui', tracks: [], songs: [], total: 0, offset,
                        nextOffset: offset, hasMore: false, libraryErrors: ['liked-playlist: not found'],
                    };
                }
                return this.playlistTracks(liked.id, limit, offset, liked.ownerId);
            }
            const page = await catalog.playlistTracks({ id: key, ownerId, limit, offset });
            const tracks = toFoliaSongs(page.items);
            return {
                provider: 'qishui',
                tracks,
                songs: tracks,
                playlist: page.collection ? toFoliaPlaylists([page.collection])[0] || null : null,
                total: tracks.length,
                offset,
                nextOffset: page.nextOffset,
                hasMore: page.hasMore,
            };
        },

        async artist(artistId, limit, offset) {
            const page = await catalog.artistSongs({ id: artistId, limit: limit || 50, offset: offset || 0 });
            const songs = toFoliaSongs(page.items);
            let artist = null;
            try {
                const info = await catalog.artistDetail({ id: artistId });
                if (info) {
                    artist = {
                        id: text(info.id || artistId),
                        name: text(info.name),
                        cover: coverFromUrlInfo(info.url_avatar || info.avatar),
                        trackCount: Number(info.count_tracks || songs.length) || 0,
                        artists: [{ id: text(info.id || artistId), name: text(info.name) }],
                    };
                }
            } catch (_) {
                // 歌手详情不是必须：热门曲目拿到了就够列歌。
            }
            return { provider: 'qishui', artist, songs, total: page.total, nextOffset: page.nextOffset, hasMore: page.hasMore };
        },

        async feed(limit) {
            const page = await feed.songs({ count: Math.max(limit, 6) });
            const songs = toFoliaSongs(page.items);
            return { provider: 'qishui', songs, hasMore: Boolean(page.hasMore) };
        },

        feedModes: () => feed.modes(),

        likedSongs: () => library.likedSongs(),
        recentPlayed: (limit, offset) => library.recentPlayed({ limit, offset }).then(page => ({
            provider: 'qishui', songs: toFoliaSongs(page.items), hasMore: page.hasMore,
        })),
        checkTracks: ids => library.checkTracks({ ids }),
        likeSong: (id, liked) => library.likeSong({ id, liked }).then(() => ({ provider: 'qishui', success: true })),
        addSongs: (playlistId, ids) => library.editPlaylist({ operation: 'add', id: playlistId, ids })
            .then(() => ({ provider: 'qishui', success: true })),
        removeSongs: (playlistId, ids) => library.editPlaylist({ operation: 'remove', id: playlistId, ids })
            .then(() => ({ provider: 'qishui', success: true })),
        dislikeSong: (id, disliked) => library.dislikeSong({ id, disliked }).then(() => ({ provider: 'qishui', success: true })),
    };
}

export default { createQishuiCar };
