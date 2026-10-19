import { OnlineProviderError } from '../../../types/onlineMusic';
import { requestYtmNativeSignIn, type YtmNativeSession } from '../../../platform/foliaNative';

// src/services/onlineMusic/ytm/ytmInPageRuntime.ts
//
// 安卓上的 YouTube Music 协议层：跑在**主 WebView 里**，用 youtubei.js —— 它本来就是浏览器
// 库，所以不需要原生替它开一个隐藏 WebView（那是汽水那条路的形状，这里刻意不走）。
//
// 原生只剩一座登录 Activity：YouTube 没给 YouTube Music 的 OAuth，凭据只能是 cookie，
// 而 cookie 只能从「用户真的登录过的那个 WebView」里读 —— 见 platform/foliaNative 的 FoliaYtm。
//
// 没有登录也能用大半：搜索、专辑、歌单、歌词都是公开接口。要用户自己的歌单才需要 cookie。

const UNSUPPORTED = new Set(['audio', 'playlist_edit', 'list_save', 'list_saved', 'song_like', 'mix']);

/** 只建一次：Innertube 建起来要拉一次 innertube 的配置，重复建既慢又没必要。 */
let sessionPromise: Promise<unknown> | null = null;
let currentCookie: string | null = null;

/** 登录拿到的 cookie（内存里，不落盘 —— 它就是这个账号）。 */
let signedIn: YtmNativeSession | null = null;

const loadInnertube = async () => {
    /*
     * 走变量而不是字面量，是有意的：youtubei.js 是给 Electron 主进程用的依赖（ESM-only，
     * 且带 Node 侧的东西），写死字面量会让 tsc 与打包器都要求它此刻就在 —— 而它在只出
     * Web 包的环境里是可以不装的。这里改成运行时才解析：装了就用，没装就抛
     * `unavailable`，不至于拖垮整个前端构建。
     */
    const specifier = 'youtubei.js';
    const { Innertube } = (await import(/* @vite-ignore */ specifier)) as {
        Innertube: { create(options: Record<string, unknown>): Promise<unknown> };
    };
    return Innertube.create({
        // 带着 cookie 建 = 已登录；不带就是匿名，公开接口照样通。
        ...(signedIn ? { cookie: signedIn.cookie, user_agent: signedIn.userAgent } : {}),
        // 播放器那一路要 poToken（BotGuard），安卓上搞不定，也不要 —— 这里只要取数。
        retrieve_player: false,
    });
};

const getSession = async (): Promise<any> => {
    if (!sessionPromise) sessionPromise = loadInnertube();
    return sessionPromise;
};

/** cookie 变了就要重建：登录 / 登出之后调用。 */
export const resetYtmInPageSession = (): void => {
    sessionPromise = null;
    currentCookie = null;
};

/** 让用户登录 YouTube，并把 cookie 记住。返回是否拿到了会话。 */
export const signInYtmInPage = async (): Promise<boolean> => {
    const result = await requestYtmNativeSignIn();
    if (!result.ok) throw new OnlineProviderError('auth-required', result.error.message, 'ytm', result.error.code);
    signedIn = result.session;
    resetYtmInPageSession();
    return true;
};

export const signOutYtmInPage = (): void => {
    signedIn = null;
    resetYtmInPageSession();
};

export const isSignedInYtmInPage = (): boolean => signedIn !== null;

/** 需要一个登录态的 operation：没登录就明说，别返回空列表让人以为「真的没有」。 */
const requireSignIn = (operation: string) => {
    if (signedIn) return;
    throw new OnlineProviderError('auth-required', `YouTube Music sign-in is needed for ${operation}`, 'ytm');
};

export const runYtmInPage = async (operation: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    if (operation === 'login_status') return { signedIn: signedIn !== null };
    if (operation === 'logout') {
        signOutYtmInPage();
        return { signedIn: false };
    }
    if (operation === 'web_login_start') {
        await signInYtmInPage();
        return { signedIn: true };
    }
    if (operation === 'web_login_check') return { signedIn: signedIn !== null };
    if (operation === 'web_login_cancel') return { signedIn: signedIn !== null };
    if (UNSUPPORTED.has(operation)) {
        throw new OnlineProviderError('unsupported', `YouTube Music ${operation} is not available on Android yet`, 'ytm');
    }

    const yt: any = await getSession();
    const text = (value: unknown) => String(value ?? '');

    switch (operation) {
        case 'search_songs': {
            const query = text(params.query ?? params.q);
            if (!query) throw new OnlineProviderError('invalid-response', 'A search needs a query', 'ytm');
            const results = await yt.music.search(query, { filter: 'songs' });
            return results;
        }
        case 'lyrics': {
            const id = text(params.videoId ?? params.id ?? params.browseId);
            if (!id) throw new OnlineProviderError('invalid-response', 'Lyrics need a video id', 'ytm');
            return yt.music.getLyrics(id);
        }
        case 'album':
            return yt.music.getAlbum(text(params.browseId ?? params.id));
        case 'artist':
            return yt.music.getArtist(text(params.browseId ?? params.id));
        case 'playlist':
        case 'public_playlist':
            return yt.music.getPlaylist(text(params.id ?? params.browseId ?? params.playlistId));
        case 'song_detail':
        case 'song_detail_en':
        case 'song_detail_zh':
            return yt.music.getInfo(text(params.videoId ?? params.id));
        case 'explore':
            return yt.music.getHomeFeed();
        case 'user_playlists':
        case 'user_albums':
            requireSignIn(operation);
            return yt.music.getLibrary();
        default:
            throw new OnlineProviderError('unsupported', `YouTube Music ${operation} is not available on Android yet`, 'ytm');
    }
};
