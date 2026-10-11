import { OnlineProviderError } from '../../types/onlineMusic';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { sha256Hex } from '../../utils/sha256';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from './providerStorage';

// src/services/onlineMusic/feiniuTransport.ts
// 飞牛（FNOS）音乐服务的 HTTP 层：拼地址、带 Cookie、把响应体拆成 `data`。
// 与网易 / 酷狗不同，飞牛没有中间的 API 服务器：它就是用户自己的 NAS，地址由用户在
// 登录表单里填（构建期的 VITE_FEINIU_API_BASE 只是默认值，方便自部署）。

/** 接口前缀。用户填的地址不带它，发请求时才拼上。 */
const API_PREFIX = '/music/api/v1';

/** 账号或密码错误。服务端只给 code，msg 是英文，界面要换成自己的提示。 */
const CODE_INVALID_CREDENTIALS = 120001;

/** 翻页接口一次最多取这么多，再大服务端也不认。 */
const MAX_PAGE_SIZE = 300;

const readEnvBase = (): string => {
    const viteValue = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_FEINIU_API_BASE || '')
        : '';
    const processValue = typeof process !== 'undefined'
        ? String(process.env?.VITE_FEINIU_API_BASE || '')
        : '';
    return viteValue || processValue;
};

/** 用户常常照着浏览器地址栏复制，尾巴上带着 /music/api/v1，去掉再存。 */
export const normalizeFeiniuServerUrl = (value: string): string => (
    String(value ?? '').trim().replace(/\/music\/api\/v1\/*$/i, '').replace(/\/+$/, '')
);

const withScheme = (value: string): string => (
    /^https?:\/\//i.test(value) ? value : `http://${value}`
);

/** 当前生效的服务器地址：会话里存的那份优先，否则用构建期配的默认值。 */
export const getFeiniuServerUrl = (): string => (
    normalizeFeiniuServerUrl(readProviderSessionValue('feiniu', 'server') || readEnvBase())
);

/** 登录成功（或用户改地址）后记下来。登出不清：下次登录少填一项。 */
export const setFeiniuServerUrl = (value: string): void => {
    const normalized = normalizeFeiniuServerUrl(value);
    if (normalized) writeProviderSessionValue('feiniu', 'server', normalized);
};

const randomHex = (bytes: number): string => {
    const buffer = new Uint8Array(bytes);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(buffer);
    } else {
        for (let index = 0; index < bytes; index += 1) buffer[index] = Math.floor(Math.random() * 256);
    }
    return Array.from(buffer).map(value => value.toString(16).padStart(2, '0')).join('');
};

/**
 * 设备 id（32 位 hex），登录与漫游都要带。
 * 一次生成之后就钉住：换一个 id 服务端会当成新设备，漫游的进度会从头开始。
 */
const getDeviceId = (): string => {
    const stored = readProviderSessionValue('feiniu', 'deviceId');
    if (stored && /^[0-9a-f]{32}$/i.test(stored)) return stored;
    const generated = randomHex(16);
    writeProviderSessionValue('feiniu', 'deviceId', generated);
    return generated;
};

export const getFeiniuDeviceId = getDeviceId;

export const getFeiniuToken = (): string => readProviderSessionValue('feiniu', 'token') || '';

/** 中继模式：飞牛在外网穿透下要靠 `mode=relay` 这个 Cookie 值区分访问方式。 */
export const isFeiniuRelayMode = (): boolean => readProviderSessionValue('feiniu', 'relay') === '1';

export const setFeiniuRelayMode = (relay: boolean): void => {
    writeProviderSessionValue('feiniu', 'relay', relay ? '1' : '0');
};

/** Cookie 的值：登录态全靠它，图片与音频流也要带同一个头。 */
export const feiniuAuthCookie = (): string => (
    isFeiniuRelayMode() ? `music-token=${getFeiniuToken()}; mode=relay` : `music-token=${getFeiniuToken()}`
);

/** 封面与音频流的鉴权头；没登录时给 null（那时本来也取不到资源）。 */
export const feiniuResourceHeaders = (): Record<string, string> | null => {
    const token = getFeiniuToken();
    if (!token) return null;
    return { Cookie: feiniuAuthCookie() };
};

const assetBase = (): string => {
    const base = getFeiniuServerUrl();
    return base ? withScheme(base) : '';
};

export const feiniuCoverUrl = (coverId?: string | null, size = 480): string => {
    const base = assetBase();
    if (!base || !coverId) return '';
    return `${base}${API_PREFIX}/static/cover?coverId=${encodeURIComponent(String(coverId))}&size=${size}`;
};

export const feiniuStreamUrl = (guid: string): string => {
    const base = assetBase();
    return base ? `${base}${API_PREFIX}/track/stream?guid=${encodeURIComponent(guid)}` : '';
};

export type FeiniuEnvelope<T = unknown> = { code: number; msg: string; data: T };

export type FeiniuRequestOptions = {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    method?: 'GET' | 'POST';
    /** 登录请求自己没有 token，不该带一个空的 Cookie 上去。 */
    anonymous?: boolean;
    timeoutMs?: number;
};

export const feiniuRequest = async <T = unknown>(path: string, options: FeiniuRequestOptions = {}): Promise<T> => {
    const base = getFeiniuServerUrl();
    if (!base) {
        throw new OnlineProviderError('unavailable', 'FeiNiu server address is not configured', 'feiniu');
    }
    if (!options.anonymous && !getFeiniuToken()) {
        throw new OnlineProviderError('auth-required', 'FeiNiu is not signed in', 'feiniu');
    }

    const url = new URL(`${withScheme(base)}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`);
    Object.entries(options.query ?? {}).forEach(([key, value]) => {
        if (value === undefined || value === '') return;
        url.searchParams.set(key, String(value));
    });

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.anonymous) {
        // 登录这一发只能靠地址本身，但中继模式仍要声明。
        if (isFeiniuRelayMode()) headers.Cookie = 'mode=relay';
    } else {
        headers.Cookie = feiniuAuthCookie();
    }
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    let payload: string | undefined;
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(options.body);
    }

    let response: Response;
    try {
        response = await fetchWithTimeout(
            url.toString(),
            { method, headers, body: payload, credentials: 'omit' },
            options.timeoutMs ?? 20_000,
        );
    } catch (error) {
        throw new OnlineProviderError('network', `FeiNiu request failed: ${path}`, 'feiniu', error);
    }

    if (response.status === 401 || response.status === 403) {
        throw new OnlineProviderError(
            'auth-required',
            `FeiNiu rejected the session (HTTP ${response.status})`,
            'feiniu',
            undefined,
            response.status,
        );
    }

    let envelope: FeiniuEnvelope<T>;
    try {
        envelope = await response.json() as FeiniuEnvelope<T>;
    } catch (error) {
        throw new OnlineProviderError('invalid-response', `FeiNiu returned a non-JSON response for ${path}`, 'feiniu', error);
    }
    if (!envelope || typeof envelope !== 'object') {
        throw new OnlineProviderError('invalid-response', `FeiNiu returned an unexpected payload for ${path}`, 'feiniu');
    }
    if (envelope.code === CODE_INVALID_CREDENTIALS) {
        throw new OnlineProviderError('invalid-credentials', 'FeiNiu rejected the username or password', 'feiniu', envelope);
    }
    if (Number(envelope.code) !== 0) {
        throw new OnlineProviderError(
            'unavailable',
            envelope.msg || `FeiNiu request failed (${envelope.code})`,
            'feiniu',
            envelope,
        );
    }
    return envelope.data;
};

