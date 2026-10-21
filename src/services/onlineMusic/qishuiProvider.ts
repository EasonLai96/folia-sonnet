import type { LoginDiagnosticLine, OnlineMusicProvider, ProviderAudioSource, ProviderCollection } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { parseQishuiLyrics } from '../../utils/lyrics/qishuiLyrics';
import { getQishuiTransportAvailability, requestQishui, throwQishuiDataError } from './qishuiTransport';
import { normalizeQishuiCollection, normalizeQishuiSong, normalizeQishuiUser, qishuiPage, qishuiText } from './qishuiNormalize';
import { QISHUI_FEED_PLAYLIST_ID, qishuiCatalog } from './qishuiCatalog';
import { clearQishuiLibraryCache, qishuiLibrary } from './qishuiLibrary';
import { qishuiMutations } from './qishuiMutations';
import { diagnosticLine } from './login/loginDiagnosticReport';

// src/services/onlineMusic/qishuiProvider.ts

// 协议层的搜索与推荐流都把 limit 收在 18 以内，请求再大也只拿得到这么多。
const QISHUI_PAGE_MAX = 18;
// 主进程没给二维码有效期时的兜底：汽水二维码按 5 分钟算。
const QISHUI_QR_TTL_MS = 5 * 60 * 1000;

// 诊断报告的一行：provider 那几行交给报告时都过这里，报告只印这里写成的那句话（见 loginDiagnosticReport）。
const line = (text: string): LoginDiagnosticLine => diagnosticLine`${text}`;

// 汽水扫码登录一步就返回 token 与二维码，而 Omni 走的是 getQrKey -> createQr 两步，
// 所以这里用 token 记住这一次会话的二维码，再由 createQr 取出来。
const qrSessions = new Map<string, string>();
let qrTtlMs = QISHUI_QR_TTL_MS;

// 最近一次登录态检查的结论。扫码确认后账户没加载出来（account-refresh-failed）
// 时，诊断报告靠它说明卡在哪：是 status 就没认下这个会话，还是续期那一拍出了问题。
let lastQishuiLoginStatus: string | null = null;
/** refresh 的失败出口单独记一行：与 status 详情互不覆盖，诊断才看得全。 */
let lastQishuiRefreshNote: string | null = null;
export const noteQishuiRefreshDiagnostic = (text: string): void => {
    lastQishuiRefreshNote = text;
};
/** 最近一次 login.check 的结论：确认了但没拿到会话 Cookie 时，靠它看清 cookie 罐里有什么。 */
let lastQishuiCheckNote: string | null = null;
/** 二维码阶段服务端下发的扫码文案（谁家 App 能扫，由上游说了算）。 */
let lastQishuiQrNote: string | null = null;

function qishuiNotOurs(): OnlineProviderError {
    return new OnlineProviderError('unsupported', 'Song does not belong to Qishui Music', 'qishui');
}

