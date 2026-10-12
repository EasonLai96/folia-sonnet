import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { getLocalPlaylists, createLocalPlaylist, addSongsToLocalPlaylist } from '../../services/localPlaylistService';
import {
    discardExternalAudioTracks,
    importExternalAudioTracks,
    isAndroidNativeRuntime,
    subscribeExternalAudio,
    takeExternalAudioTracks,
    type ExternalAudioPayload,
} from '../../services/nativeLocalMusic';
import type { LocalPlaylist, LocalSong } from '../../types';
import ConfirmDialog from '../shared/ConfirmDialog';
import PlaylistSelectionDialog from '../shared/PlaylistSelectionDialog';
import TextInputDialog from '../shared/TextInputDialog';

// src/components/app/ExternalAudioImportHost.tsx
// 「用 Folia 打开这个音频文件」。
//
// 原生侧（MainActivity.handleIncomingAudioIntent → FoliaNativePlugin.noteExternalAudioUris）
// 在 intent 进来的那一刻就把文件拷进了 App 私有目录 —— content:// 的读授权只在 intent
// 存活期间有效，等用户看完「是否导入」再回头读，部分 ROM 上已经作废。
//
// 所以这里要做的不是"再去读一遍文件"，而是替用户把后半段的两个问题问完：
// 1. 是否导入？（拷目已经做完了，用户说不要就得把副本删掉，见 discardExternalAudioTracks）
// 2. 导入到哪个歌单？（也可以直接关闭 —— 那样只进本机曲库）
//
// 两条取件路径都汇聚到这里：
// · 冷启动：那时页面还没加载完、一个监听者都没有，拷好的曲目由 takeExternalAudioTracks 取走；
// · 已经在前台：原生直接发 externalAudio 事件过来。

type ExternalAudioImportHostProps = {
    isDaylight: boolean;
};

const MAX_LISTED_NAMES = 3;

