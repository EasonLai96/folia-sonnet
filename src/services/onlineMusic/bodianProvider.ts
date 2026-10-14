import type { OnlineMusicProvider, ProviderAudioSource, ProviderCollection, QrLoginState } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { parseBodianLyrics } from '../../utils/lyrics/bodianLyrics';
import { getBodianTransportAvailability, requestBodian } from './bodianTransport';
import { bodianPage, normalizeBodianCollection, normalizeBodianSong, normalizeBodianUser } from './bodianNormalize';
import { bodianCatalog } from './bodianCatalog';
import { bodianLibrary, clearBodianLibraryCache } from './bodianLibrary';
import { bodianMutations } from './bodianMutations';
import { proxyNativeRemoteAudioUrl } from '../nativeRemoteAudio';
import type { BodianLyricsPayload } from 'bodian-music-api';

// src/services/onlineMusic/bodianProvider.ts

const BODIAN_DISCOVER_MODULE_ID = 1;

type BodianDiscoverDetail = { title?: unknown; subTitle?: unknown; musicList?: unknown[] };

const normalizeBodianDiscoverCollection = (detail: BodianDiscoverDetail, index: number, fallbackTitle?: unknown): ProviderCollection => {
    const songs = Array.isArray(detail.musicList) ? detail.musicList.map(normalizeBodianSong) : [];
    const firstSong = songs[0];
    return {
        providerId: 'bodian',
        id: `discover-${index}`,
        type: 'playlist',
        name: String(detail.title || fallbackTitle || `Discover ${index + 1}`),
        coverUrl: firstSong?.album.coverUrl || '',
        description: String(detail.subTitle || '「为你量身打造的专属歌单」'),
        trackCount: songs.length,
        providerData: { discoverIndex: index },
    };
};

async function getBodianDiscoverCollections(): Promise<ProviderCollection[]> {
    try {
        const module = await requestBodian<any>('home_module', { moduleId: BODIAN_DISCOVER_MODULE_ID });
        const cards = Array.isArray(module.songList) ? module.songList : [];
        const results = await Promise.allSettled(cards.map(async (card: any) => {
            const index = Number(card?.id);
            if (!Number.isInteger(index) || index < 0) return null;
            const detail = await requestBodian<BodianDiscoverDetail>('ai_playlist_detail', { index });
            return normalizeBodianDiscoverCollection(detail, index, card?.title);
        }));
        return results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
    } catch {
        return [];
    }
}

