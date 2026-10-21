// android/qishui-bridge/src/car/storage.js
//
// 设备身份与登录凭据的持久化。
//
// 三级，按可靠性从高到低：
//
//   1. **原生 SharedPreferences**（`FoliaQishuiHost.getStore/putStore`）—— App 自己
//      的文件，重启必在。只写 WebView 的 localStorage 是不够的：DOM storage 依赖
//      WebView 数据目录的状态（系统清理、存储紧张、多进程都可能让它丢），表现为
//      「登录成功、重启后账号没了」。
//   2. localStorage —— 回退（宿主是老版本、还没有 getStore 时用）。
//   3. 内存 —— 两者都不可用时，本次进程内还能正常登录，重启才丢。
//
// 写入双写（1 与 2 都写），读取按 1 → 2 → 3。`storageMode()` 报告实际生效的那一档，
// 由 status 带进诊断：真机上再说「账号丢了」，先看这一档是什么。

const PREFIX = 'folia:qishui:car:';
const memory = new Map();

/** 原生出口：宿主老版本没有这两个方法时返回 null，调用方自行降级。 */
function native() {
    try {
        const host = typeof window !== 'undefined' ? window.FoliaQishuiHost : null;
        if (!host || typeof host.getStore !== 'function' || typeof host.putStore !== 'function') return null;
        return host;
    } catch (_) {
        return null;
    }
}

function local() {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch (_) {
        return null;
    }
}

let lastMode = 'memory';
export const storageMode = () => lastMode;

export function readJson(key, fallback = null) {
    const host = native();
    if (host) {
        try {
            const text = host.getStore(key);
            if (text) {
                lastMode = 'native';
                return JSON.parse(text);
            }
        } catch (_) { /* 落到下一档 */ }
    }
    const target = local();
    if (target) {
        try {
            const text = target.getItem(PREFIX + key);
            if (text != null) {
                lastMode = 'local';
                return JSON.parse(text);
            }
        } catch (_) { /* 同上 */ }
    }
    if (memory.has(key)) {
        lastMode = 'memory';
        return memory.get(key);
    }
    lastMode = memory.size ? 'memory' : 'none';
    return fallback;
}

export function writeJson(key, value) {
    const text = JSON.stringify(value == null ? null : value);
    memory.set(key, value);
    const host = native();
    if (host) {
        try {
            host.putStore(key, text);
            lastMode = 'native';
        } catch (_) { /* 继续写 localStorage */ }
    }
    const target = local();
    if (target) {
        try { target.setItem(PREFIX + key, text); } catch (_) { /* 留在内存兜底 */ }
    }
}

export function remove(key) {
    memory.delete(key);
    const host = native();
    if (host) {
        try { host.putStore(key, null); } catch (_) { /* 忽略 */ }
    }
    const target = local();
    if (target) {
        try { target.removeItem(PREFIX + key); } catch (_) { /* 同上 */ }
    }
}

export const DEVICE_KEY = 'device-id';
export const SESSION_KEY = 'session';