const ExternalAudioImportHost: React.FC<ExternalAudioImportHostProps> = ({ isDaylight }) => {
    const { t } = useTranslation();
    // 待处理的那一批（可能同时来自冷启动与前台事件，按 id 并起来）。
    const [pending, setPending] = useState<ExternalAudioPayload['tracks']>([]);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [playlists, setPlaylists] = useState<LocalPlaylist[]>([]);
    /** 导入要跑一会儿（要读内嵌元数据），期间不许用户连点两路；busyRef 给异步回调同步读。 */
    const busyRef = useRef(false);

    const mergePending = useCallback((incoming: ExternalAudioPayload['tracks']) => {
        if (incoming.length === 0) return;
        setPending(current => {
            const seen = new Set(current.map(track => track.id));
            const appended = incoming.filter(track => (track.id ? !seen.has(track.id) : false));
            return appended.length > 0 ? [...current, ...appended] : current;
        });
        setIsConfirmOpen(true);
    }, []);

    useEffect(() => {
        if (!isAndroidNativeRuntime()) return undefined;
        const unsubscribe = subscribeExternalAudio(payload => mergePending(payload.tracks));
        // 冷启动那一路：这一次被原生攒着、还没被领走的。
        void takeExternalAudioTracks().then(payload => mergePending(payload.tracks));
        return unsubscribe;
    }, [mergePending]);

    const reset = useCallback(() => {
        setPending([]);
        setIsConfirmOpen(false);
        setIsPlaylistOpen(false);
        setIsCreateOpen(false);
    }, []);

    /** 用户摇头：连已经在私有目录里的副本一起收回。 */
    const handleDecline = useCallback(async () => {
        const tracks = pending;
        reset();
        if (tracks.length > 0) await discardExternalAudioTracks(tracks);
    }, [pending, reset]);

    const finishImport = useCallback(async (playlistId: string | null, playlistName?: string) => {
        if (busyRef.current) return;
        busyRef.current = true;
        try {
            const imported: LocalSong[] = await importExternalAudioTracks(pending);
            const added = imported.length;
            if (added === 0) {
                setStatusMessage({
                    type: 'success',
                    text: t('localMusic.externalAlreadyInLibrary'),
                    nonce: Date.now(),
                });
                reset();
                return;
            }
            let targetName = playlistName ?? '';
            if (playlistId) {
                try {
                    const updated = await addSongsToLocalPlaylist(playlistId, imported);
                    if (updated) targetName = updated.name;
                } catch (error) {
                    console.warn('[ExternalAudioImport] Failed to add imported songs to playlist', error);
                }
            }
            setStatusMessage({
                type: 'success',
                text: targetName
                    ? t('localMusic.externalImportedToPlaylist', { count: added, name: targetName })
                    : t('localMusic.externalImported', { count: added }),
                nonce: Date.now(),
            });
            reset();
        } catch (error) {
            setStatusMessage({
                type: 'error',
                text: t('localMusic.externalImportFailed', {
                    message: error instanceof Error ? error.message : String(error),
                }),
                nonce: Date.now(),
            });
        } finally {
            busyRef.current = false;
        }
    }, [pending, reset, t]);

    /** 选歌单那一页的数据：每次打开都重新读，别让用户刚新建好的歌单不出现。 */
    const openPlaylistStep = useCallback(async () => {
        const existing = await getLocalPlaylists();
        setPlaylists(existing);
        setIsConfirmOpen(false);
        setIsPlaylistOpen(true);
    }, []);

    const summary = useMemo(() => {
        const names = pending.map(track => track.fileName || track.id);
        const head = names.slice(0, MAX_LISTED_NAMES).join('、');
        const rest = Math.max(0, names.length - MAX_LISTED_NAMES);
        return { head, rest, count: names.length, firstName: names[0] ?? '' };
    }, [pending]);

    const playlistEntries = useMemo(() => playlists.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: `${playlist.songIds.length} ${t('playlist.tracks')}`,
    })), [playlists, t]);

    if (!isAndroidNativeRuntime()) return null;

    return (
        <div className="pointer-events-auto">
            <ConfirmDialog
                isOpen={isConfirmOpen && pending.length > 0}
                onClose={() => void handleDecline()}
                onConfirm={() => void openPlaylistStep()}
                isDaylight={isDaylight}
                title={t('localMusic.externalOpenTitle')}
                description={(
                    <>
                        <span>
                            {summary.count === 1
                                ? t('localMusic.externalOpenConfirm_one', { name: summary.firstName })
                                : t('localMusic.externalOpenConfirm_other', { count: summary.count })}
                        </span>
                        {summary.count > 1 && (
                            <span className="mt-1 block text-xs opacity-60">
                                {t('localMusic.externalOpenFileList', {
                                    names: summary.head,
                                    more: summary.rest > 0
                                        ? ` ${t('localMusic.externalOpenFileMore', { count: summary.rest })}`
                                        : '',
                                })}
                            </span>
                        )}
                    </>
                )}
                confirmText={t('localMusic.externalImportAction')}
                cancelText={t('localMusic.cancel')}
            />

            <PlaylistSelectionDialog
                isOpen={isPlaylistOpen}
                onClose={() => void finishImport(null)}
                isDaylight={isDaylight}
                title={t('localMusic.externalPickPlaylistTitle')}
                description={t('localMusic.externalPickPlaylistHint')}
                playlists={playlistEntries}
                onSelect={async playlistId => {
                    await finishImport(String(playlistId));
                }}
                onCreate={() => {
                    setIsPlaylistOpen(false);
                    setIsCreateOpen(true);
                }}
                createLabel={t('localMusic.createPlaylist')}
            />

            <TextInputDialog
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                isDaylight={isDaylight}
                title={t('localMusic.createPlaylist')}
                description={t('localMusic.enterPlaylistName')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('localMusic.save')}
                onConfirm={async name => {
                    const trimmed = name.trim();
                    if (!trimmed) return;
                    const created = await createLocalPlaylist(trimmed, []);
                    await finishImport(created.id, created.name);
                }}
            />
        </div>
    );
};

export default ExternalAudioImportHost;
