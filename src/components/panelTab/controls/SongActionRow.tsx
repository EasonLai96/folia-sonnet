import React from 'react';
import { Heart, Repeat, Repeat1, RepeatOff, Shuffle, Sparkle, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeSourceModel } from '../../../hooks/themeControllerState';
import { noteLoopButtonPress } from '../../../services/ponder/loopShuffleHint';

// src/components/panelTab/controls/SongActionRow.tsx
// 当前歌曲的三个动作：循环、喜欢、生成 AI 主题。面板里唯一一排大触控目标，保持原样。

interface SongActionRowProps {
    loopMode: 'off' | 'all' | 'one' | 'shuffle';
    /** Receives the click so the handler can stop it from reaching the panel container. */
    onToggleLoop: (event?: React.MouseEvent) => void;
    loopToggleDisabled: boolean;
    onLike: () => void;
    isLiked: boolean;
    likeDisabled: boolean;
    likeDisabledReason?: string;
    onGenerateAITheme: () => void;
    isGeneratingTheme: boolean;
    canGenerateAITheme: boolean;
    themeSourceModel: ThemeSourceModel;
    isDaylight: boolean;
}

const SongActionRow: React.FC<SongActionRowProps> = ({
    loopMode,
    onToggleLoop,
    loopToggleDisabled,
    onLike,
    isLiked,
    likeDisabled,
    likeDisabledReason,
    onGenerateAITheme,
    isGeneratingTheme,
    canGenerateAITheme,
    themeSourceModel,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const loopButtonBg = isDaylight ? 'bg-black/5 hover:bg-zinc-300/85' : 'bg-white/5 hover:bg-white/10';
    const buttonBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/5 hover:bg-white/10';
    // 四态：顺序 / 列表循环 / 单曲循环 / 随机播放。随机那档的排序见 utils/playbackShuffle.ts。
    const loopTitle = loopMode === 'off'
        ? t('player.loopOff')
        : loopMode === 'one'
            ? t('player.loopOne')
            : loopMode === 'shuffle'
                ? t('player.loopShuffle')
                : t('player.loopAll');
    const loopIcon = loopMode === 'off'
        ? <RepeatOff size={20} />
        : loopMode === 'one'
            ? <Repeat1 size={20} />
            : loopMode === 'shuffle'
                ? <Shuffle size={20} />
                : <Repeat size={20} />;
    const generateThemeTitle = isGeneratingTheme ? t('ui.generatingTheme') : t('ui.generateAITheme');

    return (
        <div className="grid grid-cols-3 gap-3">
            <button
                onClick={event => {
                    onToggleLoop(event);
                    noteLoopButtonPress();
                }}
                disabled={loopToggleDisabled}
                title={loopTitle}
                aria-label={loopTitle}
                className={`h-12 rounded-xl flex items-center justify-center transition-colors ${loopButtonBg} ${loopToggleDisabled ? 'opacity-35 cursor-not-allowed' : ''}`}
            >
                {loopIcon}
            </button>

            <button
                onClick={onLike}
                disabled={likeDisabled}
                title={likeDisabledReason || (isLiked ? t('player.unlike') : t('player.like'))}
                aria-label={likeDisabledReason || (isLiked ? t('player.unlike') : t('player.like'))}
                className={`h-12 rounded-xl flex items-center justify-center transition-colors ${isLiked ? 'bg-red-500/20 text-red-500' : buttonBg} ${likeDisabled ? 'opacity-35 cursor-not-allowed' : ''}`}
            >
                <Heart size={20} fill={isLiked ? 'currentColor' : 'none'} />
            </button>

            <button
                onClick={onGenerateAITheme}
                disabled={isGeneratingTheme || !canGenerateAITheme}
                title={generateThemeTitle}
                aria-label={generateThemeTitle}
                className={`h-12 rounded-xl flex items-center justify-center transition-colors ${
                    isGeneratingTheme
                        ? 'bg-blue-500/20 text-blue-300'
                        : buttonBg
                }`}
            >
                {themeSourceModel.hasLocalAiTheme && !isGeneratingTheme ? (
                    <Sparkles size={20} />
                ) : (
                    <Sparkle size={20} className={isGeneratingTheme ? 'animate-pulse' : ''} />
                )}
            </button>
        </div>
    );
};

export default SongActionRow;
