import { Capacitor, registerPlugin } from '@capacitor/core';

// src/platform/foliaNative.ts
// 通用原生插件（FoliaNative）的 Web 侧入口。
//
// 这里只放那些不属于某个具体功能（壁纸 / 状态栏歌词）的小动作：退出、屏幕常亮，
// 以及应用内更新的下载与安装。它们共同点是「只有原生能做，且不需要知道播放器里
// 发生了什么」。

/** 一次插件事件监听的句柄。 */
export type FoliaNativeListenerHandle = { remove: () => Promise<void> };

/** 当前跑在 Capacitor Android WebView 里（原生插件桥可用）。 */
const isCapacitorAndroid = (): boolean => (
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
);

/** 更新包下载进度：原生侧每 100ms 推一次，直到 done。 */
export type UpdateDownloadProgress = {
    receivedBytes: number;
    /** 服务端没给 Content-Length 时为 0。 */
    totalBytes: number;
    /** 0-100；总量未知时为 -1 —— UI 据此切成「已下载 X MB」而不是百分比。 */
    percent: number;
    done: boolean;
};

/** 原生桥 `httpRequest` 的返回。headers 两种形状都可能出现（见 FoliaNativePlugin 那边）。 */
export type NativeHttpResponse = {
    status: number;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    bodyBase64?: string;
};

interface FoliaNativePlugin {
    exitApp(): Promise<void>;
    /**
     * 屏幕常亮开关。
     *
     * 传进来的值必须是**已经算好的结论**（开关 && 正在播放）：原生那边的 FLAG 只有
     * 开和关，它不该、也不知道「什么算在播」。
     */
    setScreenAwake(options: { awake: boolean }): Promise<void>;
    /**
     * 下载更新包。
     *
     * 落在 App 私有缓存目录（无需存储权限），进度通过 `updateDownloadProgress` 事件
     * 往外推；返回的路径直接喂给 {@link installUpdate}。
     */
    downloadUpdate(options: { url: string; fileName: string }): Promise<{ path: string; bytes: number }>;
    /**
     * 把下载好的包交给系统安装器。
     *
     * `status: 'permission-required'` 表示 Android O+ 上「允许来自此来源的应用」还没开，
     * 原生侧已经把设置页拉起来了 —— 用户授权回来再点一次即可，界面要把这句话说清楚。
     */
    installUpdate(options: { path: string }): Promise<{ status: string }>;
    /** 用原生 OkHttp 发一次请求，不受 WebView 的 CORS 限制。 */
    httpRequest(options: {
        url: string;
        method: string;
        headers: Record<string, string>;
        bodyText: string;
        bodyBase64: string;
        redirect: string;
        timeoutMs?: number;
    }): Promise<NativeHttpResponse>;
    addListener(
        eventName: 'updateDownloadProgress',
        listener: (progress: UpdateDownloadProgress) => void,
    ): Promise<FoliaNativeListenerHandle>;
}

const FoliaNative = registerPlugin<FoliaNativePlugin>('FoliaNative');

/**
 * 让屏幕保持常亮（或交还给系统）。
 *
 * 用窗口的 FLAG_KEEP_SCREEN_ON 而不是 WakeLock（见原生那边的说明）：
 * 这个标记只在**我们的窗口在前台**时有效，应用退到后台后系统照常熄屏 ——
 * 所以根本不存在「忘了关就一直耗电」这回事，也不需要在生命周期里到处补释放。
 */
export const setScreenAwake = async (awake: boolean): Promise<void> => {
    try {
        await FoliaNative.setScreenAwake({ awake });
    } catch {
        // 桌面端 / 插件不可用：静默，屏幕常亮不该影响播放本身。
    }
};

/** 监听更新包下载进度；句柄记得在组件卸载时 remove。 */
export const watchUpdateDownloadProgress = (
    listener: (progress: UpdateDownloadProgress) => void,
): Promise<FoliaNativeListenerHandle> => (
    FoliaNative.addListener('updateDownloadProgress', listener)
);

/** 下载更新包。文件名由原生侧清洗，这里只需保证带版本号即可。 */
export const downloadUpdate = (
    options: { url: string; fileName: string },
): Promise<{ path: string; bytes: number }> => FoliaNative.downloadUpdate(options);

/** 拉起系统安装器。 */
export const installUpdate = (
    options: { path: string },
): Promise<{ status: string }> => FoliaNative.installUpdate(options);

/** 原生桥给的 base64 响应体 → UTF-8 文本。清单里可能有中文更新日志，必须按 UTF-8 解。 */
export const decodeNativeBody = (bodyBase64?: string): string => {
    if (!bodyBase64) return '';
    const binary = atob(body64Safe(bodyBase64));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
};

/** base64 里偶尔会带换行（Java 的 MIME 编码器），atob 不认，先清掉。 */
const body64Safe = (value: string): string => value.replace(/\s+/g, '');

/**
 * 用原生 OkHttp 取一份文本。
 *
 * 安卓上走这条路而不是直接 fetch，是因为 WebView 里的 fetch 受同源策略约束：自建 CDN
 * 通常不会回 `Access-Control-Allow-Origin`，版本清单的请求当场就被拦掉，界面只能干巴巴
 * 显示一句「检查失败」。原生侧没有同源策略这回事。
 */
export const nativeGetText = async (url: string, timeoutMs?: number): Promise<string> => {
    const response = await FoliaNative.httpRequest({
        url,
        method: 'GET',
        headers: {},
        bodyText: '',
        bodyBase64: '',
        redirect: 'follow',
        ...(timeoutMs && timeoutMs > 0 ? { timeoutMs } : {}),
    });
    if (!response || (response.status >= 400)) {
        throw new Error(`Request failed with HTTP ${response?.status ?? 0}: ${url}`);
    }
    return decodeNativeBody(response.bodyBase64);
};

/** 原生 HTTP 转发可用（仅 Capacitor Android 上插件注册了才算）。 */
export const isNativeHttpAvailable = (): boolean => (
    isCapacitorAndroid() && typeof FoliaNative.httpRequest === 'function'
);
