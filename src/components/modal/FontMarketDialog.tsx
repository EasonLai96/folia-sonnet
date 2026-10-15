import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Cloud, Loader2, Search, Upload, X } from 'lucide-react';
import {
    fetchFontMarket,
    installMarketFont,
    readFontMarketChoice,
    resolveFontPreviewUrl,
    writeFontMarketChoice,
    type FontMarketFont,
    type FontMarketInstallResult,
} from '../../services/fontMarket';

// src/components/modal/FontMarketDialog.tsx
// 字体市场：列出后台上架的字体，点一下预览，再点「使用」才去下载。
//
// 两个入口共用它 —— 壁纸 / 叠层的歌词字体，以及动画设置里的字体选择。
// 弹层走 createPortal 挂到 body：这两处各自的祖先层上都带
// pointer-events:none / aria-hidden 的不可见锚点，就地挂载会「弹出来却点不动」。

export interface FontMarketSelection {
    id: string;
    family: string;
    label: string;
    previewUrl: string;
}

interface FontMarketDialogProps {
    isOpen: boolean;
    onClose: () => void;
    isDaylight: boolean;
    /** 当前生效的 CSS family，用来打勾。 */
    currentFamily?: string | null;
    onUseFont: (result: FontMarketInstallResult) => void;
    onClearFont?: () => void;
    /** 有的入口（壁纸）走系统文件选择器，把这一路挂进来。 */
    onPickLocalFont?: () => void;
    localFontLabel?: string | null;
}

type TabId = 'all' | 'sans' | 'serif' | 'handwriting' | 'display' | 'mono' | 'mine';

const themeAccentSoft = (isDaylight: boolean): string => (
    isDaylight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'
);

const TABS: Array<{ id: TabId; labelKey: string; fallback: string }> = [
    { id: 'all', labelKey: 'options.fontMarketAll', fallback: '全部' },
    { id: 'sans', labelKey: 'options.fontMarketCategorySans', fallback: '黑体' },
    { id: 'serif', labelKey: 'options.fontMarketCategorySerif', fallback: '宋体' },
    { id: 'handwriting', labelKey: 'options.fontMarketCategoryHandwriting', fallback: '手写' },
    { id: 'display', labelKey: 'options.fontMarketCategoryDisplay', fallback: '艺术' },
    { id: 'mono', labelKey: 'options.fontMarketCategoryMono', fallback: '等宽' },
    { id: 'mine', labelKey: 'options.fontMarketMine', fallback: '我的' },
];

