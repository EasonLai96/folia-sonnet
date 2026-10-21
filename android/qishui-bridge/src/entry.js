// android/qishui-bridge/src/entry.js
//
// 签名宿主页面的协议层入口（车机协议版）。
//
// 旧链路是 passport 扫码拿 cookie + /luna a_bogus 签名，而 /luna 现在只认
// bdms.node 的 X-Helios/X-Medusa（Windows x64 原生模块，安卓永远没有）→
// 「能登录、拿不到任何数据」。本版整体换成汽水**车机协议**
// （/api/luna/v1/platform，参考 GSQZ/qishui-music-api，MIT）：
//
//   - 扫码授权走 open.douyin.com/oauth（抖音 App 扫），换回 bd-ticket-guard 凭据，
//     签名用 WebCrypto 的 ECDSA P-256 —— 签名宿主页面里就有，不需要任何原生模块；
//   - 公共读取用客户端令牌（client token），不登录也能搜/看详情/听标准音质；
//   - 账号读取与写入（我的歌单/喜欢/最近播放/加删歌）用 ticket-guard。
//
// 不再使用的旧模块：qishui-api.js / qishui-qr-login.js / sdk-glue / bdms.js /
// react*。bootstrap.html 仍由 build.mjs 生成，但只剩两个脚本：folia-xhr.js（原生
// http 桥）与 protocol.js（本入口的打包产物）。
//
// 对外入口不变：window.__foliaQishui.start(operation, paramsJson, ticket)，
// 结果经 FoliaQishuiHost.resolve(ticket, envelopeJson) 回原生，信封仍是
// { ok, data } / { ok, error }，渲染层零改动。

import { createQishuiCar } from './car/api.js';
import { QISHUI_FEED_ID, QISHUI_LIKED_ID } from './car/api.js';

const car = createQishuiCar({ log: message => console.info(message) });

// ---- 信封与失败归一（字段与渲染层 qishuiTransport 的错误码表对齐）-----------

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

function failureEnvelope(code, message) {
    return {
        ok: false,
        error: {
            code: qishuiErrorCode(code) || 'qishui-error',
            message: String(message || code || 'Qishui request failed'),
        },
    };
}

// 车机协议错误码 → 渲染层认的词表（qishuiTransport.toQishuiErrorCode）。
// auth-required 是最常见的：未扫码就点进账号功能。
function envelopeFromCarError(error, operation) {
    const code = error && error.code ? qishuiErrorCode(error.code) : '';
    const stage = error && error.stage ? ` (${error.stage})` : '';
    const upstream = error && error.upstreamCode ? ` [${error.upstreamCode}]` : '';
    const message = String((error && error.message) || `Qishui ${operation} failed`) + stage + upstream;
    if (code === 'auth-required') return failureEnvelope('login-required', message);
    if (code === 'network') return failureEnvelope('network', message);
    if (code === 'not-playable' || code === 'unsupported') return failureEnvelope(code, message);
    return failureEnvelope(code || 'qishui-error', message);
}

// 渲染层会把 200 + error 字段的数据级错误再判一次（throwQishuiDataError），
// 派发层就不重复造这个形状了：失败一律走 { ok:false } 信封。

// ---- operation 派发 --------------------------------------------------------
//
// operation 名与参数名就是渲染层 qishuiTransport 冻结的那一套契约；不支持的
// operation（专辑 / 收藏歌单 / 评论：车机协议没有这些端点）给明确错误，
// 不静默返回空。

