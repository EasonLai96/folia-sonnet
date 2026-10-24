import React from 'react';

// src/components/ui/Checkbox.tsx
// 全仓唯一的复选框实现；原生 input 只在这里出现一次。手写 <input type="checkbox"> 由 ui-gates 拦。

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...rest }, ref) => (
    <input ref={ref} type="checkbox" {...rest} className={`accent-current ${className ?? ''}`} />
));

Checkbox.displayName = 'Checkbox';
export default Checkbox;
