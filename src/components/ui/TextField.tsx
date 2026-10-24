import React from 'react';

// src/components/ui/TextField.tsx
// 全仓唯一的单行输入框实现；外观交给 className。手写 <input> 由 ui-gates 拦。

export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement>;

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(({ className, ...rest }, ref) => (
    <input
        ref={ref}
        {...rest}
        className={`min-w-0 bg-transparent outline-none placeholder:text-current/40 disabled:opacity-50 ${className ?? ''}`}
    />
));

TextField.displayName = 'TextField';
export default TextField;