const handlers = {
    status: () => car.status(),

    'login.qr': async () => {
        const result = await car.startLogin();
        return {
            provider: 'qishui',
            token: result.key,
            qrcode: result.qrDataUrl,
            qrDataUrl: result.qrDataUrl,
            expireTime: 300,
            message: '请使用抖音/汽水音乐 App 扫码并确认授权',
        };
    },

    'login.check': async params => {
        const token = String((params && params.token) || '').trim();
        if (!token) {
            const keys = Object.keys(params && typeof params === 'object' ? params : {}).join(',') || '(empty)';
            throw Object.assign(new Error('二维码登录 token 缺失（params keys: ' + keys + '）'), { code: 'missing-token' });
        }
        // 状态词表与渲染层一致：confirmed 之外的状态原样映射，未知状态继续等。
        const result = await car.checkLogin(token);
        if (result.state === 'error' && result.failure?.case === 'refused') {
            return { provider: 'qishui', status: 'error', errorCode: 0, message: '授权被拒绝，请重试' };
        }
        const statusMap = { waiting: 'waiting', scanned: 'scanned', confirmed: 'confirmed', expired: 'expired' };
        const status = statusMap[result.state] || 'waiting';
        if (result.state === 'confirmed') {
            // 确认即凭据已入库（auth.check 内完成），这里补一次 status 让上层立刻有账号。
            const statusData = await car.status();
            return Object.assign({}, statusData, {
                provider: 'qishui',
                ok: true,
                status: 'confirmed',
                errorCode: 0,
                error_code: 0,
                message: '登录成功',
            });
        }
        return {
            provider: 'qishui',
            loggedIn: false,
            status,
            errorCode: 0,
            error_code: 0,
            retryAfterMs: 0,
            message: status === 'expired' ? '二维码已过期，请重新生成' : '',
        };
    },

    'login.logout': () => car.logout(),

    // 凭据在 App 侧也留一份（跨重启用）：桥自己那份存储读不回来时，启动时灌回去。
    'session.export': () => car.exportSession(),
    'session.import': params => car.importSession(params && params.credential),

    search: params => {
        const p = params || {};
        const keywords = String(p.keywords || p.query || '');
        const limit = qishuiClampInt(p.limit, 12, 4, 20);
        const offset = qishuiClampInt(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        return car.search(keywords, limit, offset);
    },

    // 车机没有专辑端点；专辑入口在这里明确拒绝（上层把它显示为「暂不支持」，
    // 比静默空列表诚实）。单曲详情可以回，专辑聚合不行。
    album: () => {
        throw Object.assign(new Error('汽水车机协议没有专辑接口'), { code: 'unsupported' });
    },

    'song.detail': params => car.songDetail(String((params && params.id) || '')),

    lyric: params => car.lyrics(String((params && params.id) || '')),

    'song.url': async params => {
        const p = params || {};
        // 渲染层的音质档（standard/high/ultra/lossless/hires）直接下传，
        // playback.js 内部会折算到车机的档位。
        return car.audio(String(p.id || ''), String(p.quality || 'standard'));
    },

    artist: params => {
        const p = params || {};
        const artistId = String(p.artistId || '');
        if (!artistId) {
            throw Object.assign(new Error('汽水音乐需要艺人 ID'), { code: 'missing-artist-id' });
        }
        const limit = qishuiClampInt(p.limit, 36, 10, 50);
        return car.artist(artistId, limit, 0);
    },

    feed: params => car.feed(qishuiClampInt((params || {}).limit, 8, 4, 12)),

    'user.playlists': () => car.userPlaylists(500, 0),

    'playlist.tracks': params => {
        const p = params || {};
        const id = String(p.id || '') || QISHUI_FEED_ID;
        const limit = qishuiClampInt(p.limit, 50, 1, Number.MAX_SAFE_INTEGER);
        const offset = qishuiClampInt(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        return car.playlistTracks(id, limit, offset);
    },

    'track.liked': async params => {
        const raw = Array.isArray((params || {}).ids) ? params.ids.join(',') : String((params || {}).ids || '');
        const ids = raw.split(',').map(value => value.trim()).filter(Boolean);
        const result = await car.checkTracks(ids);
        // 渲染层要的形状：{ id, liked }[]（risk_result 0 = 无风险即可播/已收藏口径
        // 车机不给，统一按「可播」回，喜欢状态由 likedSongs 单独拉）。
        return {
            provider: 'qishui',
            statuses: result.statuses,
        };
    },

    'track.like': async params => {
        const p = params || {};
        const liked = String(p.liked != null ? p.liked : 'true') !== 'false';
        return car.likeSong(String(p.id || ''), liked);
    },

    'playlist.collect': () => {
        throw Object.assign(new Error('汽水车机协议不支持收藏歌单'), { code: 'unsupported' });
    },

    'playlist.addSong': async params => {
        const p = params || {};
        return car.addSongs(String(p.playlistId || ''), [String(p.trackId || '')].filter(Boolean));
    },

    'album.collect': () => {
        throw Object.assign(new Error('汽水车机协议不支持收藏专辑'), { code: 'unsupported' });
    },

    'report.play': () => ({ provider: 'qishui', success: true, note: 'car protocol has no play report endpoint' }),

    comments: () => {
        throw Object.assign(new Error('汽水车机协议没有评论接口'), { code: 'unsupported' });
    },

    'comment.create': () => {
        throw Object.assign(new Error('汽水车机协议没有评论接口'), { code: 'unsupported' });
    },
};

/**
 * 入参归一：原生把 params 直接当 JS 字面量拼进 evaluateJavascript 的脚本里，
 * 所以这里拿到的是**对象**而不是 JSON 字符串 —— 一律 JSON.parse 会把它
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
        return failureEnvelope('unsupported', 'Unsupported qishui operation: ' + name);
    }
    try {
        const data = await handlers[name](params && typeof params === 'object' ? params : {});
        return { ok: true, data };
    } catch (error) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[FoliaQishui] ' + name + ' failed:', (error && error.message) || error);
        }
        return envelopeFromCarError(error, name);
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

// 车机协议全程不需要用户在页面上交互（扫码图由渲染层展示），MFA 全屏钩子保留
// 一个空实现：旧裁剪签名层还可能调用它，新协议不会，但留空比删掉安全（宿主侧
// 的 setMfaVisible 接口仍在）。
window.__foliaSetMfaVisible = function () {};

// 页面与协议层都就绪了：告知原生。
(function announceReady() {
    const host = window.FoliaQishuiHost;
    if (host && typeof host.onReady === 'function') {
        try { host.onReady(''); } catch (_) {}
    }
})();
