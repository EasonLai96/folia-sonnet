// android/qishui-bridge/src/entry.js
//
// 签名宿主页面的协议层入口：把 electron/qishui 的两份纯 JS（qishui-api.js +
// qishui-qr-login.js）跑起来，并复刻 electron/qishuiApiBridge.cjs 的 operation
// 派发与返回信封。差异只有两处：
//
//   1. 凭据不再落 userData 文件，而是经 fs shim（localStorage）；
//   2. loopback 音频代理不存在 —— song.url 原样返回上游直链，
//      加密音频（#auth=）的解密由原生侧的本地音频服务器承接。
//
// 对外只暴露一个入口：window.__foliaQishui.start(operation, paramsJson, ticket)。
// 结果通过 FoliaQishuiHost.resolve(ticket, envelopeJson) 回给原生
// （envelopeJson 与桌面端一致：{ ok, data } / { ok, error }）。

import * as fsShim from './shims/fs.js';
import qishuiApi from '../../../electron/qishui/qishui-api.js';
// generated/qishui-qr-login.cjs 由 build.mjs 从 electron/qishui/qishui-qr-login.js
// 生成：唯一差异是 require('./qishui-auth-v6') 改指裁剪版签名层。
import qishuiQrLogin from './generated/qishui-qr-login.cjs';
// 与上面那个模块 require 的同一份裁剪版签名层：登录 cookie 由宿主（OkHttp 收到的
// set-cookie）持有，判定登录态之前要把它并回 config。
import { syncNativeCookiesIntoConfig } from './qishui-auth-android.js';

const COOKIE_FILE = process.env.QISHUI_COOKIE_FILE;

// ---- 信封与失败归一（照抄 qishuiApiBridge.cjs）---------------------------

