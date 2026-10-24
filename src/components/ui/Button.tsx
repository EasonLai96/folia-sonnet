import React from 'react';
import type { LucideIcon } from 'lucide-react';

// src/components/ui/Button.tsx
// 全仓唯一的按钮实现：语义（type/禁用/图标/无障碍名）都在这里，外观由 className 决定。
// 除了 src/components/ui/ 与设置页的 kit，任何地方都不许再手写 <button>（CI 的 ui-gates 会拦）。
//
// bare 是迁移期的默认档：只保留结构类，尺寸/字号/过渡/颜色一律交给调用方。基础类里任何一条
// 高度、字号、transition 都可能压过调用方的 className（Tailwind 的层叠不按书写顺序，而是按
// 生成的顺序），迁移既有按钮时那就是外观回退。

export type ButtonVariant = 'bare' | 'fill' | 'primary' | 'quiet';
export type ButtonSize = 'sm' | 'md';

const STRUCTURE = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40';

const VARIANT: Record<Exclude<ButtonVariant, 'bare'>, string> = {
    fill: 'rounded-lg bg-white/10 px-3 transition-colors hover:bg-white/15',
    primary: 'rounded-lg bg-[var(--ui-accent,#3b82f6)] px-3 text-white transition-colors hover:opacity-90',
    quiet: 'rounded-md px-1.5 text-current/70 transition-colors hover:bg-white/10 hover:text-current',
};

const SIZE: Record<ButtonSize, string> = {
    sm: 'h-6 text-xs',
    md: 'h-8 text-[13px]',
};

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: LucideIcon;
    /** 只有图标时给无障碍名字：优先用 tip，其次 aria-label。 */
    tip?: string;
}

export const Button: React.FC<ButtonProps> = ({ variant = 'bare', size = 'md', icon: Icon, tip, className, children, ...rest }) => {
    const iconOnly = !children;
    // bare 不拼尺寸：调用方自己的高度/字号必须原样生效。
    const look = variant === 'bare' ? '' : `${VARIANT[variant]} ${SIZE[size]}`;
    return (
        <button
            type="button"
            {...rest}
            aria-label={iconOnly ? (rest['aria-label'] ?? tip) : rest['aria-label']}
            title={tip ?? rest.title}
            className={`${STRUCTURE} ${look} ${className ?? ''}`}
        >
            {Icon && <Icon size={size === 'sm' ? 12 : 14} />}
            {children}
        </button>
    );
};

export default Button;
