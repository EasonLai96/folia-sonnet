import React from 'react';

// src/components/ui/TextArea.tsx
// 全仓唯一的文本域实现；外观交给 className。手写 <textarea> 由 ui-gates 拦。

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(({ className, ...rest }, ref) => (
    <textarea
        ref={ref}
        {...rest}
        className={`min-w-0 resize-none bg-transparent outline-none placeholder:text-current/40 disabled:opacity-50 ${className ?? ''}`}
    />
));

TextArea.displayName = 'TextArea';
export default TextArea;