/**
 * 取一页列表。飞牛的分页是 1 起始的 `page` + `size`，而 omni 用的是 offset + limit，
 * 两边不对齐时（比如 offset=30、limit=50）多要一点再在本地切。
 */
export const feiniuList = async <T>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    offset: number,
    limit: number,
): Promise<{ items: T[]; total: number }> => {
    const size = Math.min(Math.max(limit, 1) + (offset % Math.max(limit, 1)), MAX_PAGE_SIZE);
    const page = Math.floor(offset / Math.max(limit, 1)) + 1;
    const data = await feiniuRequest<{ list?: T[]; total?: number }>(path, { query: { ...query, page, size } });
    const all = Array.isArray(data?.list) ? data.list : [];
    const skip = offset % Math.max(limit, 1);
    return { items: all.slice(skip, skip + limit), total: Number(data?.total) || 0 };
};

export type FeiniuLoginData = {
    userToken?: string;
    user?: { name?: string; guid?: string; role?: string };
};

/** 密码登录。成功就把 token 与地址落盘，之后所有请求自动带上。 */
export const feiniuPasswordLogin = async (username: string, password: string, serverUrl?: string): Promise<FeiniuLoginData> => {
    if (serverUrl) setFeiniuServerUrl(serverUrl);
    const data = await feiniuRequest<FeiniuLoginData>('/user/password-login', {
        method: 'POST',
        anonymous: true,
        body: { username, password: await sha256Hex(password), deviceId: getDeviceId() },
    });
    if (!data?.userToken) {
        throw new OnlineProviderError('invalid-response', 'FeiNiu login returned no token', 'feiniu', data);
    }
    writeProviderSessionValue('feiniu', 'token', data.userToken);
    return data;
};

/** 登出：只丢登录态，地址留着（飞牛音乐自己的做法）。 */
export const clearFeiniuSession = (): void => {
    removeProviderSessionValue('feiniu', 'token');
    removeProviderSessionValue('feiniu', 'relay');
    removeProviderSessionValue('feiniu', 'user');
};

/**
 * 登录时把用户信息留在本地：飞牛没有「取当前登录用户」的接口，
 * 而账号 id 是刷新歌单这些请求的必备参数，登录之后每次都得拿得出来。
 */
export const rememberFeiniuUser = (user: { id: string | number; nickname: string; avatarUrl?: string }): void => {
    writeProviderSessionValue('feiniu', 'user', JSON.stringify(user));
};

export const readFeiniuUser = (): { id: string | number; nickname: string; avatarUrl?: string } | null => {
    if (!getFeiniuToken()) return null;
    const raw = readProviderSessionValue('feiniu', 'user');
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { id?: string | number; nickname?: string };
        return parsed && parsed.id !== undefined && parsed.id !== '' ? parsed as { id: string | number; nickname: string } : null;
    } catch {
        return null;
    }
};

/**
 * 飞牛是「连上才知道」的：地址由用户在登录时填，不像托管服务那样能在启动前判定配没配。
 * 所以这里永远报已配置 —— 否则可用性检查会把用户挡在登录界面之外。
 */
export const getFeiniuTransportAvailability = () => ({ configured: true } as const);