export const bodianProvider: OnlineMusicProvider = {
    id: 'bodian', displayName: '波点音乐', shortName: '波点',
    getAvailability: getBodianTransportAvailability,
    capabilities: {
        search: true, playback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        playlists: true, albums: true, artists: true, recommendations: true,
        userLibrary: true, userAlbums: true, likes: true, mutations: true, playlistTrackMutations: true,
    },
    normalizeSong: normalizeBodianSong, normalizeUser: normalizeBodianUser, normalizeCollection: normalizeBodianCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return bodianPage([], 0, offset, limit);
            const data = await requestBodian<any>('search', { query, limit, offset });
            if (!Array.isArray(data.resultList)) throw new OnlineProviderError('invalid-response', 'Bodian search list is missing', 'bodian');
            return bodianPage(data.resultList.map(normalizeBodianSong), data.total, offset, limit, data.bodianPagination);
        },
    },
    playback: {
        async getSongDetail(id) { return normalizeBodianSong(await requestBodian('song_detail', { id })); },
        async getAudioSource(song, quality) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'bodian') {
                throw new OnlineProviderError('unsupported', 'Song does not belong to Bodian', 'bodian');
            }
            const audio = await requestBodian<ProviderAudioSource & { preview?: { startTime: number; endTime: number } }>('audio', {
                id: source.mediaId, quality, freeSign: typeof source.providerData?.freeSign === 'string' ? source.providerData.freeSign : '',
            });
            // Full-track caches and timing must never ingest a 30-second preview as the complete song.
            /*
             * 这里**不要**挂 signInMayHelp / 任何登录态信号。
             *
             * 走查过传输层：`checkRight` 回 `status === 3` 才给这段试听，这是**版权 / 会员**
             * 判定 —— 账号对这个曲目没有完整播放权，跟他登没登录没关系。真正没会话时桥自己
             * 会抛 auth-required（`status 7` / `status` 缺失且 getSession() 为空），
             * token 过期则是 HTTP 401 或 code 11012，同样归一成 auth-required。
             *
             * 也就是**传输层已经把两件事分开了**。曾经在这里补过 signInMayHelp，想让
             * 「只给试听」也能读出 cookie 过期，结果刚登录的账号拿到一首要会员的歌就被判成
             * 过期、账号被清掉 —— 用户看到的是「刚登录就被踢下线」，而他的凭据一直是好的。
             * 试听不是登录态的证据，别再往这个 code 上挂登录含义。
             */
            if (audio.preview) throw new OnlineProviderError('preview-only', 'Bodian only offers a preview; sign in with an eligible account', 'bodian');
            // 波点的直链挂在 Kuwo 的 CDN 上，不下发 CORS 头，而 <audio> 带 crossOrigin="anonymous"
            // —— 直连时字节被同源检查挡掉，报出来却只是一句 Format error。真机上换成
            // 本地回环服务代转（回包带 ACAO），别的平台原样返回。
            const url = await proxyNativeRemoteAudioUrl(audio.url);
            return url && url !== audio.url ? { ...audio, url } : audio;
        },
        // 只有下架信号会给 unavailable / taken-down；播放限制交给运行时。缓存里旧的布尔 `unavailable`
        // 分不清下架还是限制（缓存歌曲在 normalizeBodianSong 原样放行），一律按 unknown。
        getAvailability(song) {
            const availability = song.sourceRef?.kind === 'online' ? song.sourceRef.providerData?.availability : undefined;
            if (availability === 'off-shelf') return { state: 'unavailable', reason: 'taken-down' };
            if (availability === 'online-play-restricted') return { state: 'unknown', reason: 'restricted' };
            return { state: 'unknown' };
        },
    },
    lyrics: {
        async getLyrics(song) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'bodian') {
                throw new OnlineProviderError('unsupported', 'Song does not belong to Bodian', 'bodian');
            }
            const data = await requestBodian<BodianLyricsPayload>('lyrics', { id: source.mediaId });
            return parseBodianLyrics(data);
        },
    },
    auth: {
        getLoginStatus: () => requestBodian('login_status'),
        async logout() { clearBodianLibraryCache(); await requestBodian('logout'); },
        async getQrKey() { return (await requestBodian<{ key: string }>('login_qr_key')).key; },
        async createQr(key) { return (await requestBodian<{ imageUrl: string }>('login_qr_create', { key })).imageUrl; },
        checkQr: key => requestBodian<QrLoginState>('login_qr_check', { key }),
        async cancelQr(key) { await requestBodian('login_qr_cancel', { key }); },
        getQrTtlMs: () => 5 * 60 * 1000,
    },
    catalog: bodianCatalog,
    library: bodianLibrary,
    mutations: bodianMutations,
    recommendations: {
        async getRecommendedCollections(limit) {
            const [regular, discover] = await Promise.all([
                requestBodian<any>('recommendations').then(data => (
                    (data.lists || []).flatMap((group: any) => group.playLists || []).map((item: unknown) => normalizeBodianCollection(item))
                )).catch(() => [] as ProviderCollection[]),
                getBodianDiscoverCollections(),
            ]);
            const seen = new Set<string>();
            return [...discover, ...regular].filter(collection => {
                const key = `${collection.providerId}:${collection.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, limit);
        },
        async getPersonalFm() {
            return requestBodian<any>('personal_fm')
                .then(data => (data.musicList || []).map(normalizeBodianSong))
                .catch(() => []);
        },
    },
};
