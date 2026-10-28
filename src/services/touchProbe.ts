// src/services/touchProbe.ts
// ⚠️ 临时诊断（定位「横屏可视化里点击/滑动全无反应」用），定位完就删。
// 目的只有一个：把「事件有没有到 WebView」「落在哪个元素上」「手势判据当时的值」三件事
// 一次问清楚 —— 光看代码猜不出横屏那一档到底是谁盖住了视觉层。
import { setStatusMessage } from '../stores/useStatusMessageStore';

const describe = (node: EventTarget | null): string => {
    if (!(node instanceof Element)) return 'none';
    const cls = (node.className && typeof node.className === 'string' ? node.className : '')
        .split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return cls ? `${node.tagName.toLowerCase()}.${cls}` : node.tagName.toLowerCase();
};

const state = () => {
    const w = window as unknown as { __foliaProbeState?: () => string };
    return w.__foliaProbeState ? w.__foliaProbeState() : 'state=?';
};

let installed = false;

export const installTouchProbe = (): void => {
    if (installed) return;
    installed = true;
    let lastDown = 'none';
    document.addEventListener('pointerdown', event => {
        lastDown = describe(event.target);
    }, true);
    document.addEventListener('click', event => {
        const under = document.elementFromPoint(event.clientX, event.clientY);
        setStatusMessage({
            type: 'info',
            text: `down=${lastDown} up=${describe(event.target)} at=${describe(under)} ${state()}`,
            nonce: Date.now(),
        });
    }, true);
};
