// android/qishui-bridge/src/phone/auth.js
//
// 手机协议的登录：passport 扫码（/passport/web/get_qrcode/ + check_qrconnect/）换会话 Cookie。
//
// 与 car/auth.js 的形状对齐（start / qr / check / cancel / logout），好让上层
// （api.js 与 entry.js）不必为两套协议分叉。
//
// ⚠ 免签名：出码与轮询都不带 a_bogus / msToken，实测照常工作（见 protocol.js 顶部）。
// 桌面端的隐藏窗签名引擎（sdk-glue / bdms）不在这里复活 —— 它是 Windows x64 的
// 原生模块依赖，安卓永远没有。
//
// Cookie 从三个地方凑（顺序即优先级）：
//   1. 响应体里的 session_cookie 字段（有时给）；
//   2. 响应头 / 宿主罐里的 Set-Cookie（**主要来源**：passport 用 Set-Cookie 下发，
//      OkHttp 收到后由 Java 侧转进 CookieManager，只能从 getCookie() 回读）；
//   3. 确认后给的 redirect_url —— 会话 Cookie 常常只挂在它上面，要原样 GET 一次
//      才能把 Set-Cookie 收进罐子（少了这一步，手里只有扫码前就有的 sid_tt，
//      登录判定会被骗过，而 /luna 回 1000016）。

import {
    QR_TTL_MS, QISHUI_PHONE_API_BASE, cookieFromSetCookie, hasLoginCookie, hostCookies,
    parseCookieString, buildCookieString, passportRequest, randomDigits, randomHex,
    QISHUI_LOGIN_COOKIE_KEYS,
} from './protocol.js';
import { DEVICE_KEY, SESSION_KEY, readJson, writeJson, remove } from './storage.js';

const text = value => (value == null ? '' : String(value));

/** 设备身份：生成一次就存起来，每次启动换一套会被上游判成风险设备。 */
export function createIdentity() {
    let identity = readJson(DEVICE_KEY, null);
    const reused = Boolean(identity && /^\d{19}$/.test(text(identity.deviceId)));
    if (!reused) {
        identity = {
            deviceId: randomDigits(19),
            installId: randomDigits(15),
            verifyPortraitId: `${randomHex(8)}.login`,
        };
        writeJson(DEVICE_KEY, identity);
    }
    return { ...identity, reused };
}

