import React from 'react';

// src/library/core/home/CloudThemeHomeLane.tsx
// 「AI 主题」页签在首页那一层留下的入口。
//
// 这一屏打开的是曲目列表（集合层），它盖住首页 —— 首页那一层先前什么都不画，于是**返回之后
// 落到的是一片空白**：列表不会自己再开（自动开那一次的机会已经用掉了），也没有任何东西可以点。
//
// 所以这一层留一颗看得见的按钮：点了重新打开那一屏。那一屏的每次 loading 都从云端随机一处
// 开始，所以这颗按钮既是「回去看看」也是「换一批」。
//
// 文案由调用方翻好传进来 —— 与 useLibraryHomeCloudThemeEntry 同一个约定（那一层自己有 i18n
// 类型，这里不重复走一遍）。

export type CloudThemeHomeLaneProps = {
    /** 已翻译的页签名。 */
    label: string;
    /** 已翻译的「这一屏是什么」。 */
    notice: string;
    /** 已翻译的按钮文案。 */
    actionLabel: string;
    disabled?: boolean;
    onOpen: () => void;
};

const CloudThemeHomeLane: React.FC<CloudThemeHomeLaneProps> = ({
    label,
    notice,
    actionLabel,
    disabled = false,
    onOpen,
}) => (
    // 宿主把自己画成盖满首页的一层并且 `pointer-events-none`（锚点），所以这里要自己收回来。
    // `absolute inset-0` 对两套首页都成立：网格那一层是 `relative` 的，bravais 那一层本身就是
    // `absolute inset-0` —— 都是它的定位上下文。
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {label}
        </div>
        <div className="max-w-md text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {notice}
        </div>
        <button
            type="button"
            onClick={onOpen}
            disabled={disabled}
            className="mt-1 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all disabled:opacity-40"
            style={{
                backgroundColor: 'color-mix(in srgb, var(--text-primary) 10%, transparent)',
                color: 'var(--text-primary)',
            }}
        >
            {actionLabel}
        </button>
    </div>
);

export default CloudThemeHomeLane;
