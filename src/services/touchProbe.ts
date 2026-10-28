// src/services/touchProbe.ts
// ⚠️ 临时诊断（定位「横屏可视化里点击/滑动全无反应」用），定位完就删。
// 目的：一次看清「事件落在谁身上」「有没有进视觉层」「手势判据当时是什么值」
//      「处理函数到底跑了几次」—— 这四件事分开看才知道是事件没到、还是判据挡掉了。
import { setStatusMessage } from '../stores/useStatusMessageStore';

const chainOf = (node: EventTarget | null): string => {
    if (!(node instanceof Element)) return 'none';
    const parts: string[] = [];
    let cursor: Element | null = node;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
        const cls = (typeof cursor.className === 'string' ? cursor.className : '')
            .split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        parts.push(cls ? `${cursor.tagName.toLowerCase()}.${cls}` : cursor.tagName.toLowerCase());
        cursor = cursor.parentElement;
    }
    return parts.join('>');
};

const inVisualSurface = (node: EventTarget | null): string => {
    if (!(node instanceof Element)) return '0';
    return node.closest('[data-testid="player-visual-surface"]') ? '1' : '0';
};

const probeState = (): string => {
    const w = window as unknown as {
        __foliaProbeState?: () => string;
        __foliaProbeCounts?: Record<string, number>;
    };
    const counts = w.__foliaProbeCounts ?? {};
    const hits = `tap=${counts.tap ?? 0} swipe=${counts.swipe ?? 0}`;
    return `${hits} ${w.__foliaProbeState ? w.__foliaProbeState() : 'state=?'}`;
};

let installed = false;

export const installTouchProbe = (): void => {
    if (installed) return;
    installed = true;
    let lastDown = 'none';
    document.addEventListener('pointerdown', event => {
        lastDown = `${chainOf(event.target)} inSurface=${inVisualSurface(event.target)}`;
    }, true);
    document.addEventListener('click', event => {
        const under = document.elementFromPoint(event.clientX, event.clientY);
        setStatusMessage({
            type: 'info',
            text: `down=${lastDown} up=${chainOf(event.target)} atSurface=${inVisualSurface(under)} ${probeState()}`,
            nonce: Date.now(),
        });
    }, true);
};
