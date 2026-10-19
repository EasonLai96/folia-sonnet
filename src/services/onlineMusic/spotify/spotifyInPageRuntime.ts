import { OnlineProviderError } from '../../../types/onlineMusic';
import {
    isSpotifyNativeAvailable,
    refreshSpotifyNativeSession,
    requestSpotifyNativeSignIn,
} from '../../../platform/foliaNative';

// src/services/onlineMusic/spotify/spotifyInPageRuntime.ts
//
// 安卓上的 Spotify 取数层：走**公开 Web API**（api.spotify.com），跑在主 WebView 里。
//
// 为什么不是桌面端那一套：桌面端的 `query` 是 librespot 的**内部接口**（home / libraryV3 /
// searchTracks 那 12 个名字），背后是 protobuf 与 Spotify 自己的私有端点，安卓上拿不到
// librespot（`@lox-audioserver/node-librespot` 是原生 Node 模块，没有 android-arm64 预编译）。
// 所以这里换成公开 Web API —— 它是 CORS 友好的，浏览器里直接 fetch 就行。
//
// ⚠️ 代价：公开 Web API 给的 JSON 形状**与桌面端 librespot 给的不一样**。
// spotifyProvider / spotifyNormalize 目前按桌面端那套形状解析，所以这一层出来之后还要过一遍
// 归一化（见各 case 上的注释）。本轮先把「能登录、能拿到数据」这条路打通。
//
// 原生只管 OAuth：收回调需要本地端口（5588），换 token 会撞 CORS，两件 WebView 都做不了。

const API = 'https://api.spotify.com/v1';

/** 桌面端那 12 个 query 里，公开 Web API 没有对应物件的。 */
const UNSUPPORTED_QUERIES = new Set(['home', 'homeSection', 'browsePage', 'queryWhatsNewFeed']);
// 播歌与写操作：本轮不做（播歌要 librespot，写操作等取数稳了再说）。
const UNSUPPORTED = new Set(['audio', 'audio_kept', 'audio_keep', 'radio', 'playlist_edit', 'playlist_create']);

type Session = {
    accessToken: string;
    refreshToken: string;
    /** 过期时刻（epoch ms）。 */
    expiresAtMs: number;
};

let session: Session | null = null;

export const isSignedInSpotifyInPage = (): boolean => session !== null;

const requireSignIn = (what: string): string => {
    if (!session) throw new OnlineProviderError('auth-required', `Spotify sign-in is needed for ${what}`, 'spotify');
    return session.accessToken;
};

/** token 快过期就先续一次（提前 60 秒）。 */
const ensureFreshToken = async (): Promise<string> => {
    if (!session) throw new OnlineProviderError('auth-required', 'Spotify is not signed in', 'spotify');
    if (Date.now() < session.expiresAtMs - 60_000) return session.accessToken;
    if (!isSpotifyNativeAvailable() || !session.refreshToken) return session.accessToken;
    const result = await refreshSpotifyNativeSession(session.refreshToken);
    if (!result.ok) throw new OnlineProviderError('auth-required', result.error.message, 'spotify', result.error.code);
    const { accessToken, refreshToken, expiresInMs } = result.session;
    session = { accessToken, refreshToken: refreshToken || session.refreshToken, expiresAtMs: Date.now() + expiresInMs };
    return session.accessToken;
};

const call = async (path: string, token: string): Promise<unknown> => {
    const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) throw new OnlineProviderError('auth-required', 'Spotify said the sign-in is no longer valid', 'spotify');
    if (response.status === 403) throw new OnlineProviderError('not-playable', 'Spotify refused this request', 'spotify');
    if (!response.ok) throw new OnlineProviderError('network', `Spotify answered ${response.status}`, 'spotify');
    return response.json();
};

export const signOutSpotifyInPage = (): void => {
    session = null;
};

export const runSpotifyInPage = async (operation: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    if (operation === 'login_status') return { signedIn: session !== null };
    if (operation === 'logout') {
        signOutSpotifyInPage();
        return { signedIn: false };
    }
    if (operation === 'login_start') {
        const result = await requestSpotifyNativeSignIn();
        if (!result.ok) throw new OnlineProviderError('auth-required', result.error.message, 'spotify', result.error.code);
        const { accessToken, refreshToken, expiresInMs } = result.session;
        session = { accessToken, refreshToken, expiresAtMs: Date.now() + expiresInMs };
        return { signedIn: true };
    }
    if (operation === 'login_check') return { signedIn: session !== null };
    if (operation === 'login_cancel') return { signedIn: session !== null };
    if (UNSUPPORTED.has(operation)) {
        throw new OnlineProviderError('unsupported', `Spotify ${operation} is not available on Android yet`, 'spotify');
    }

    const token = await ensureFreshToken();
    const id = String(params.id ?? params.uri ?? params.playlistId ?? params.albumId ?? params.artistId ?? '');
    const value = (key: string) => String(params[key] ?? '');

    switch (operation) {
        case 'library':
            // 桌面端给的是「已收藏曲目」一页；公开 API 对应 /me/tracks。
            return call('/me/tracks?limit=50', token);
        case 'lyrics':
            // 公开 Web API 根本不提供歌词（桌面端是 librespot 走私有端点拿的）。
            throw new OnlineProviderError('unsupported', 'Spotify lyrics are not in the public API', 'spotify');
        case 'query': {
            const name = value('name');
            if (UNSUPPORTED_QUERIES.has(name)) {
                throw new OnlineProviderError('unsupported', `Spotify ${name} has no public equivalent`, 'spotify');
            }
            switch (name) {
                case 'searchTracks':
                    return call(`/search?q=${encodeURIComponent(value('query') || value('q'))}&type=track&limit=50`, token);
                case 'getTrack':
                    return call(`/tracks/${id}`, token);
                case 'getAlbum':
                    return call(`/albums/${id}`, token);
                case 'fetchPlaylist':
                    return call(`/playlists/${id}`, token);
                case 'queryArtistOverview':
                    return call(`/artists/${id}`, token);
                case 'queryArtistDiscographyAll':
                    return call(`/artists/${id}/albums?limit=50`, token);
                case 'libraryV3':
                case 'fetchLibraryTracks':
                    return call('/me/tracks?limit=50', token);
                case 'areEntitiesInLibrary':
                    return call(`/me/tracks/contains?ids=${encodeURIComponent(value('ids'))}`, token);
                default:
                    throw new OnlineProviderError('unsupported', `Spotify query ${name} is not available on Android yet`, 'spotify');
            }
        }
        default:
            throw new OnlineProviderError('unsupported', `Spotify ${operation} is not available on Android yet`, 'spotify');
    }
};

/** 取当前 token（给要拼 URL 的地方用）；没登录就是 null。 */
export const peekSpotifyAccessToken = (): string | null => session?.accessToken ?? null;