export const qishuiProvider: OnlineMusicProvider = {
    id: 'qishui', displayName: '汽水音乐', shortName: '汽水',
    // 登录窗口里这个平台的记号（一个字 + 一种颜色）；不声明的话窗口会拿短名第一个字配中性灰。
    mark: { letter: '汽', color: '#f97316' },
    getAvailability: getQishuiTransportAvailability,
    capabilities: {
        search: true, playback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        // ⚠ `playlists` 决定首页「歌单」页签置不置灰（homeSources.ts 的
        // canUsePlaylists 就是 `userLibrary && playlists`）：漏了它，歌单明明拉得到，
        // 入口却是灰的。车机协议有 /me/playlist/ 与 /me/collection/mixed/，必须留着。
        playlists: true,
        // 车机协议没有专辑端点（安卓），桌面旧协议虽有但两端能力声明取交集：
        // 专辑入口在安卓点了只会拿到「不支持」，干脆整平台关掉。
        albums: false, artists: true, recommendations: true,
        userLibrary: true, likes: true, mutations: true, playlistTrackMutations: true,
    },
    normalizeSong: normalizeQishuiSong, normalizeUser: normalizeQishuiUser, normalizeCollection: normalizeQishuiCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return qishuiPage([], 0, offset, limit);
            const data = await requestQishui<any>('search', { keywords: query, limit: Math.min(limit, QISHUI_PAGE_MAX), offset });
            throwQishuiDataError(data);
            if (!Array.isArray(data.songs)) throw new OnlineProviderError('invalid-response', 'Qishui search list is missing', 'qishui');
            return qishuiPage(data.songs.map(normalizeQishuiSong), data.total, offset, limit, data);
        },
    },
    playback: {
        async getSongDetail(id) {
            const data = await requestQishui<any>('song.detail', { id });
            throwQishuiDataError(data);
            return data.song ? normalizeQishuiSong(data.song) : null;
        },
        async getAudioSource(song, quality) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'qishui') throw qishuiNotOurs();
            const data = await requestQishui<any>('song.url', { id: source.mediaId, quality });
            // 试听段不能当成整曲进缓存与时长统计，与波点保持同一判断。
            if (data?.trial === true) {
                throw new OnlineProviderError('preview-only', 'Qishui Music only offers a preview for this account', 'qishui');
            }
            const url = qishuiText(data?.url);
            if (url && data?.playable !== false) {
                const audio: ProviderAudioSource = { url, fetchedAt: Date.now(), quality };
                return audio;
            }
            const category = qishuiText(data?.restriction?.category || data?.reason);
            if (category === 'login_required' || category === 'cookie_required') {
                throw new OnlineProviderError('auth-required',
                    qishuiText(data?.message) || 'Sign in to Qishui Music to play this track', 'qishui');
            }
            // 拿不到直连 URL 时协议层把这首歌退回「推荐/匹配源」，交给上层换源。
            throw new OnlineProviderError('not-playable',
                qishuiText(data?.message) || 'Qishui Music has no direct audio URL for this track', 'qishui');
        },
        getAvailability(song) {
            return song.sourceRef?.kind === 'online' && song.sourceRef.providerData?.unavailable
                ? { state: 'unavailable' } : { state: 'unknown' };
        },
    },
    lyrics: {
        async getLyrics(song) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'qishui') throw qishuiNotOurs();
            const data = await requestQishui<any>('lyric', { id: source.mediaId });
            // 找不到歌词时协议层回空文本 + source: 'none'，这是合法答案而不是请求失败。
            return parseQishuiLyrics(data ?? {});
        },
    },
    auth: {
        getLoginTexts: () => ({ title: 'home.loginTitleQishui', note: 'home.loginNoteQishui' }),
        async getLoginStatus() {
            // 请求本身失败时也要留下痕迹：否则诊断只会写「last status: none」，
            // 看不出是没走到这一步，还是这一步抛了错。
            let data: any = null;
            try {
                data = await requestQishui<any>('status', {});
            } catch (error) {
                lastQishuiLoginStatus = 'status request failed: '
                    + (error instanceof Error ? `${error.message}` : String(error));
                throw error;
            }
            lastQishuiLoginStatus = data
                ? `loggedIn=${data.loggedIn ? 'yes' : 'no'} webSession=${data.webSession ? 'yes' : 'no'}`
                + ` cookieReady=${data.cookieReady ? 'yes' : 'no'} profileReady=${data.profileReady ? 'yes' : 'no'}`
                + ` libraryReady=${data.libraryReady ? 'yes' : 'no'} userId=${String(data.userId || '-')}`
                + ` cookieKeys=${String(data.cookieKeys ?? '-')}`
                + ` loginKeys=${String(data.loginKeys ?? '-')}`
                // 「重启后账号没了」全靠这两个：storage 是**读档**（native/local/memory/none），
                // store 再给出会话与设备 ID 各落在哪一档、设备 ID 是不是读回来的
                // （每次启动都重新生成＝那一档存储根本没读出来）。
                + ` storage=${String(data.storage ?? '-')}`
                + (data.store ? ` store=${JSON.stringify(data.store)}` : '')
                + (data.profileError ? ` profileError=${String(data.profileError)}` : '')
                + (Array.isArray(data.libraryErrors) && data.libraryErrors.length
                    ? ` libraryErrors=${data.libraryErrors.map((item: unknown) => String(item)).join(' | ')}` : '')
                : 'null';
            if (!data?.loggedIn) return null;
            const user = normalizeQishuiUser(data);
            // 登录态只有 status 这一处能读，缺 id 也不能当作未登录，否则整库会被清空。
            return { ...user, id: user.id || 'qishui-account' };
        },
        async logout() { clearQishuiLibraryCache(); await requestQishui('login.logout', {}); },
        async startLogin() {
            const data = await requestQishui<any>('login.qr', {});
            const token = qishuiText(data?.token);
            const imageUrl = qishuiText(data?.qrDataUrl || data?.qrcode || data?.qrCodeUrl);
            if (!token || !imageUrl) {
                throw new OnlineProviderError('invalid-response', 'Qishui QR login payload is incomplete', 'qishui');
            }
            const ttl = Number(data?.ttlMs);
            const expiresAt = Number(data?.expiresAt);
            // 主进程把协议返回的 expire_time 原样带出来（当前版本通常为 0，即用默认 5 分钟），
            // 它可能是秒级时长，也可能是秒/毫秒时间戳，所以按数值量级判定。
            const expireTime = Number(data?.expireTime);
            if (Number.isFinite(ttl) && ttl > 0) qrTtlMs = ttl;
            else if (Number.isFinite(expiresAt) && expiresAt > Date.now()) qrTtlMs = expiresAt - Date.now();
            else if (Number.isFinite(expireTime) && expireTime > 0) {
                const resolved = expireTime >= 1e12 ? expireTime - Date.now()
                    : expireTime >= 1e9 ? expireTime * 1000 - Date.now() : expireTime * 1000;
                qrTtlMs = resolved > 0 ? resolved : QISHUI_QR_TTL_MS;
            }
            qrSessions.set(token, imageUrl);
            // 服务端下发的扫码文案原样留档：上游实测是「抖音」，诊断里一眼可见，
            // 免得靠猜「到底该用哪个 App 扫」。
            lastQishuiQrNote = `qr copywriting: ${qishuiText(data?.copywriting) || '(none)'}`
                + ` / webName: ${qishuiText(data?.webName) || '(none)'}`;
            return token;
        },
        async createQr(key) {
            const imageUrl = qrSessions.get(key);
            if (!imageUrl) {
                throw new OnlineProviderError('invalid-response', 'Qishui QR session is no longer available', 'qishui');
            }
            return imageUrl;
        },
        async checkLogin(key) {
            let data: any;
            try {
                data = await requestQishui<any>('login.check', { token: key });
            } catch (error) {
                const message = error instanceof Error ? error.message : undefined;
                // 主进程把「设备侧取消验证」抛成 `mfa-cancelled`（映射后会变成 auth-required，
                // 所以这里读 transport 带下来的原始码），还原成 UI 能立刻重试的错误态。
                const rawCode = error instanceof OnlineProviderError ? String(error.cause ?? '') : '';
                if (rawCode.toLowerCase().replace(/[_\s]+/g, '-') === 'mfa-cancelled') {
                    return { state: 'error', reason: 'canceled-on-device', message };
                }
                return { state: 'error', message };
            }
            const message = qishuiText(data?.message) || undefined;
            lastQishuiCheckNote = `status=${qishuiText(data?.status) || '-'}`
                + ` errorCode=${String(data?.errorCode ?? data?.error_code ?? '0')}`
                + ` loggedIn=${data?.loggedIn ? 'yes' : 'no'}`
                + ` cookieKeys=${String(data?.cookieKeys ?? '-')}`
                + ` loginKeys=${String(data?.loginKeys ?? '-')}`
                + ` hostCookieKeys=${String(data?.hostCookieKeys ?? '-')}`
                + ` msg=${message ?? ''}`;
            const retryAfter = Number(data?.retryAfterMs);
            const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
            const errorCode = Number(data?.errorCode ?? 0);
            switch (qishuiText(data?.status)) {
                case 'waiting': return { state: 'waiting' };
                case 'scanned': return { state: 'scanned' };
                case 'confirmed': return { state: 'confirmed' };
                case 'expired': return { state: 'expired' };
                // 设备侧取消要给 UI 一个可以立刻重试的理由，其余错误（含 rate_limited）只带文字。
                case 'mfa_cancelled': return { state: 'error', reason: 'canceled-on-device', message, retryAfterMs };
                // 上游的状态词会变：未扫码时实测返回 `status: 'new'`，主进程已归一成 waiting；
                // 万一将来又出现新词，只要没有非零 errorCode 就继续等，不要把它当登录失败 ——
                // 否则 UI 会在用户还没扫码时就显示「登录错误」。
                default: return errorCode !== 0
                    ? { state: 'error', message, retryAfterMs }
                    : { state: 'waiting' };
            }
        },
        async cancelLogin(key) { qrSessions.delete(key); },
        getLoginTtlMs: () => qrTtlMs,
        async getLoginDiagnostics() {
            return [
                line(`last status: ${lastQishuiLoginStatus ?? 'none'}`),
                line(`last qr: ${lastQishuiQrNote ?? 'none'}`),
                line(`last check: ${lastQishuiCheckNote ?? 'none'}`),
                line(`last refresh: ${lastQishuiRefreshNote ?? 'none'}`),
                // 安卓端协议层已换成车机协议（/api/luna/v1/platform）：签名是
                // WebView 自带的 WebCrypto ECDSA P-256（bd-ticket-guard），不再
                // 依赖 bdms.node，旧「a_bogus 回退」那行说明已过时。
                line('signed requests: android=luna-car protocol (bd-ticket-guard via WebCrypto); desktop=passport cookies'),
            ];
        },
    },
    catalog: qishuiCatalog,
    library: qishuiLibrary,
    mutations: qishuiMutations,
    recommendations: {
        async getRecommendedCollections(limit) {
            const data = await requestQishui<any>('feed', { limit: Math.min(limit, QISHUI_PAGE_MAX) }).catch(() => null);
            const songs = Array.isArray(data?.songs) ? data.songs.map(normalizeQishuiSong) : [];
            if (!songs.length) return [];
            const collection: ProviderCollection = {
                providerId: 'qishui', id: QISHUI_FEED_PLAYLIST_ID, type: 'playlist', name: '汽水推荐',
                coverUrl: songs[0].album.coverUrl, trackCount: songs.length,
                providerData: { virtual: true, playbackMode: 'recommend-match' },
            };
            return [collection].slice(0, limit);
        },
        async getPersonalFm() {
            return requestQishui<any>('feed', { limit: QISHUI_PAGE_MAX })
                .then(data => (Array.isArray(data?.songs) ? data.songs.map(normalizeQishuiSong) : []))
                .catch(() => []);
        },
    },
};