const FontMarketDialog: React.FC<FontMarketDialogProps> = ({
    isOpen,
    onClose,
    isDaylight,
    currentFamily,
    onUseFont,
    onClearFont,
    onPickLocalFont,
    localFontLabel,
}) => {
    const { t } = useTranslation();
    const [fonts, setFonts] = useState<FontMarketFont[]>([]);
    const [status, setStatus] = useState<'loading' | 'ready' | 'offline' | 'server'>('loading');
    const [query, setQuery] = useState('');
    const [tab, setTab] = useState<TabId>('all');
    const [preview, setPreview] = useState<FontMarketFont | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let isCancelled = false;
        setStatus('loading');
        void fetchFontMarket().then((result) => {
            if (isCancelled) return;
            setFonts(result.fonts);
            setStatus(result.error === 'offline' ? 'offline' : result.error ? 'server' : 'ready');
        });
        return () => {
            isCancelled = true;
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setPreview(null);
            setNotice(null);
        }
    }, [isOpen]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return fonts.filter((font) => {
            if (tab === 'mine') return false;
            if (tab !== 'all' && font.category !== tab) return false;
            if (!needle) return true;
            return `${font.name} ${font.categoryLabel} ${font.family}`.toLowerCase().includes(needle);
        });
    }, [fonts, query, tab]);

    const applyFont = async (font: FontMarketFont) => {
        if (busyId) return;
        setBusyId(font.id);
        setNotice(null);
        try {
            const result = await installMarketFont(font);
            writeFontMarketChoice({
                id: result.id,
                family: result.family,
                label: result.label,
                previewUrl: result.previewUrl,
            });
            onUseFont(result);
            setPreview(null);
            onClose();
        } catch (error) {
            setNotice(`${t('options.fontMarketInstallFailed')}${(error as Error)?.message ? `：${(error as Error).message}` : ''}`);
        } finally {
            setBusyId(null);
        }
    };

    if (!isOpen || typeof document === 'undefined') return null;

    const cardClass = isDaylight
        ? 'bg-black/[0.04] border-black/10'
        : 'bg-white/5 border-white/10';
    const dividerClass = isDaylight ? 'border-black/10' : 'border-white/10';
    const muted = isDaylight ? 'text-black/55' : 'text-white/55';
    const surfaceClass = isDaylight
        ? 'bg-white border-black/10'
        : 'bg-zinc-900 border-white/10';

    return createPortal(
        <div
            className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-3 backdrop-blur-md"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            data-folia-font-market-overlay="true"
        >
            <div
                className={`flex w-full max-w-3xl flex-col overflow-hidden rounded-[26px] border shadow-2xl ${surfaceClass}`}
                style={{ maxHeight: 'min(86vh, 760px)' }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={`flex items-center justify-between gap-3 border-b px-5 py-4 ${dividerClass}`}>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            <Cloud size={15} className="shrink-0 opacity-70" aria-hidden="true" />
                            {t('options.fontMarket')}
                        </div>
                        <div className={`text-xs ${muted}`}>{t('options.fontMarketDesc')}</div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('ui.close')}
                        className="shrink-0 rounded-full border border-white/10 bg-white/5 p-2 transition-colors hover:bg-white/10"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <X size={17} />
                    </button>
                </div>

                <div className={`border-b px-5 py-3 ${dividerClass}`}>
                    <label className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                        <Search size={15} style={{ color: 'var(--text-secondary)' }} />
                        <input
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t('options.fontMarketSearch')}
                            className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
                            style={{ color: 'var(--text-primary)' }}
                        />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {TABS.map((entry) => {
                            const active = tab === entry.id;
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setTab(entry.id)}
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-opacity ${isDaylight ? 'border-black/15' : 'border-white/15'} ${active ? 'opacity-100' : 'opacity-55 hover:opacity-85'}`}
                                    style={{
                                        color: 'var(--text-primary)',
                                        backgroundColor: active
                                            ? (themeAccentSoft(isDaylight))
                                            : 'transparent',
                                    }}
                                >
                                    {t(entry.labelKey) === entry.labelKey ? entry.fallback : t(entry.labelKey)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    {tab === 'mine' ? (
                        <div className="space-y-3">
                            <div className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${muted} ${cardClass}`}>
                                {t('options.fontMarketMineDesc')}
                            </div>
                            <div className={`rounded-2xl border px-4 py-3 ${cardClass}`}>
                                <div className={`text-xs ${muted}`}>{t('options.currentFont')}</div>
                                <div className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {localFontLabel?.trim() || t('options.systemFontInactive')}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {onPickLocalFont && (
                                    <button
                                        type="button"
                                        onClick={onPickLocalFont}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white/90"
                                    >
                                        <Upload size={14} />
                                        {t('options.fontMarketPickLocal')}
                                    </button>
                                )}
                                {onClearFont && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            writeFontMarketChoice(null);
                                            onClearFont();
                                            onClose();
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 px-3.5 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/10"
                                    >
                                        {t('options.fontMarketClear')}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : status === 'loading' ? (
                        <div className={`flex items-center gap-2 text-xs ${muted}`}>
                            <Loader2 size={14} className="animate-spin" />
                            {t('options.fontMarketLoading')}
                        </div>
                    ) : fonts.length === 0 ? (
                        <div className={`text-xs ${muted}`}>
                            {status === 'offline' ? t('options.fontMarketOffline') : t('options.fontMarketServerError')}
                        </div>
                    ) : visible.length === 0 ? (
                        <div className={`text-xs ${muted}`}>{t('options.fontMarketNoMatch')}</div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {visible.map((font) => {
                                const active = currentFamily !== null
                                    && currentFamily !== undefined
                                    && currentFamily.trim() !== ''
                                    && currentFamily === font.family;
                                return (
                                    <div
                                        key={font.id}
                                        className={`overflow-hidden rounded-2xl border ${cardClass}`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setPreview(font)}
                            className="block w-full text-left"
                                        >
                                            <img
                                                src={resolveFontPreviewUrl(font)}
                                                alt={font.name}
                                                loading="lazy"
                                                className="w-full bg-white/[0.03]"
                                            />
                                        </button>
                                        <div className="flex items-center gap-2 px-3.5 py-2.5">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                    {font.name}
                                                </div>
                                                <div className={`truncate text-[11px] ${muted}`}>
                                                    {font.categoryLabel || font.category}
                                                </div>
                                            </div>
                                            {active ? (
                                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[11px]" style={{ color: 'var(--text-primary)' }}>
                                                    <Check size={11} />
                                                    {t('options.fontMarketUsing')}
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={busyId !== null}
                                                    onClick={() => void applyFont(font)}
                                                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-950 transition hover:bg-white/90 disabled:opacity-45"
                                                >
                                                    {busyId === font.id ? <Loader2 size={11} className="animate-spin" /> : null}
                                                    {busyId === font.id ? t('options.fontMarketInstalling') : t('options.fontMarketUse')}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {notice && (
                    <div className={`border-t px-5 py-3 text-xs text-red-400 ${dividerClass}`}>{notice}</div>
                )}
            </div>

            {preview && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-black/70 p-5"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setPreview(null);
                    }}
                >
                    <div className={`w-full max-w-2xl overflow-hidden rounded-2xl border ${surfaceClass}`} onClick={(event) => event.stopPropagation()}>
                        <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${dividerClass}`}>
                            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{preview.name}</div>
                            <button
                                type="button"
                                onClick={() => setPreview(null)}
                                className="rounded-full border border-white/10 bg-white/5 p-1.5"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                <X size={15} />
                            </button>
                        </div>
                        <img src={resolveFontPreviewUrl(preview)} alt={preview.name} className="block w-full" />
                        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 ${dividerClass}`}>
                            <div className={`text-[11px] ${muted}`}>
                                {[preview.categoryLabel || preview.category, preview.license].filter(Boolean).join(' · ')}
                            </div>
                            <button
                                type="button"
                                disabled={busyId !== null}
                                onClick={() => void applyFont(preview)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white/90 disabled:opacity-45"
                            >
                                {busyId === preview.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                {busyId === preview.id ? t('options.fontMarketInstalling') : t('options.fontMarketConfirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body,
    );
};

export default FontMarketDialog;
