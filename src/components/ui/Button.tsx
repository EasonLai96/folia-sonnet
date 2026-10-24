import React from 'react';
import type { LucideIcon } from 'lucide-react';

// src/components/ui/Button.tsx
// 全仓唯一的按钮实现：语义（type/禁用/图标/无障碍名）都在这里，外观由 className 决定。
// 除了 src/components/ui/ 与设置页的 kit，任何地方都不许再手写 <button>（CI 的 ui-gates 会拦）。

export type ButtonVariant = 'bare' | 'fill' | 'primary' | 'quiet';
export type ButtonSize = 'sm' | 'md';

const BASE = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const VARIANT: Record<ButtonVariant, string> = {
    // 外观完全交给调用方：迁移既有按钮时保持原样。
    bare: '',
    fill: 'rounded-lg bg-white/10 px-3 hover:bg-white/15',
    primary: 'rounded-lg bg-[var(--ui-accent,#3b82f6)] px-3 text-white hover:opacity-90',
    quiet: 'rounded-md px-1.5 text-current/70 hover:bg-white/10 hover:text-current',
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
    return (
        <button
            type="button"
            {...rest}
            aria-label={iconOnly ? (rest['aria-label'] ?? tip) : rest['aria-label']}
            title={tip ?? rest.title}
            className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className ?? ''}`}
        >
            {Icon && <Icon size={size === 'sm' ? 12 : 14} />}
            {children}
        </button>
    );
};

export default Button;
