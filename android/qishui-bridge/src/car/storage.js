// android/qishui-bridge/src/car/storage.js
//
// 设备身份与登录凭据的持久化。
//
// 安卓的签名宿主页面没有文件系统，旧协议层靠 shims/fs.js 把「文件」写成
// localStorage 键；车机协议要存的东西更少但也更关键（设备 ID 与 ticket 凭据），
// 所以直接落成两个键。localStorage 被禁用时退回内存：这次进程内能正常用，
// 下次冷启动会重新生成设备 ID（最坏情况是重新扫码，不是崩）。

const PREFIX = 'folia:qishui:car:';
const memory = new Map();

function store() {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch (_) {
        return null;
    }
}

export function readJson(key, fallback = null) {
    const full = PREFIX + key;
    let text = memory.has(full) ? memory.get(full) : null;
    if (text == null) {
        const target = store();
        if (!target) return fallback;
        try { text = target.getItem(full); } catch (_) { text = null; }
    }
    if (text == null) return fallback;
    try { return JSON.parse(text); } catch (_) { return fallback; }
}

export function writeJson(key, value) {
    const full = PREFIX + key;
    const text = JSON.stringify(value == null ? null : value);
    memory.set(full, text);
    const target = store();
    if (!target) return;
    try { target.setItem(full, text); } catch (_) { /* 留在内存兜底 */ }
}

export function remove(key) {
    const full = PREFIX + key;
    memory.delete(full);
    const target = store();
    if (!target) return;
    try { target.removeItem(full); } catch (_) { /* 同上 */ }
}

export const DEVICE_KEY = 'device-id';
export const SESSION_KEY = 'session';