export function createAuth(fetcher, { log = () => {} } = {}) {
    const identity = createIdentity();

    // 待扫的二维码：key → { imageUrl, expiresAt }。渲染层先拿 key 再取图
    // （Omni 那套是两步），所以这里要留一份。
    const pending = new Map();

    const readSession = () => {
        const value = readJson(SESSION_KEY, null);
        return value && typeof value === 'object' ? value : null;
    };
    const writeSession = value => (value ? writeJson(SESSION_KEY, value) : remove(SESSION_KEY));

    const cookie = () => text(readSession()?.cookie);

    /** 把三处凑到的 Cookie 并进当前会话；返回并完之后是否真的有登录键。 */
    const mergeCookie = parts => {
        const merged = parseCookieString(cookie());
        for (const part of parts) {
            Object.assign(merged, parseCookieString(part));
        }
        const next = buildCookieString(merged);
        const session = readSession() || {};
        writeSession({ ...session, cookie: next, savedAt: Date.now() });
        return hasLoginCookie(next);
    };

    const harvestRedirect = async url => {
        const target = text(url);
        if (!/^https?:\/\//i.test(target)) return '';
        try {
            const response = await fetcher(target, {
                method: 'GET',
                headers: {
                    Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                        + '(KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 Safari/537.36',
                },
            });
            await response.text().catch(() => '');
            return hostCookies();
        } catch (_) {
            return '';
        }
    };

    /** 确认之后把 Cookie 从三个来源都收一遍。 */
    const collectAfterConfirm = async (data, envelope, setCookie) => {
        const parts = [];
        // 1. 响应体里直接给的字段。
        const direct = {};
        for (const key of QISHUI_LOGIN_COOKIE_KEYS) {
            const value = data[key] ?? envelope[key];
            if (typeof value === 'string' && value) direct[key] = value;
        }
        if (text(data.session_cookie)) parts.push(data.session_cookie);
        if (Object.keys(direct).length) parts.push(buildCookieString(direct));
        // 2. 响应头（Java 侧只回第一条）与宿主罐。
        if (setCookie) parts.push(cookieFromSetCookie(setCookie));
        parts.push(hostCookies());
        // 3. 确认后给的跳转地址：真正下会话 Cookie 的地方。
        const redirect = text(data.redirect_url || data.redirect);
        if (redirect) parts.push(await harvestRedirect(redirect));
        return mergeCookie(parts);
    };

    const clean = () => {
        for (const [key, value] of pending) {
            if (value.expiresAt <= Date.now()) pending.delete(key);
        }
    };

    return {
        identity,

        cookie,

        /** 登录判定：手里有没有真的会话 Cookie（不只是 sid_tt 那种跟踪键）。 */
        isLoggedIn: () => hasLoginCookie(cookie()),

        /**
         * 诊断用：两个登录键各在不在。
         *
         * 「有 sid_tt 但没 sessionid」是这一路最会骗人的中间态 —— 扫码前 sid_tt
         * 就已经下发，登录判定只认「任一登录键命中」就会被它骗过。
         */
        loginKeys: () => {
            const values = parseCookieString(cookie());
            return QISHUI_LOGIN_COOKIE_KEYS.map(name => `${name}${values[name] ? '=y' : '=n'}`).join(' ');
        },

        cookieKeys: () => Object.keys(parseCookieString(cookie())).join(',') || '(empty)',

        async start() {
            clean();
            const { json, setCookie } = await passportRequest(fetcher, {
                identity,
                method: 'GET',
                path: '/passport/web/get_qrcode/',
                params: { next: QISHUI_PHONE_API_BASE, need_logo: 'false', need_short_url: 'false' },
            });
            const data = json?.data || {};
            if (json?.message !== 'success' || Number(data.error_code) !== 0) {
                const error = new Error(`汽水二维码生成失败：code=${data.error_code} ${text(data.description)}`);
                error.code = 'invalid-response';
                throw error;
            }
            // get_qrcode 就已经开始下发 Cookie（sid_tt 等），收下来：确认那一步要拿它去换会话。
            if (setCookie) mergeCookie([cookieFromSetCookie(setCookie), hostCookies()]);
            const imageUrl = text(data.qrcode);
            const key = text(data.token);
            if (!key || !imageUrl) {
                const error = new Error('汽水二维码返回不完整（缺 token 或 qrcode）');
                error.code = 'invalid-response';
                throw error;
            }
            // expire_time 是**秒级时间戳**；给不出来（0 / 空）就按 5 分钟。
            const expireSeconds = Number(data.expire_time);
            const expiresAt = Number.isFinite(expireSeconds) && expireSeconds > 1e9
                ? expireSeconds * 1000 : Date.now() + QR_TTL_MS;
            pending.set(key, { imageUrl, expiresAt });
            return { key, imageUrl, expiresAt, copywriting: text(data.copywriting), webName: text(data.web_name) };
        },

        qr(key) {
            const entry = pending.get(text(key));
            if (!entry) {
                const error = new Error('QISHUI_QR_TOKEN_REQUIRED');
                error.code = 'invalid-response';
                throw error;
            }
            return { imageUrl: entry.imageUrl, expiresAt: entry.expiresAt };
        },

        async check(key) {
            const token = text(key);
            if (!token) {
                const error = new Error('QISHUI_QR_TOKEN_REQUIRED');
                error.code = 'invalid-response';
                throw error;
            }
            const { json, setCookie } = await passportRequest(fetcher, {
                identity,
                method: 'POST',
                path: '/passport/web/check_qrconnect/',
                body: {
                    need_logo: 'false',
                    need_short_url: 'false',
                    is_frontier: 'true',
                    token,
                    is_new_login: '1',
                    next: QISHUI_PHONE_API_BASE,
                },
            });
            const data = json?.data || {};
            const errorCode = Number(data.error_code || 0);
            const rawStatus = text(data.status).trim().toLowerCase();

            // 二次验证（设备校验）：桌面端靠一个隐藏窗跑安全验证 SDK，安卓没有这一套，
            // 也不能伪造 —— 明确告诉用户「换一种方式」而不是干等。
            if (errorCode === 2046) {
                return { state: 'error', failure: { case: 'refused', message: '汽水要求设备二次验证，请改用其它登录方式' } };
            }

            const confirmed = rawStatus === '3' || rawStatus === 'confirmed' || Boolean(data.session_cookie);
            if (confirmed) {
                const ready = await collectAfterConfirm(data, json, setCookie);
                // ⚠ 确认了但 Cookie 还没到手：继续当「已扫码」轮询，别在这里收尾 ——
                // 一收尾轮询就停，Cookie 永远拿不到，表现就是「确认了但什么数据都没有」。
                if (!ready) return { state: 'scanned', waitingForCookie: true };
                pending.delete(token);
                return { state: 'confirmed' };
            }
            if (errorCode === 2 || /^(4|5|expired|timeout)$/.test(rawStatus)) return { state: 'expired' };
            if (errorCode === 7) return { state: 'error', failure: { case: 'rate-limited', message: '扫码过于频繁，请稍后再试' } };
            if (/^(2|scanned|scan)$/.test(rawStatus)) return { state: 'scanned' };
            // 未知状态（上游未扫码时给的是 `new`）一律继续等：把它当失败会让 UI 在
            // 用户还没扫码时就显示「登录错误」。
            return { state: 'waiting' };
        },

        cancel(key) { pending.delete(text(key)); },

        logout() {
            pending.clear();
            remove(SESSION_KEY);
            // 宿主罐里那一份也要清：只清协议层自己那份的话，请求发出去仍然带着旧会话
            // →「点了退出却还登着」，下一次扫码也会撞上一个会话。
            try {
                const host = typeof window !== 'undefined' ? window.FoliaQishuiHost : null;
                if (host && typeof host.clearCookies === 'function') host.clearCookies();
            } catch (_) { /* 清不掉也不算退出失败 */ }
            return { provider: 'qishui', loggedIn: false };
        },

        /** 交给渲染层在 App 侧再存一份（跨重启用，与车机那套同一条理由）。 */
        exportSession() {
            const session = readSession();
            return { provider: 'qishui', protocol: 'passport-web', credential: session?.cookie ? session : null };
        },

        /**
         * 灌回一份会话。
         *
         * ⚠ 不是无条件覆盖：渲染层每次查登录态都会先灌一次，而桥这份可能是刚确认过的。
         * 只在「桥现在没有」或「灌进来的这份更晚」时才真的写。
         */
        importSession(credential) {
            const value = credential && typeof credential === 'object' ? credential : null;
            if (!value || !hasLoginCookie(text(value.cookie))) {
                return { provider: 'qishui', restored: false, reason: 'the saved session has no login cookie' };
            }
            const current = readSession();
            if (hasLoginCookie(text(current?.cookie)) && Number(value.savedAt || 0) <= Number(current?.savedAt || 0)) {
                return { provider: 'qishui', restored: false, kept: true, reason: 'the bridge already holds this session' };
            }
            writeSession(value);
            log('[Qishui] the phone-protocol session kept by the app was put back into the bridge');
            return { provider: 'qishui', restored: true };
        },

        /** 直接给一段 Cookie（手动粘贴那一条路：跳过扫码，直接把会话灌进来）。 */
        importCookie(raw) {
            const ready = mergeCookie([text(raw)]);
            if (!ready) return { provider: 'qishui', restored: false, reason: 'the pasted cookie has no login key' };
            return { provider: 'qishui', restored: true };
        },
    };
}

export default { createAuth, createIdentity };
