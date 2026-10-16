// android/qishui-bridge/src/qishui-auth-android.js
//
// electron/qishui/qishui-auth-v6.js 的安卓裁剪版。差异全部源于运行环境：
//
//   桌面                          →  安卓（签名宿主页面内）
//   ─────────────────────────────────────────────────────────────────────
//   隐藏 BrowserWindow             →  当前页面本身就是签名页（bootstrap.html）
//   asset server + session hooks  →  QishuiSignHost 的 shouldInterceptRequest
//   window.webContents.execute... →  同页面直接调用 window.__qishuiRequest 等
//   authSession.cookies           →  config.cookie（qr-login 已负责持久化）
//   bdms.node 原生签名分支        →  删除（.node 是 Windows x64 专用；
//                                     官方本来就支持回退隐藏窗 a_bogus 路径）
//   lastPassportRequest 钩子      →  folia-xhr.js 的 __foliaXhrLog
//   security_seed.html 种 msToken →  folia-xhr.js 在 sdk-glue 之前预置
//
// 与上游同步时只需要比对这些差异点；协议接口（getQrCode / checkQrConnect /
// requestOfficial / clear / configure）保持一致。

import * as crypto from './shims/crypto.js';
import QRCode from 'qrcode/lib/browser.js';

const API_BASE = 'https://api.qishui.com';
const AID = '386088';
const APP_VERSION = '3.5.2';
const SDK_VERSION = '2.4.13';
const VERIFY_SDK_VERSION = '1.0.29';
const SECURE_SDK_VERSION = '3.3.5';
const BDMS_VERSION = '1.0.0.41';

// UA：与 QishuiSignHost 的 WebSettings UA 保持字面一致 —— 指纹与签名必须同源。
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 ' +
    'Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36';

let getConfig = null;
let updateConfig = null;
let runtime = null;

function configure(hooks) {
    getConfig = hooks && hooks.getConfig;
    updateConfig = hooks && hooks.updateConfig;
}

function randomDigits(length, firstMax = 9) {
    let value = String(crypto.randomInt(1, Math.max(2, firstMax + 1)));
    while (value.length < length) value += String(crypto.randomInt(0, 10));
    return value;
}

function ensureIdentity() {
    if (typeof getConfig !== 'function' || typeof updateConfig !== 'function') {
        throw new Error('Qishui auth runtime is not configured');
    }
    const config = getConfig();
    const patch = {};
    if (!config.deviceId) patch.deviceId = randomDigits(16, 8);
    if (!config.installId) patch.installId = randomDigits(15, 8);
    if (!config.verifyPortraitId) patch.verifyPortraitId = crypto.randomUUID() + '.login';
    if (!config.computerName) patch.computerName = 'Folia-Android';
    if (Object.keys(patch).length) updateConfig(patch);
    const current = getConfig();
    return {
        deviceId: String(current.deviceId),
        installId: String(current.installId),
        verifyPortraitId: String(current.verifyPortraitId),
        computerName: String(current.computerName || 'Folia-Android'),
    };
}

function normalizeBizParams(value) {
    if (!value) return {};
    let source = value;
    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch (_) {
            const parsed = new URLSearchParams(source);
            return Object.fromEntries(parsed.entries());
        }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('二次验证 biz_params 格式无效');
    }
    const result = {};
    for (const [key, item] of Object.entries(source)) {
        if (item == null) continue;
        result[String(key)] = typeof item === 'object' ? JSON.stringify(item) : String(item);
    }
    return result;
}

function mergeDecision(envelope) {
    const data = envelope && envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
    const decision = { ...(envelope || {}), ...data };
    delete decision.data;
    return decision;
}

function officialScanUrl(indexUrl, computerName) {
    const source = new URL(String(indexUrl || ''));
    const token = source.searchParams.get('token');
    if (!token) throw new Error('qrcode_index_url 缺少 token');
    const target = new URL('https://bff-pc.qishui.com/light/invoke/scan_login');
    target.searchParams.set('token', token);
    target.searchParams.set('os', 'Windows');
    target.searchParams.set('computer_name', computerName || 'Folia-Android');
    return target.toString().replace(/\+/g, '%20');
}

function parseCookieString(raw) {
    const result = {};
    String(raw || '').split(';').forEach(pair => {
        const index = pair.indexOf('=');
        if (index > 0) result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    });
    return result;
}

function buildCookieString(values) {
    return Object.entries(values)
        .filter(([name]) => name)
        .map(([name, value]) => name + '=' + value)
        .join('; ');
}

