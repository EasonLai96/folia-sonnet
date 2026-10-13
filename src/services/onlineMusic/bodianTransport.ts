import { OnlineProviderError } from '../../types/onlineMusic';
import type { BodianOperation, BodianParams, BodianResult } from 'bodian-music-api';
import { isFoliaExtensionBridgeConfigured, requestFoliaExtension } from '../foliaExtensionBridge';
import { toBodianProviderError } from './bodianErrors';

// src/services/onlineMusic/bodianTransport.ts

export type { BodianOperation, BodianParams } from 'bodian-music-api';
export type BodianBridgeResult = BodianResult;

/**
 * 波点没有自己的后端服务器可以配：桌面端是 Electron 主进程里内置的那份 bodian-music-api，
 * Android 则是内置在 App 里的 src/nativeBridge/api/bodian.js（API 基址写成哨兵值 `extension`）。
 * 两种情况下请求都不出本机之外的自建服务，这就是「本地登录」。
 */
const getBodianApiBase = (): string => {
    const viteValue = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_BODIAN_API_BASE || '')
        : '';
    const processValue = typeof process !== 'undefined'
        ? String(process.env?.VITE_BODIAN_API_BASE || '')
        : '';
    return (viteValue || processValue).trim().replace(/\/+$/, '');
};

const hasElectronBodian = (): boolean => (
    typeof window !== 'undefined' && typeof window.electron?.bodianRequest === 'function'
);

const useLocalBridge = (): boolean => isFoliaExtensionBridgeConfigured(getBodianApiBase());

export const getBodianTransportAvailability = () => {
    if (hasElectronBodian()) return { configured: true } as const;
    if (useLocalBridge()) return { configured: true } as const;
    return { configured: false, reason: 'runtime-unavailable' } as const;
};

export async function requestBodian<T = unknown>(operation: BodianOperation, params: BodianParams = {}): Promise<T> {
    // Omni consumers request 150/1000-row batches; Bodian serves at most 100 and returns its own cursor.
    const boundedParams = Number.isSafeInteger(params.limit) && Number(params.limit) > 100
        ? { ...params, limit: 100 } : params;

    if (hasElectronBodian()) {
        let result: BodianBridgeResult;
        try { result = await window.electron!.bodianRequest(operation, boundedParams); }
        // IPC 被拒是本地桌面进程的故障，不是网络故障。
        catch (error) {
            throw new OnlineProviderError('unavailable', 'Bodian desktop request failed', 'bodian',
                error, undefined, undefined, { stage: 'ipc' });
        }
        // 包的 message 模板在 bodianErrors.ts 细分；auth-required 始终原样保留，useBodianLibrary 靠它清理会话。
        if (!result.ok) throw toBodianProviderError(result.error);
        return result.data as T;
    }

    if (useLocalBridge()) {
        let result: BodianBridgeResult | null = null;
        try {
            result = await requestFoliaExtension<BodianBridgeResult>({
                provider: 'bodian',
                operation,
                method: 'POST',
                params: boundedParams,
            });
        } catch (error) {
            throw new OnlineProviderError('network', 'Bodian local bridge request failed', 'bodian', error);
        }
        // 桥那侧理论上只会回 BodianResult，但 operation 拼错 / 路由没实现时回的是
        // `__foliaBridgeError` 那类形状，这里统一兜住，别让它流到 UI 里变成 undefined。
        if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
            throw new OnlineProviderError('invalid-response', 'Bodian local bridge returned an unexpected payload', 'bodian');
        }
        if (!result.ok) {
            throw new OnlineProviderError(result.error?.code || 'network', result.error?.message || 'Bodian request failed', 'bodian');
        }
        return result.data as T;
    }

    // 桌面桥与本地桥都没有：重试不会变好，transient:false 让播放侧显示「未配置」而不是「稍后再试」。
    throw new OnlineProviderError('unavailable', 'Bodian requires the desktop app', 'bodian',
        undefined, undefined, undefined, { stage: 'runtime', transient: false });
}