function qishuiErrorCode(value) {
    return String(value == null ? '' : value)
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function qishuiClampInt(value, fallback, min, max) {
    const raw = value === undefined || value === null || value === '' ? String(fallback) : String(value);
    const parsed = parseInt(raw, 10) || fallback;
    return Math.max(min, Math.min(max, parsed));
}

function qishuiBridgeFailure(code, message) {
    const error = new Error(String(message || code || 'Qishui request failed'));
    error.qishuiCode = qishuiErrorCode(code) || 'qishui-error';
    return error;
}

function qishuiResultMessage(result) {
    if (!result || typeof result !== 'object') return '';
    const candidates = [result.message, result.restriction && result.restriction.message, result.error];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return '';
}

function qishuiFailureFromResult(operation, result) {
    const category = result && (result.reason || (result.restriction && result.restriction.category));
    const raw = category || (result && (result.error || result.errorCode)) || '';
    return {
        ok: false,
        error: {
            code: qishuiErrorCode(raw) || 'qishui-error',
            message: qishuiResultMessage(result) || 'Qishui ' + operation + ' failed',
        },
    };
}

function qishuiFailureEnvelope(error, operation) {
    const raw = (error && (error.qishuiCode || error.code)) || '';
    const message = String((error && error.message) || ('Qishui ' + operation + ' failed'));
    const code = qishuiErrorCode(raw) || (/COOKIE_REQUIRED|login|not logged/i.test(message) ? 'login-required' : 'qishui-error');
    return { ok: false, error: { code, message } };
}

const QISHUI_RESULT_FAILURES = {
    'song.url': result => !result || result.playable === false || !result.url,
    'song.detail': result => !result || !result.song,
    album: result => !result || !result.album,
    lyric: result => !!(result && result.error && !result.lyric),
    comments: result => !!(result && result.error),
    'track.liked': result => !!(result && result.error),
    'track.like': result => !!(result && (result.ok === false || result.success === false)),
    'playlist.collect': result => !!(result && (result.ok === false || result.success === false)),
    'playlist.addSong': result => !!(result && (result.ok === false || result.success === false)),
    'album.collect': result => !!(result && (result.ok === false || result.success === false)),
    'report.play': result => !!(result && (result.ok === false || result.success === false)),
    'comment.create': result => !!(result && (result.ok === false || result.success === false)),
};

// ---- 凭据（cookie 走 fs shim）--------------------------------------------

function readQishuiCookie() {
    try {
        return fsShim.readFileSync(COOKIE_FILE, 'utf8');
    } catch (_) {
        return '';
    }
}

function saveQishuiCookie(value) {
    const normalized = qishuiApi.normalizeQishuiCookieInput(value)
        || String(value || '').replace(/\s+/g, ' ').trim();
    fsShim.writeFileSync(COOKIE_FILE, normalized);
    return normalized;
}

// ---- 状态富化的时间预算 --------------------------------------------------
//
// 「是否登录」只由 cookie 决定；handleQishuiStatus 多出来的资料与歌单是**锦上添花**，
// 而它们全走 /luna —— 安卓没有 bdms.node（Windows x64 原生模块），只能拿 a_bogus
// 去碰，碰不到就是碰不到。早先把整段 await 住：一次 /luna 卡住就能把 status 拖过
// 插件的 25s 上限，表现成「登录超时」「完成二次验证后报错」。所以富化单独一个预算，
// 超时就按 cookie 判定返回，绝不让它决定成败。

// 富化的预算。fetchQishuiWebLibrary 先单独打 me（每个 /luna 请求自己 6.5s），
// 再并行三个，签名那一路失败还会退回普通请求重打一遍 —— 6s 会被它自己吃满，
// 于是 status 永远只回「光秃秃的 cookie 判定」，歌单与资料全空。
// 给到 15s：插件侧 25s 才是硬上限，且库结果有 90s 缓存，后续 status 会很快。
const STATUS_ENRICH_BUDGET_MS = 15000;

async function withBudget(promise, ms) {
    let timer = null;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); });
    try {
        // 超时后 promise 仍会跑完；挂一个 catch 既防它事后变成未处理的拒绝，
        // 也让「抛错」和「太慢」得到同一个结果：退回 cookie 判定。
        return await Promise.race([Promise.resolve(promise).catch(() => null), timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** cookie 里到底有哪些键（诊断用，不回传值）。 */
function cookieKeyNames(text) {
    const names = [];
    String(text || '').split(';').forEach(pair => {
        const eq = pair.indexOf('=');
        if (eq <= 0) return;
        const name = pair.slice(0, eq).trim();
        if (name && !names.includes(name)) names.push(name);
    });
    return names.join(',') || '(empty)';
}

/**
 * 「哪些登录 cookie 真的在手里」。
 *
 * 登录判定（hasLoginCookie）只要 sessionid / sessionid_ss / sid_guard / sid_tt
 * 里**任意一个**命中就通过了，而 sid_tt 这类跟踪 cookie 登录前就可能存在 ——
 * 于是会出现「界面说登录成功，但 /luna 回 1000016 登录状态已失效」。
 * /luna 认的是完整会话，所以这里逐个键列出来，诊断一眼可见到底缺哪个。
 */
const QISHUI_LOGIN_COOKIE_KEYS = ['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt', 'uid_tt', 'uid_tt_ss'];

function loginCookieKeys(text) {
    const obj = {};
    String(text || '').split(';').forEach(pair => {
        const eq = pair.indexOf('=');
        if (eq <= 0) return;
        obj[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });
    return QISHUI_LOGIN_COOKIE_KEYS
        .map(name => name + (obj[name] ? '=y' : '=n'))
        .join(' ');
}

function clearHostCookies() {
    const host = typeof window !== 'undefined' ? window.FoliaQishuiHost : null;
    if (!host || typeof host.clearCookies !== 'function') return false;
    try {
        host.clearCookies();
        return true;
    } catch (_) {
        return false;
    }
}

function hostCookieKeys() {
    const host = typeof window !== 'undefined' ? window.FoliaQishuiHost : null;
    if (!host || typeof host.getCookie !== 'function') return '(no-host)';
    try {
        return cookieKeyNames(host.getCookie('https://www.qishui.com/'));
    } catch (_) {
        return '(host-threw)';
    }
}

async function readQishuiStatus(cookie) {
    const base = qishuiApi.getQishuiStatus(cookie);
    // 诊断用：登录判定的输入到底是什么。cookieKeys 为空说明压根没拿到 cookie，
    // 有键但 loggedIn=no 说明拿到的是不含 sessionid 的那一批。
    const cookieKeys = cookieKeyNames(cookie);
    const loginKeys = loginCookieKeys(cookie);
    if (!base.webSession) return Object.assign({}, base, { cookieKeys, loginKeys });
    const enriched = await withBudget(qishuiApi.handleQishuiStatus(cookie), STATUS_ENRICH_BUDGET_MS);
    if (enriched) return Object.assign({}, enriched, { cookieKeys, loginKeys });
    return Object.assign({}, base, {
        profileReady: false,
        libraryReady: false,
        statusBudgetExceeded: true,
        profileError: 'QISHUI_STATUS_BUDGET_EXCEEDED',
    });
}

// ---- operation 派发（照抄 qishuiApiBridge.cjs；song.url 见文件头说明）----

const handlers = {
    status: () => readQishuiStatus(readQishuiCookie()),

    'login.qr': async () => {
        const result = await qishuiQrLogin.createQrCode();
        const data = (result && result.data) || {};
        return {
            provider: 'qishui',
            token: String(data.token || ''),
            qrcode: String(data.qrcode || ''),
            qrcodeIndexUrl: String(data.qrcode_index_url || ''),
            expireTime: Number(data.expire_time || 0),
            message: '请使用汽水音乐 App 扫码并确认登录',
            // 服务端自己下发的扫码文案（data.copywriting）。上游实测写的是「抖音」，
            // 这里原样带出来，诊断里能直接看到该让用什么 App 扫。
            copywriting: String(data.copywriting || ''),
            webName: String(data.web_name || ''),
        };
    },

    'login.check': async params => {
        const token = String((params && params.token) || '').trim();
        if (!token) {
            // 把收到的键名带回诊断：能立刻分清是「params 整个没过桥」还是
            // 「token 字段丢了」—— 安卓上第一次轮询就报这个时尤其有用。
            const keys = Object.keys(params && typeof params === 'object' ? params : {}).join(',') || '(empty)';
            throw qishuiBridgeFailure('missing-token', '二维码登录 token 缺失（params keys: ' + keys + '）');
        }
        const api = qishuiApi;
        const bridge = qishuiQrLogin;
        let result;
        try {
            result = await bridge.checkQrConnect(token);
        } catch (error) {
            if (error && error.code === 'QISHUI_MFA_CANCELLED') {
                throw qishuiBridgeFailure('mfa-cancelled', error.message || '汽水音乐登录已取消');
            }
            throw error;
        }
        const data = (result && result.data) || {};
        const errorCode = Number(data.error_code || 0);
        // 登录 cookie 未必都随「确认」那一个响应下发（passport 有时分几拍给），
        // 所以判定登录态之前先把宿主 cookie 罐再并一次。
        syncNativeCookiesIntoConfig();
        if (bridge.getStatus().loggedIn) {
            const cookie = bridge.getCookie();
            if (!api.qishuiCookieHasLogin(cookie)) {
                throw qishuiBridgeFailure('qishui-qr-session-cookie-missing', '二维码登录未返回有效的会话 Cookie');
            }
            saveQishuiCookie(cookie);
            const status = await readQishuiStatus(readQishuiCookie());
            return Object.assign({}, status, {
                provider: 'qishui',
                ok: true,
                loggedIn: true,
                webSession: true,
                cookieReady: true,
                status: 'confirmed',
                errorCode: 0,
                error_code: 0,
                message: '登录成功',
                cookieKeys: cookieKeyNames(cookie),
                loginKeys: loginCookieKeys(cookie),
                hostCookieKeys: hostCookieKeys(),
            });
        }
        // 状态词表与桌面端一致：未知状态宁可继续等，也不要凭空报错。
        const rawStatus = String(data.status || '').trim().toLowerCase();
        let status = 'waiting';
        // 手机确认了但会话 cookie 还没到手（真正的下发在 redirect_url 上，见裁剪版签名层
        // 的 harvestRedirectCookies）：继续当 scanned 轮询，别在这里收尾 —— 一收尾轮询就停，
        // cookie 永远拿不到，表现就是「登录成功但什么数据都没有」。
        let waitingForCookie = false;
        if (errorCode === 2 || /^(4|5|expired|timeout)$/.test(rawStatus)) status = 'expired';
        else if (errorCode === 7) status = 'rate_limited';
        else if (/^(2|scanned|scan)$/.test(rawStatus)) status = 'scanned';
        else if (/^(3|confirmed|confirm)$/.test(rawStatus)) {
            status = 'scanned';
            waitingForCookie = true;
        }
        // 确认了却没拿到会话 Cookie：把两侧 cookie 的键名都带进 message，
        // 这样下一次诊断一眼能分清「宿主压根没 cookie」还是「有 cookie 但不含 sessionid」。
        const sessionKeys = cookieKeyNames(bridge.getCookie());
        const confirmedWithoutCookie = status === 'scanned' && waitingForCookie
            ? '手机已确认，正在等待下发会话 Cookie（config: ' + sessionKeys
                + ' / host: ' + hostCookieKeys() + '）'
            : '';
        return {
            provider: 'qishui',
            loggedIn: false,
            status,
            errorCode,
            error_code: errorCode,
            retryAfterMs: errorCode === 7 ? 60000 : 0,
            message: confirmedWithoutCookie || (result && result.message) || data.description || '',
            cookieKeys: sessionKeys,
            loginKeys: loginCookieKeys(bridge.getCookie()),
            hostCookieKeys: hostCookieKeys(),
        };
    },

    'login.logout': async () => {
        const api = qishuiApi;
        await qishuiQrLogin.clear();
        saveQishuiCookie('');
        // 协议层只清它自己那两份（config.cookie 与 COOKIE_FILE）；登录态还留在
        // 宿主的自攒罐与 WebView CookieManager 里，不清的话请求照样带旧会话。
        clearHostCookies();
        const cleared = api.clearQishuiAccessToken();
        const empty = api.getQishuiStatus('');
        return Object.assign({}, cleared, {
            webSession: false,
            cookieReady: false,
            configured: empty.configured,
            loggedIn: empty.loggedIn,
        });
    },

    search: params => {
        const p = params || {};
        const keywords = String(p.keywords || '');
        const limit = qishuiClampInt(p.limit, 12, 4, 20);
        const offset = qishuiClampInt(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        return qishuiApi.handleQishuiSearch(keywords, limit, readQishuiCookie(), offset);
    },

    artist: params => {
        const p = params || {};
        const artistId = String(p.artistId || '');
        const artistName = String(p.artistName || '');
        const limit = qishuiClampInt(p.limit, 36, 10, 50);
        if (!artistId && !artistName) throw qishuiBridgeFailure('missing-artist-id-or-name', '汽水音乐需要艺人 ID 或名称');
        return qishuiApi.handleQishuiArtistDetail({ artistId, artistName, limit }, readQishuiCookie());
    },

    'song.detail': params => qishuiApi.handleQishuiSongDetail(String((params && params.id) || '')),

    album: params => {
        const p = params || {};
        const id = String(p.id || '');
        const trackId = String(p.trackId || '');
        const limit = qishuiClampInt(p.limit, 80, 10, 120);
        if (!id && !trackId) throw qishuiBridgeFailure('missing-album-id', '汽水音乐需要专辑 ID 或曲目 ID');
        return qishuiApi.handleQishuiAlbumDetail(id, readQishuiCookie(), limit, trackId);
    },

    lyric: params => qishuiApi.handleQishuiLyric(String((params && params.id) || ''), readQishuiCookie()),

    'song.url': async params => {
        const p = params || {};
        const result = await qishuiApi.handleQishuiSongUrl({ id: String(p.id || ''), quality: String(p.quality || '') }, readQishuiCookie());
        if (!result || result.playable === false || !result.url) return result;
        // 与桌面桥唯一的「改写返回值」operation：上游直链带 #auth= 的交给原生
        // loopback 解密代理（AES-128-CTR），<audio> 只吃解密后的明文流。
        const text = String(result.url);
        const hashIndex = text.indexOf('#auth=');
        if (hashIndex < 0) return result;
        let auth = text.slice(hashIndex + 6);
        try { auth = decodeURIComponent(auth); } catch (_) { /* 保持原样 */ }
        const cleanUrl = text.slice(0, hashIndex);
        const host = window.FoliaQishuiHost;
        const proxyUrl = host && typeof host.audioProxyUrl === 'function'
            ? String(host.audioProxyUrl(cleanUrl, auth) || '')
            : '';
        if (!proxyUrl) return result;
        return Object.assign({}, result, {
            url: proxyUrl,
            upstreamUrl: cleanUrl,
            localProxy: true,
        });
    },

    feed: params => qishuiApi.handleQishuiFeed(qishuiClampInt((params || {}).limit, 8, 4, 12), readQishuiCookie()),

    'user.playlists': () => qishuiApi.handleQishuiUserPlaylists(readQishuiCookie()),

    'playlist.tracks': params => {
        const p = params || {};
        const id = String(p.id || '') || 'qishui-feed';
        const limit = qishuiClampInt(p.limit, 0, 0, Number.MAX_SAFE_INTEGER);
        const offset = qishuiClampInt(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        return qishuiApi.handleQishuiPlaylistTracks(id, limit || offset ? { limit: limit || 50, offset } : {}, readQishuiCookie());
    },

    'track.liked': params => {
        const raw = Array.isArray((params || {}).ids) ? params.ids.join(',') : String((params || {}).ids || '');
        const ids = raw.split(',').map(value => value.trim()).filter(Boolean);
        return qishuiApi.handleQishuiCheckTracksLiked(ids, readQishuiCookie());
    },

    'track.like': async params => {
        const p = params || {};
        const liked = String(p.liked != null ? p.liked : 'true') !== 'false';
        const result = await qishuiApi.handleQishuiSetTrackLiked(String(p.id || ''), liked, readQishuiCookie());
        return Object.assign({ success: true }, result);
    },

    'playlist.collect': async params => {
        const p = params || {};
        const collected = String(p.collected != null ? p.collected : 'true') !== 'false';
        const result = await qishuiApi.handleQishuiSetPlaylistCollected(String(p.id || ''), collected, readQishuiCookie());
        return Object.assign({ success: true }, result);
    },

    'playlist.addSong': params => {
        const p = params || {};
        return qishuiApi.handleQishuiPlaylistAddSong(String(p.playlistId || ''), String(p.trackId || ''), readQishuiCookie());
    },

    'album.collect': async params => {
        const p = params || {};
        const collected = String(p.collected != null ? p.collected : 'true') !== 'false';
        const result = await qishuiApi.handleQishuiSetAlbumCollected(String(p.id || ''), collected, readQishuiCookie());
        return Object.assign({ success: true }, result);
    },

    'report.play': params => qishuiApi.handleQishuiReportRecentlyPlayed(String((params || {}).trackId || ''), readQishuiCookie()),

    comments: params => {
        const p = params || {};
        const limit = qishuiClampInt(p.limit, 18, 1, 50);
        const sort = String(p.sort || '') || 'latest';
        return qishuiApi.handleQishuiComments(String(p.id || ''), { limit, cursor: '', sort }, readQishuiCookie());
    },

    'comment.create': params => {
        const p = params || {};
        return qishuiApi.handleQishuiCreateComment(String(p.id || ''), String(p.content || ''), readQishuiCookie());
    },
};

/**
 * 入参归一：原生把 params 直接当 JS 字面量拼进 evaluateJavascript 的脚本里，
 * 所以这里拿到的是**对象**而不是 JSON 字符串 —— 早先一律 JSON.parse 会把它
 * String() 成 "[object Object]" 再解析，必然抛错并悄悄落回空对象，
 * 表现就是「二维码登录 token 缺失」。两种形态都认。
 */
function normalizeParams(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch (_) { return {}; }
    }
    return {};
}

async function request(operation, params) {
    const name = String(operation || '');
    if (!Object.prototype.hasOwnProperty.call(handlers, name)) {
        return { ok: false, error: { code: 'unsupported', message: 'Unsupported qishui operation: ' + name } };
    }
    try {
        const data = await handlers[name](params && typeof params === 'object' ? params : {});
        const failed = QISHUI_RESULT_FAILURES[name];
        if (failed && failed(data)) return qishuiFailureFromResult(name, data);
        return { ok: true, data };
    } catch (error) {
        if (window.console && window.console.warn) {
            window.console.warn('[FoliaQishui] ' + name + ' failed:', (error && error.message) || error);
        }
        return qishuiFailureEnvelope(error, name);
    }
}

// ---- 对外入口 ------------------------------------------------------------

window.__foliaQishui = {
    async start(operation, params, ticket) {
        const envelope = await request(operation, normalizeParams(params));
        const host = window.FoliaQishuiHost;
        if (host && typeof host.resolve === 'function') {
            try {
                host.resolve(String(ticket), JSON.stringify(envelope));
            } catch (error) {
                // resolve 只可能因为序列化失败而抛；退回一个保守的信封。
                host.resolve(String(ticket), '{"ok":false,"error":{"code":"serialize-failed","message":"'
                    + String(error && error.message || error).replace(/[\\"]/g, ' ') + '"}}');
            }
        }
    },
};

// 原生把签名 WebView 拉成全屏的钩子：MFA 二次验证时由裁剪版签名层调用。
window.__foliaSetMfaVisible = function (visible) {
    const host = window.FoliaQishuiHost;
    if (host && typeof host.setMfaVisible === 'function') {
        try { host.setMfaVisible(visible ? '1' : '0'); } catch (_) {}
    }
};

// 页面与协议层都就绪了：告知原生（cookie 尚未必要，原生侧用的是宿主自己记的会话）。
(function announceReady() {
    const host = window.FoliaQishuiHost;
    if (host && typeof host.onReady === 'function') {
        try { host.onReady(''); } catch (_) {}
    }
})();
