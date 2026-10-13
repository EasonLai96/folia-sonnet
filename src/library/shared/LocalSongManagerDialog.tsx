import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search, Trash2 } from 'lucide-react';
import ThemedDialog from '../../components/shared/ThemedDialog';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import type { LocalSong } from '../../types';
import { formatTime } from '../../utils/appPlaybackHelpers';

// src/library/shared/LocalSongManagerDialog.tsx
// 本地曲库的「管理歌曲」对话框：搜索、勾选、删除。删的是曲库里的这首歌（安卓上连导入时
// 复制的音频副本一起删），所以删除都先经确认；曲库可能上万首，列表只渲染筛选后的前
// MAX_VISIBLE 条 —— 剩下的靠搜索缩小范围，不然一打开就渲染几千行会卡死。

const MAX_VISIBLE = 200;

type LocalSongManagerDialogProps = {
    isOpen: boolean;
    songs: readonly LocalSong[];
    isDaylight: boolean;
    /** 删这些歌（真的删，不是挪出歌单）；做完由调用方刷新与提示。 */
    onDelete: (songIds: string[]) => Promise<void>;
    onClose: () => void;
};

const songTitle = (song: LocalSong): string => song.title || song.importedMetadata?.title || song.fileName;
const songArtists = (song: LocalSong): string => (
    song.onlineMetadata?.artists.map(item => item.name).join(', ')
    || song.importedMetadata?.artistNames.join(', ')
    || ''
);
const songSearchText = (song: LocalSong): string => (
    [songTitle(song), songArtists(song), song.importedMetadata?.albumName, song.folderName, song.fileName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
);

export const LocalSongManagerDialog: React.FC<LocalSongManagerDialogProps> = ({
    isOpen,
    songs,
    isDaylight,
    onDelete,
    onClose,
}) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);

    const filtered = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return songs;
        return songs.filter(song => songSearchText(song).includes(keyword));
    }, [query, songs]);
    const visible = useMemo(() => filtered.slice(0, MAX_VISIBLE), [filtered]);
    const hiddenCount = filtered.length - visible.length;
    // 过滤条件变了还留着看不见的选中项，用户会以为没选上 —— 只保留当前可见范围里的选择。
    const selected = useMemo(
        () => visible.filter(song => selectedIds.has(song.id)).map(song => song.id),
        [selectedIds, visible],
    );

    const toggle = (id: string) => setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });

    const runDelete = async (ids: string[]) => {
        if (ids.length === 0) return;
        setDeleting(true);
        try {
            await onDelete(ids);
            setSelectedIds(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
        } finally {
            setDeleting(false);
        }
    };

    const rowClass = isDaylight
        ? 'border-zinc-200/70 hover:bg-zinc-500/10'
        : 'border-white/10 hover:bg-white/5';
    const mutedClass = isDaylight ? 'text-zinc-500' : 'text-zinc-400';

    return (
        <>
            <ThemedDialog
                isOpen={isOpen}
                onClose={onClose}
                isDaylight={isDaylight}
                title={t('localMusic.manageSongsTitle')}
                description={t('localMusic.manageSongsHint')}
                maxWidthClass="max-w-2xl"
                panelKind="local-song-manager"
                closeDisabled={deleting}
                footer={(
                    <div className="flex w-full items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={() => setSelectedIds(prev => (
                                prev.size > 0 ? new Set() : new Set(visible.map(song => song.id))
                            ))}
                            className="rounded-full border border-zinc-400/40 px-4 py-2 text-xs font-medium transition-colors opacity-80 hover:opacity-100 cursor-pointer"
                        >
                            {selected.length > 0 ? t('localMusic.deselectAllSongs') : t('localMusic.selectAllSongs')}
                        </button>
                        <button
                            type="button"
                            disabled={selected.length === 0 || deleting}
                            onClick={() => setPendingDelete(selected)}
                            className="rounded-full px-5 py-2 text-xs font-semibold transition-colors bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                        >
                            {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            {t('localMusic.deleteSelected', { count: selected.length })}
                        </button>
                    </div>
                )}
            >
                <div className="flex flex-col gap-3">
                    <div className={`flex items-center gap-2 rounded-full border px-3 py-2 ${isDaylight ? 'border-zinc-200 bg-white/60' : 'border-white/10 bg-white/5'}`}>
                        <Search size={14} className={mutedClass} />
                        <input
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder={t('localMusic.searchLocalSongs')}
                            className="w-full bg-transparent text-sm outline-none"
                        />
                    </div>

                    <div className={`text-xs ${mutedClass}`}>
                        {t('localMusic.songCount', { count: filtered.length })}
                        {hiddenCount > 0 ? ` · ${t('localMusic.songsHiddenByLimit', { count: hiddenCount })}` : ''}
                    </div>

                    <div className="max-h-[45vh] overflow-y-auto custom-scrollbar flex flex-col gap-1 pr-1">
                        {visible.map(song => {
                            const checked = selectedIds.has(song.id);
                            const subtitle = [songArtists(song), song.importedMetadata?.albumName || song.folderName]
                                .filter(Boolean)
                                .join(' · ');
                            return (
                                <div
                                    key={song.id}
                                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${rowClass}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggle(song.id)}
                                        className="w-4 h-4 shrink-0 cursor-pointer"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium truncate">{songTitle(song)}</div>
                                        {subtitle ? <div className={`text-xs truncate ${mutedClass}`}>{subtitle}</div> : null}
                                    </div>
                                    <div className={`text-xs shrink-0 ${mutedClass}`}>
                                        {song.duration > 0 ? formatTime(song.duration / 1000) : ''}
                                    </div>
                                    <button
                                        type="button"
                                        title={t('localMusic.deleteFromLibrary')}
                                        onClick={() => setPendingDelete([song.id])}
                                        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-red-500 hover:bg-red-500/15 transition-colors cursor-pointer"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            );
                        })}
                        {visible.length === 0 ? (
                            <div className={`py-8 text-center text-sm ${mutedClass}`}>{t('localMusic.noSongsFound')}</div>
                        ) : null}
                    </div>
                </div>
            </ThemedDialog>

            <ConfirmDialog
                isOpen={Boolean(pendingDelete)}
                title={t('localMusic.deleteSongsTitle', { count: pendingDelete?.length ?? 0 })}
                description={t('localMusic.deleteSongsMessage', { count: pendingDelete?.length ?? 0 })}
                confirmText={t('localMusic.deleteFromLibrary')}
                confirmVariant="danger"
                onConfirm={() => {
                    const ids = pendingDelete;
                    setPendingDelete(null);
                    if (ids) void runDelete(ids);
                }}
                onClose={() => setPendingDelete(null)}
                isDaylight={isDaylight}
            />
        </>
    );
};

export default LocalSongManagerDialog;
