import React from 'react';
import { defineVisualizer } from '../definition';

// src/components/visualizer/prompt/entry.tsx
// 提示词：和商籁共用同一套 Pixi 运行时，只把节目单锁成「一句一个输入框」——
// 每唱完一句，这个框飞走、下一个框飞进来，框里的字跟着唱到的位置逐个落下。
// 镜头本体在 sonnet/sonnetPromptField.ts，切法由 compileSonnetProgram 的 forcedShotKind 决定。
const VisualizerSonnet = React.lazy(() => import('../sonnet/VisualizerSonnet'));

export default defineVisualizer({
    mode: 'prompt',
    order: 11,
    labelKey: 'ui.visualizerPrompt',
    labelFallback: '提示词',
    previewSeed: 'prompt',
    previewStartOffset: 0,
    // 提示词：一个输入框 + 光标
    glyph: (
        <>
            <path d="M3 6.5h18v11H3z" opacity="0.55" />
            <path d="M6 10.5h4.5M6 13.5h8" />
            <path d="M17.5 12.6v-2.4" opacity="0.8" />
        </>
    ),
    command: {
        title: 'Visualizer: Prompt',
        description: 'Switch to the prompt-box visualizer',
        keywords: ['prompt', 'chat', 'dialog', 'input', '提示词', '输入框', '对话框', '打字'],
    },
    usesWordSegmentation: true,
    render: props => <VisualizerSonnet {...props} forceShotKind="prompt-field" />,
});
