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

// ---- operation 派发（照抄 qishuiApiBridge.cjs；song.url 见文件头说明）----

const handlers = {
    status: () => qishuiApi.handleQishuiStatus(readQishuiCookie()),

    'login.qr': async () => {
        const result = await qishuiQrLogin.createQrCode();
        const data = (result && result.data) || {};
        return {
            provider: 'qishui',
            token: String(data.token || ''),
            qrcode: String(data.qrcode || ''),
            qrcodeIndexUrl: String(data.qrcode_index_url || ''),
            expireTime: Number(data.expire_time || 0),
            message: '请使用抖音 App 扫码并确认登录',
        };
    },

    'login.check': async params => {
        const token = String((params && params.token) || '').trim();
        if (!token) throw qishuiBridgeFailure('missing-token', '二维码登录 token 缺失');
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
        if (bridge.getStatus().loggedIn) {
            const cookie = bridge.getCookie();
            if (!api.qishuiCookieHasLogin(cookie)) {
                throw qishuiBridgeFailure('qishui-qr-session-cookie-missing', '二维码登录未返回有效的会话 Cookie');
            }
            saveQishuiCookie(cookie);
            const status = await api.handleQishuiStatus(readQishuiCookie());
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
            });
        }
        // 状态词表与桌面端一致：未知状态宁可继续等，也不要凭空报错。
        const rawStatus = String(data.status || '').trim().toLowerCase();
        let status = 'waiting';
        if (errorCode === 2 || /^(4|5|expired|timeout)$/.test(rawStatus)) status = 'expired';
        else if (errorCode === 7) status = 'rate_limited';
        else if (/^(2|scanned|scan)$/.test(rawStatus)) status = 'scanned';
        else if (/^(3|confirmed|confirm)$/.test(rawStatus)) status = 'confirmed';
        return {
            provider: 'qishui',
            loggedIn: false,
            status,
            errorCode,
            error_code: errorCode,
            retryAfterMs: errorCode === 7 ? 60000 : 0,
            message: (result && result.message) || data.description || '',
        };
    },

    'login.logout': async () => {
        const api = qishuiApi;
        await qishuiQrLogin.clear();
        saveQishuiCookie('');
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

    'song.url': params => {
        const p = params || {};
        // 加密直链（#auth=）的解密代理由原生侧承接；这里原样透传。
        return qishuiApi.handleQishuiSongUrl({ id: String(p.id || ''), quality: String(p.quality || '') }, readQishuiCookie());
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
    async start(operation, paramsJson, ticket) {
        let params = {};
        if (paramsJson) {
            try { params = JSON.parse(paramsJson); } catch (_) { params = {}; }
        }
        const envelope = await request(operation, params);
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