// 最近一次命中 needle 的 XHR 记录（folia-xhr.js 在 open/send 时记录）。
function lastXhrEntry(needle) {
    const log = window.__foliaXhrLog || [];
    for (let i = log.length - 1; i >= 0; i--) {
        if (log[i] && needle.test(String(log[i].url || ''))) return log[i];
    }
    return null;
}

function readMsToken() {
    try {
        const stored = window.localStorage.getItem('xmst') || window.localStorage.getItem('xmsty') || '';
        return /^[A-Za-z0-9_-]{118}==$/.test(stored) ? stored : '';
    } catch (_) {
        return '';
    }
}

function pageRequest(payload) {
    if (typeof window.__qishuiRequest !== 'function') {
        return Promise.reject(new Error('签名页面的 __qishuiRequest 未就绪'));
    }
    try {
        return Promise.resolve(window.__qishuiRequest(payload));
    } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
}

class QishuiAuthRuntime {
    constructor() {
        this.browserInfo = null;
        this.initializing = null;
    }

    async initialize() {
        if (this.browserInfo && readMsToken()) return true;
        if (this.initializing) return this.initializing;
        this.initializing = this._initialize().finally(() => { this.initializing = null; });
        return this.initializing;
    }

    async _initialize() {
        ensureIdentity();
        await this.waitForBdms();
        this.browserInfo = await window.__qishuiBrowserInfo();
        if (typeof updateConfig === 'function') updateConfig({ msToken: readMsToken() });
        return true;
    }

    async waitForBdms(timeoutMs = 20000) {
        const deadline = Date.now() + timeoutMs;
        let last = null;
        while (Date.now() < deadline) {
            last = {
                glue: window._sdkGlueVersionMap && window._sdkGlueVersionMap.sdkGlueVersion,
                bdms: window._sdkGlueVersionMap && window._sdkGlueVersionMap.bdmsVersion,
                loaded: Boolean(window.bdms),
            };
            if (last.loaded && last.bdms) return last;
            await delay(100);
        }
        throw new Error('汽水安全组件初始化超时：bdms 1.0.0.41 未就绪');
    }

    commonParams(identity) {
        const info = this.browserInfo || { encrypted: '' };
        return {
            passport_jssdk_version: SDK_VERSION,
            passport_jssdk_type: 'normal',
            is_from_ttaccountsdk: '1',
            aid: AID,
            language: 'zh',
            account_sdk_source: 'web',
            p_js_v: SDK_VERSION,
            p_js_t: 'pro',
            p_zt: SECURE_SDK_VERSION,
            p_ver: VERIFY_SDK_VERSION,
            request_host: 'app%3A%2F%2Fresources',
            p_bd: BDMS_VERSION,
            biz_trace_id: crypto.randomBytes(4).toString('hex'),
            is_new_login: '1',
            is_from_iesaccountsaas: '1',
            device_id: identity.deviceId,
            install_id: identity.installId,
            did: identity.deviceId,
            iid: identity.installId,
            device_platform: 'PC',
            version_code: APP_VERSION,
            account_sdk_source_info: String(info.encrypted),
            msToken: readMsToken(),
        };
    }

    requestHeaders(identity, bizTraceId) {
        const traceId = crypto.randomBytes(16).toString('hex');
        return {
            Accept: 'application/json, text/javascript',
            'User-Agent': UA,
            'x-tt-passport-verify-portrait': identity.verifyPortraitId,
            'x-tt-passport-trace-id': bizTraceId,
            'x-tt-trace-id': '00-' + traceId + '-' + traceId.slice(0, 16) + '-01',
        };
    }

