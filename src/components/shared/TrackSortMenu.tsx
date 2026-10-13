import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowDownAZ,
    ArrowDownUp,
    ArrowUpAZ,
    CalendarClock,
    Check,
    Clock,
    FileMusic,
    Heart,
    ListMusic,
    ListOrdered,
    Play,
    Type,
    User,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongSortDirection, SongSortField } from '../../utils/songSorting';
import { findSongSortPreset, type SongSortPreset } from '../../library/core/model/songSortOptions';

// src/components/shared/TrackSortMenu.tsx
// 曲目列表的排序菜单。选项不在这里写死：renderer 把「这个列表排得了哪些项」传进来，
// 菜单照着渲染——网格侧栏、bravais 面板、命令面板因此永远给出同一份列表。

type IconComponent = React.ComponentType<{ size?: number }>;

const FIELD_ICONS: Partial<Record<SongSortField, IconComponent>> = {
    none: ListMusic,
    addedAt: Clock,
    title: Type,
    artist: User,
    liked: Heart,
    playCount: Play,
    fileName: FileMusic,
    fileLastModified: CalendarClock,
    albumTrack: ListOrdered,
};

const iconFor = (field: SongSortField): IconComponent => FIELD_ICONS[field] ?? ArrowDownUp;

type TrackSortMenuProps = {
    presets: readonly SongSortPreset[];
    field: SongSortField;
    direction: SongSortDirection;
    onSelect: (preset: SongSortPreset) => void;
};

export const TrackSortMenu: React.FC<TrackSortMenuProps> = ({ presets, field, direction, onSelect }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const StrategyIcon = iconFor(field);
    const activePreset = findSongSortPreset(field, direction);

    const { primary, legacy } = useMemo(() => ({
        primary: presets.filter(preset => preset.group === 'primary'),
        legacy: presets.filter(preset => preset.group === 'legacy'),
    }), [presets]);

    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, []);

    return (
        <div ref={containerRef} data-ponder="local-track-sorting" className="relative shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen(current => !current)}
                aria-label={t('localMusic.sortSongs')}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                title={t('localMusic.sortSongs')}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    isOpen ? 'bg-black/10 dark:bg-white/15' : 'hover:bg-black/10 dark:hover:bg-white/10'
                }`}
            >
                <StrategyIcon size={16} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.96 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        role="menu"
                        className="absolute right-0 top-10 z-10 w-52 rounded-2xl border p-1.5 shadow-xl backdrop-blur-2xl theme-glass-panel"
                    >
                        {primary.map(preset => (
                            <SortFieldButton
                                key={preset.id}
                                active={activePreset?.id === preset.id}
                                icon={React.createElement(iconFor(preset.field), { size: 15 })}
                                label={t(preset.labelKey)}
                                onClick={() => {
                                    onSelect(preset);
                                    setIsOpen(false);
                                }}
                            />
                        ))}
                        {legacy.length > 0 && (
                            <>
                                <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
                                {legacy.map(preset => (
                                    <SortFieldButton
                                        key={preset.id}
                                        active={activePreset?.id === preset.id}
                                        icon={React.createElement(iconFor(preset.field), { size: 15 })}
                                        label={t(preset.labelKey)}
                                        onClick={() => {
                                            onSelect(preset);
                                            setIsOpen(false);
                                        }}
                                    />
                                ))}
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export const TrackSortDirectionButton: React.FC<{
    direction: SongSortDirection;
    disabled?: boolean;
    onDirectionChange: (direction: SongSortDirection) => void;
}> = ({ direction, disabled = false, onDirectionChange }) => {
    const { t } = useTranslation();
    const DirectionIcon = direction === 'asc' ? ArrowDownAZ : ArrowUpAZ;
    const nextDirection = direction === 'asc' ? 'desc' : 'asc';

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => onDirectionChange(nextDirection)}
            aria-label={t('localMusic.sortDirection')}
            title={t(direction === 'asc' ? 'localMusic.sortAscending' : 'localMusic.sortDescending')}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/10 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10"
        >
            <DirectionIcon size={16} />
        </button>
    );
};

const SortFieldButton: React.FC<{
    active: boolean;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
    <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={onClick}
        aria-label={label}
        className={`relative flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
            active ? 'bg-black/10 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
        }`}
    >
        <span className="opacity-65">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && <Check size={14} className="opacity-80" />}
    </button>
);