    async request(method, pathname, params, data) {
        await this.initialize();
        const identity = ensureIdentity();
        const query = { ...this.commonParams(identity), ...(params || {}) };
        const url = new URL(pathname, API_BASE);
        for (const [name, value] of Object.entries(query)) {
            if (value != null) url.searchParams.set(name, String(value));
        }
        const headers = this.requestHeaders(identity, query.biz_trace_id);
        let body = null;
        if (data != null) {
            body = new URLSearchParams();
            for (const [name, value] of Object.entries(data)) {
                if (value != null) body.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
            }
            body = body.toString();
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            headers['x-ss-stub'] = crypto.createHash('md5').update(body).digest('hex').toUpperCase();
        }
        const payload = {
            method: String(method || 'GET').toUpperCase(),
            url: url.toString(),
            headers,
            body,
            timeout: 30000,
        };
        const response = await pageRequest(payload);
        if (!response || response.status < 200 || response.status >= 400) {
            throw new Error('汽水登录接口 HTTP ' + (response && response.status || 0) + ': '
                + String(response && response.body || '').slice(0, 300));
        }
        let envelope;
        try {
            envelope = JSON.parse(response.body || '{}');
        } catch (_) {
            throw new Error('汽水登录接口返回了无效 JSON');
        }
        const passportEntry = lastXhrEntry(/\/passport\//i);
        const signedQuery = (() => {
            try { return new URL(String(passportEntry && passportEntry.url || '')).searchParams; }
            catch (_) { return new URLSearchParams(); }
        })();
        const aBogus = signedQuery.get('a_bogus') || '';
        const signedMsToken = signedQuery.get('msToken') || '';
        if (aBogus.length !== 44 || signedMsToken !== readMsToken()) {
            throw new Error('汽水安全参数注入失败：a_bogus 或 msToken 缺失');
        }
        return envelope;
    }

    // 桌面端把 config.cookie 同步进 authSession；安卓没有独立 cookie 罐，
    // 直接并回 config（qr-login 会持久化），发请求时显式放进 Cookie 头。
    async syncSessionCookies(cookieText) {
        const incoming = parseCookieString(cookieText);
        if (!Object.keys(incoming).length) return;
        const current = parseCookieString(getConfig().cookie || '');
        Object.assign(current, incoming);
        updateConfig({ cookie: buildCookieString(current) });
    }

    async requestOfficial(method, targetUrl, options = {}) {
        await this.initialize();
        const identity = ensureIdentity();
        let url;
        try { url = new URL(String(targetUrl)); } catch (_) {
            const error = new Error('汽水官方请求 URL 无效');
            error.code = 'QISHUI_OFFICIAL_URL_INVALID';
            throw error;
        }
        if (!/^https:\/\/(?:api|api5-lq)\.qishui\.com$/i.test(url.origin)) {
            const error = new Error('汽水官方请求目标不受支持');
            error.code = 'QISHUI_OFFICIAL_HOST_UNSUPPORTED';
            throw error;
        }
        if (url.searchParams.has('device_id')) url.searchParams.set('device_id', identity.deviceId);
        if (url.searchParams.has('iid')) url.searchParams.set('iid', identity.installId);
        if (url.searchParams.has('did')) url.searchParams.set('did', identity.deviceId);
        if (url.searchParams.has('fp')) url.searchParams.set('fp', identity.deviceId);
        const msToken = readMsToken();
        if (msToken && !url.searchParams.has('msToken')) url.searchParams.set('msToken', msToken);
        await this.syncSessionCookies(options.cookie || '');

        const headers = { ...(options.headers || {}) };
        ['Cookie', 'Host', 'Content-Length', 'Origin', 'Referer', 'User-Agent'].forEach(name => {
            delete headers[name];
            delete headers[name.toLowerCase()];
        });
        // 登录态：桌面端靠 authSession 的 withCredentials 自动带上，安卓在请求头里显式给。
        const cookie = String((getConfig() || {}).cookie || '').trim();
        if (cookie) headers['Cookie'] = cookie;
        const payload = {
            method: String(method || 'GET').toUpperCase(),
            url: url.toString(),
            headers,
            body: options.body == null ? null : String(options.body),
            timeout: Number(options.timeoutMs) || 20000,
            withCredentials: false,
        };
        const response = await pageRequest(payload);
        if (!response || response.status < 200 || response.status >= 400) {
            const error = new Error('汽水官方接口 HTTP ' + (response && response.status || 0));
            error.code = 'QISHUI_OFFICIAL_HTTP_FAILED';
            error.statusCode = response && response.status || 0;
            throw error;
        }
        if (!String(response.body || '').trim()) {
            const error = new Error('汽水官方接口返回空响应');
            error.code = 'QISHUI_OFFICIAL_EMPTY_RESPONSE';
            error.statusCode = response.status;
            throw error;
        }
        const apiEntry = lastXhrEntry(/api\d?-lq?\.qishui\.com|\/luna\//i);
        return {
            ...response,
            requestUrl: String(apiEntry && apiEntry.url || url.toString()),
        };
    }

    async getQrCode() {
        await this.initialize();
        const identity = ensureIdentity();
        const envelope = await this.request('GET', '/passport/web/get_qrcode/', {
            next: API_BASE,
            need_logo: 'false',
            need_short_url: 'false',
        });
        const data = envelope.data || {};
        if (envelope.message !== 'success' || Number(data.error_code) !== 0) {
            throw new Error('二维码生成失败：code=' + data.error_code + ' ' + (data.description || envelope.message || ''));
        }
        const scanUrl = officialScanUrl(data.qrcode_index_url, identity.computerName);
        const qrDataUrl = await QRCode.toDataURL(scanUrl, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 360,
            color: { dark: '#000000', light: '#ffffff' },
        });
        envelope.data = { ...data, qrcode: qrDataUrl, scan_url: scanUrl };
        return envelope;
    }

    async secondVerify(decision, identity) {
        // 与桌面端的差别：安卓没有可弹出的独立窗口，验证组件直接在签名页里渲染。
        // 签名 WebView 是隐藏的 1x1，MFA 交互靠 QishuiSignHost 收到 requireVisible
        // 后把它放大到全屏（见 foliaQishuiRuntime.mfaVisibility）。
        if (typeof window.__foliaSetMfaVisible === 'function') {
            try { window.__foliaSetMfaVisible(true); } catch (_) {}
        }
        try {
            return await window.__qishuiSecondVerify(
                decision,
                { generalParams: {
                    device_id: identity.deviceId,
                    install_id: identity.installId,
                    did: identity.deviceId,
                    iid: identity.installId,
                    device_platform: 'PC',
                    version_code: APP_VERSION,
                } },
            );
        } finally {
            if (typeof window.__foliaSetMfaVisible === 'function') {
                try { window.__foliaSetMfaVisible(false); } catch (_) {}
            }
        }
    }

    async checkQrConnect(token) {
        await this.initialize();
        const identity = ensureIdentity();
        const body = {
            need_logo: 'false',
            need_short_url: 'false',
            is_frontier: 'true',
            token: String(token || ''),
            is_new_login: '1',
            next: API_BASE,
        };
        let envelope = await this.request('POST', '/passport/web/check_qrconnect/', {}, body);
        let data = envelope.data || {};
        if (Number(data.error_code) === 2046) {
            const decision = mergeDecision(envelope);
            if (!decision.verify_portrait_id) decision.verify_portrait_id = identity.verifyPortraitId;
            const bizParams = normalizeBizParams(decision.biz_params);
            const verified = await this.secondVerify(decision, identity);
            if (!verified || verified.status !== true) {
                const error = new Error(verified && verified.message || '二次验证未完成');
                error.code = 'QISHUI_MFA_CANCELLED';
                throw error;
            }
            envelope = await this.request(
                'POST',
                '/passport/web/check_qrconnect/',
                { isResend: 'true' },
                { ...body, ...bizParams },
            );
            data = envelope.data || {};
            if (Number(data.error_code) === 2046) {
                throw new Error('二次验证已通过，但服务端仍返回 2046；请重新刷新二维码');
            }
        }
        if (Number(data.error_code) === 0 && (String(data.status) === '3' || String(data.status) === 'confirmed' || data.session_cookie)) {
            await this.persistSessionCookies(data.session_cookie || '');
        }
        return envelope;
    }

    async persistSessionCookies(sessionCookie) {
        const current = parseCookieString(getConfig().cookie || '');
        Object.assign(current, parseCookieString(sessionCookie));
        updateConfig({ cookie: buildCookieString(current), msToken: readMsToken() });
    }

    async clear() {
        // 退出登录：抹掉 config（qr-login 会再补一份空配置）与签名页里的会话痕迹。
        // msToken 保留：它只是防重放的种子，不是登录态。
        if (typeof updateConfig === 'function') {
            updateConfig({ cookie: '', msToken: readMsToken() });
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function initSignEngine() {
    if (!runtime) runtime = new QishuiAuthRuntime();
    return runtime.initialize();
}

async function getQrCode() {
    await initSignEngine();
    return runtime.getQrCode();
}

async function checkQrConnect(token) {
    await initSignEngine();
    return runtime.checkQrConnect(token);
}

async function requestOfficial(method, targetUrl, options) {
    if (!runtime) runtime = new QishuiAuthRuntime();
    return runtime.requestOfficial(method, targetUrl, options || {});
}

async function clear() {
    if (runtime) await runtime.clear();
}

const constants = { API_BASE, AID, APP_VERSION };

export {
    configure,
    initSignEngine,
    getQrCode,
    checkQrConnect,
    requestOfficial,
    clear,
    constants,
};
